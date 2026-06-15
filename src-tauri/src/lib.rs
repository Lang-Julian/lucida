use std::fs::OpenOptions;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

/// TCP port for the local MLX server. LUCIDA_AI_PORT overrides the default.
fn port() -> u16 {
    std::env::var("LUCIDA_AI_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8765)
}

/// Model id served by mlx_lm.server. LUCIDA_AI_MODEL overrides the default.
fn model() -> String {
    std::env::var("LUCIDA_AI_MODEL")
        .unwrap_or_else(|_| "mlx-community/Qwen2.5-3B-Instruct-4bit".to_string())
}

/// Directory holding serve.sh + the .venv. LUCIDA_AI_DIR overrides the default.
fn sidecar_dir() -> PathBuf {
    std::env::var("LUCIDA_AI_DIR")
        .unwrap_or_else(|_| {
            format!(
                "{}/Developer/lucida/sidecar",
                std::env::var("HOME").unwrap_or_default()
            )
        })
        .into()
}

/// Whether something is already listening on the local server port — e.g. a
/// server left behind by a `tauri dev` hot-reload, or one started by hand.
fn port_in_use(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Owns the local MLX model server child process and its config.
struct AiSidecar {
    child: Mutex<Option<Child>>,
    port: u16,
    model: String,
    script: PathBuf,
    log: PathBuf,
}

impl AiSidecar {
    /// Start the server if it isn't already alive. Idempotent.
    fn spawn(&self) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(c) = child.as_mut() {
            if matches!(c.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        // A server may already be serving on the port (a dev hot-reload can
        // leave one behind, or the user started one by hand). Adopt it rather
        // than spawning a duplicate that would just fail to bind.
        if port_in_use(self.port) {
            return Ok(());
        }
        let out = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log)
            .map_err(|e| e.to_string())?;
        let err = out.try_clone().map_err(|e| e.to_string())?;
        let ch = Command::new("bash")
            .arg(&self.script)
            .env("LUCIDA_AI_PORT", self.port.to_string())
            .env("LUCIDA_AI_MODEL", &self.model)
            .stdout(out)
            .stderr(err)
            .spawn()
            .map_err(|e| e.to_string())?;
        *child = Some(ch);
        Ok(())
    }

    /// Kill the server child and reap it. Best-effort.
    fn stop(&self) {
        if let Ok(mut g) = self.child.lock() {
            if let Some(mut c) = g.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }

    /// Whether a server is reachable — either our own child or one we adopted.
    fn running(&self) -> bool {
        if let Ok(mut g) = self.child.lock() {
            if let Some(c) = g.as_mut() {
                if matches!(c.try_wait(), Ok(None)) {
                    return true;
                }
            }
        }
        port_in_use(self.port)
    }
}

#[tauri::command]
fn ai_start(state: State<AiSidecar>) -> Result<(), String> {
    state.spawn()
}

#[tauri::command]
fn ai_stop(state: State<AiSidecar>) {
    state.stop()
}

#[tauri::command]
fn ai_status(state: State<AiSidecar>) -> serde_json::Value {
    serde_json::json!({
        "running": state.running(),
        "port": state.port,
        "model": state.model,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = sidecar_dir();
    let sidecar = AiSidecar {
        child: Mutex::new(None),
        port: port(),
        model: model(),
        script: dir.join("serve.sh"),
        log: dir.join("server.log"),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(sidecar)
        .setup(|app| {
            let s = app.state::<AiSidecar>();
            let _ = s.spawn();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ai_start, ai_stop, ai_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(s) = app_handle.try_state::<AiSidecar>() {
                    s.stop();
                }
            }
        });
}
