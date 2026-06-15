interface WelcomeHintProps {
  /** When false, the hint fades out and stops receiving any layout focus. */
  visible: boolean;
}

/** One key + its meaning, rendered as a <kbd> chip with a label. */
function Key({ combo, label }: { combo: string; label: string }) {
  return (
    <span className="welcome-hint__key">
      <kbd className="welcome-hint__kbd">{combo}</kbd>
      <span className="welcome-hint__key-label">{label}</span>
    </span>
  );
}

/**
 * A calm, non-blocking overlay shown on an empty canvas. It never intercepts
 * pointer events (so the user can draw straight through it) and fades out once
 * the canvas has been touched.
 */
function WelcomeHint({ visible }: WelcomeHintProps) {
  return (
    <div
      className={`welcome-hint${visible ? "" : " welcome-hint--hidden"}`}
      role="note"
      aria-hidden={!visible}
    >
      <p className="welcome-hint__lead">
        Draw a rough shape — it cleans up. Press{" "}
        <kbd className="welcome-hint__kbd welcome-hint__kbd--inline">⌘↵</kbd> for
        ideas.
      </p>
      <div className="welcome-hint__legend">
        <Key combo="⌘↵" label="suggest" />
        <Key combo="Esc" label="dismiss" />
        <Key combo="⌘B" label="beautify" />
      </div>
    </div>
  );
}

export default WelcomeHint;
