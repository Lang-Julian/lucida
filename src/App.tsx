import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import Whiteboard from "./components/Whiteboard";
import AiPanel from "./components/AiPanel";
import WelcomeHint from "./components/WelcomeHint";
import { DEFAULT_AI_MODEL, DEFAULT_AI_PORT } from "./lib/config";
import type { AiStatus, WhiteboardHandle } from "./lib/types";
import "./App.css";

/** Raw status reported by the Rust sidecar (before the readiness probe). */
interface RawAiStatus {
  running: boolean;
  port: number;
  model: string;
}

function App() {
  const [autoBeautify, setAutoBeautify] = useState(true);
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus>({
    running: false,
    ready: false,
    port: DEFAULT_AI_PORT,
    model: DEFAULT_AI_MODEL,
  });

  const ref = useRef<WhiteboardHandle | null>(null);
  // Resolve from the live sidecar status so LUCIDA_AI_PORT / LUCIDA_AI_MODEL
  // overrides take effect end-to-end (the defaults seed it until the first
  // ai_status poll reports the real port + model).
  const aiConfig = useMemo(
    () => ({ baseUrl: `http://127.0.0.1:${status.port}`, model: status.model }),
    [status.port, status.model],
  );

  // Spawn the sidecar once, then poll status + probe readiness on an interval.
  useEffect(() => {
    invoke("ai_start").catch(() => {});

    let cancelled = false;
    let polling = false; // guard against overlapping polls when a probe is slow
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const s = await invoke<RawAiStatus>("ai_status");
        let ready = false;
        if (s.running) {
          try {
            // Probe the port the sidecar actually reports, with a timeout so a
            // slow probe can't pile up behind the 2 s interval.
            const ctrl = new AbortController();
            const t = window.setTimeout(() => ctrl.abort(), 1500);
            const r = await tauriFetch(`http://127.0.0.1:${s.port}/v1/models`, {
              signal: ctrl.signal,
            });
            window.clearTimeout(t);
            ready = r.ok;
          } catch {
            ready = false;
          }
        }
        if (!cancelled) setStatus({ ...s, ready });
      } catch {
        // Sidecar not reachable yet; leave the last known status untouched.
      } finally {
        polling = false;
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const onSuggest = useCallback(async () => {
    if (!ref.current || busy) return;
    if (!status.ready) {
      setToast("Model still loading…");
      return;
    }
    const result = await ref.current.suggest(intent);
    setPending(ref.current.hasPendingSuggestions());
    if (result.error) setToast(result.error);
  }, [intent, busy, status.ready]);

  const onAccept = useCallback(() => {
    ref.current?.acceptSuggestions();
    setPending(false);
  }, []);

  const onDismiss = useCallback(() => {
    ref.current?.dismissSuggestions();
    setPending(false);
  }, []);

  const onToggleBeautify = useCallback(() => {
    setAutoBeautify((v) => !v);
  }, []);

  // Auto-dismiss the transient error toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Hide the welcome hint on the first pointer interaction with the canvas.
  const onFirstInteraction = useCallback(() => {
    setHintVisible(false);
  }, []);

  // Global keyboard shortcuts: ⌘↵ suggest/accept, Esc dismiss, ⌘B beautify.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (pending) onAccept();
        else void onSuggest();
        return;
      }
      if (e.key === "Escape" && pending) {
        onDismiss();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        onToggleBeautify();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, onAccept, onSuggest, onDismiss, onToggleBeautify]);

  return (
    <div className="app">
      <div className="app__canvas" onPointerDownCapture={onFirstInteraction}>
        <Whiteboard
          ref={ref}
          aiConfig={aiConfig}
          autoBeautify={autoBeautify}
          onBusyChange={setBusy}
        />
      </div>

      <WelcomeHint visible={hintVisible} />

      <AiPanel
        status={status}
        busy={busy}
        autoBeautify={autoBeautify}
        onToggleBeautify={onToggleBeautify}
        intent={intent}
        onIntentChange={setIntent}
        onSuggest={onSuggest}
        pending={pending}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />

      {toast && (
        <div className="app__toast" role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
