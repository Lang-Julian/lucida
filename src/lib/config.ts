/**
 * Shared runtime configuration. The Rust sidecar (src-tauri) MUST agree with
 * these values — the same port + model id are hard-defaults on both sides and
 * overridable via the LUCIDA_AI_PORT / LUCIDA_AI_MODEL env vars at launch.
 */
export const DEFAULT_AI_PORT = 8765;
export const DEFAULT_AI_MODEL = "mlx-community/Qwen2.5-3B-Instruct-4bit";
export const DEFAULT_AI_BASE_URL = `http://127.0.0.1:${DEFAULT_AI_PORT}`;

/** Visual treatment for not-yet-accepted AI suggestions ("ghost" elements). */
export const GHOST_OPACITY = 35;
