import type { AiStatus } from "../lib/types";

interface AiPanelProps {
  status: AiStatus;
  busy: boolean;
  autoBeautify: boolean;
  onToggleBeautify: () => void;
  intent: string;
  onIntentChange: (v: string) => void;
  onSuggest: () => void;
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

/** Drop the "org/" prefix so the model id reads as a short name. */
function shortModel(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function statusView(status: AiStatus): { tone: string; label: string } {
  if (!status.running) return { tone: "off", label: "Off" };
  if (!status.ready) return { tone: "loading", label: "Loading model" };
  return { tone: "ready", label: "Ready" };
}

/** Presentational floating control card for the AI features. */
function AiPanel({
  status,
  busy,
  autoBeautify,
  onToggleBeautify,
  intent,
  onIntentChange,
  onSuggest,
  pending,
  onAccept,
  onDismiss,
}: AiPanelProps) {
  const { tone, label } = statusView(status);
  const suggestDisabled = busy || !status.ready;

  return (
    <aside className="ai-panel" aria-label="Lucida AI controls">
      <header className="ai-panel__header">
        <span className="ai-panel__title">Lucida</span>
        <span
          className={`ai-panel__status ai-panel__status--${tone}`}
          role="status"
          title={status.model}
        >
          <span
            className={`ai-panel__dot ai-panel__dot--${tone}`}
            aria-hidden="true"
          />
          {label}
        </span>
      </header>

      <p className="ai-panel__model" title={status.model}>
        {shortModel(status.model)}
      </p>

      <label className="ai-panel__switch">
        <input
          type="checkbox"
          role="switch"
          checked={autoBeautify}
          onChange={onToggleBeautify}
          aria-label="Auto-beautify strokes"
        />
        <span className="ai-panel__switch-track" aria-hidden="true">
          <span className="ai-panel__switch-thumb" />
        </span>
        <span className="ai-panel__switch-text">
          Auto-beautify
          <span className="ai-panel__hint">wobbly → clean</span>
        </span>
      </label>

      <input
        className="ai-panel__intent"
        type="text"
        value={intent}
        onChange={(e) => onIntentChange(e.currentTarget.value)}
        placeholder="Describe your idea (optional)"
        aria-label="Describe your idea"
      />

      <button
        type="button"
        className="ai-panel__btn ai-panel__btn--primary"
        onClick={onSuggest}
        disabled={suggestDisabled}
        aria-busy={busy}
      >
        <span className="ai-panel__btn-label">
          {busy ? "Thinking…" : "Suggest next"}
        </span>
        {!busy && <kbd className="ai-panel__kbd">⌘↵</kbd>}
      </button>

      {pending && (
        <div className="ai-panel__actions">
          <button
            type="button"
            className="ai-panel__btn ai-panel__btn--accept"
            onClick={onAccept}
          >
            <span className="ai-panel__btn-label">Accept</span>
            <kbd className="ai-panel__kbd">⌘↵</kbd>
          </button>
          <button
            type="button"
            className="ai-panel__btn ai-panel__btn--dismiss"
            onClick={onDismiss}
          >
            <span className="ai-panel__btn-label">Dismiss</span>
            <kbd className="ai-panel__kbd">Esc</kbd>
          </button>
        </div>
      )}
    </aside>
  );
}

export default AiPanel;
