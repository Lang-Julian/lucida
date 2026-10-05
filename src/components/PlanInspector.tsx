/**
 * PlanInspector — the side panel for one selected plan item.
 *
 * The board shows where a card sits and what it waits on; this panel edits the
 * rest of its file: title, status, owner, due date, the "why". Every change is
 * written straight to `wiki/plan/<slug>.md` — there is no save button, because
 * there is no second copy to save to.
 *
 * Ref-driven like the other overlays, so selecting a card never re-renders the
 * canvas underneath.
 */
import { forwardRef, useImperativeHandle, useState, type CSSProperties } from "react";
import type { PlanItem, PlanPatch, PlanStatus } from "../lib/plan";
import { STATUS_COLOR } from "../lib/plan";
import { strings, type Lang } from "../lib/i18n";

export interface InspectorState {
  item: PlanItem;
  /** crew to hand the item to: slug → name */
  crew: Array<[string, string]>;
  /** what it waits on, resolved to titles */
  waits: Array<{ slug: string; title: string; done: boolean }>;
  /** the file on disk */
  path: string;
}

export interface PlanInspectorHandle {
  set: (state: InspectorState | null) => void;
  isOpen: () => boolean;
}

interface Props {
  lang: Lang;
  onPatch: (slug: string, patch: PlanPatch) => void;
  onReveal: (path: string) => void;
  onObsidian: (path: string) => void;
}

const STATUSES: PlanStatus[] = ["todo", "doing", "done", "blocked"];

const PlanInspector = forwardRef<PlanInspectorHandle, Props>(function PlanInspector({ lang, onPatch, onReveal, onObsidian }, ref) {
  const T = strings(lang);
  const [state, setState] = useState<InspectorState | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");

  useImperativeHandle(
    ref,
    () => ({
      set: (next) => {
        setState((prev) => {
          // Keep what is being typed when the same item is redrawn underneath.
          if (!next || prev?.item.slug !== next.item.slug || prev.item.raw !== next.item.raw) {
            setTitle(next?.item.title ?? "");
            setBody(next?.item.body ?? "");
            setDate(next?.item.date ?? "");
          }
          return next;
        });
      },
      isOpen: () => state !== null,
    }),
    [state],
  );

  if (!state) return null;
  const { item } = state;
  const patch = (p: PlanPatch) => onPatch(item.slug, p);
  const hasStatus = item.kind === "card" || item.kind === "decision" || item.kind === "step";
  const hasOwner = hasStatus || item.kind === "front";

  return (
    <aside className="plan-inspector" aria-label={`${T.kind[item.kind] ?? item.kind}: ${item.title}`} onKeyDown={(e) => e.stopPropagation()}>
      <p className="plan-inspector__kind">
        {T.kind[item.kind] ?? item.kind}
        {item.severity ? ` · ${T.severity[item.severity]}` : ""}
      </p>
      <textarea
        className="plan-inspector__title"
        value={title}
        rows={2}
        aria-label={T.title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        onBlur={() => title.trim() && title.trim() !== item.title && patch({ title: title.trim() })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
      />

      {hasStatus && (
        <div className="plan-inspector__status" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={item.status === s}
              className="plan-inspector__chip"
              style={{ ["--dot" as string]: STATUS_COLOR[s] } as CSSProperties}
              onClick={() => item.status !== s && patch({ status: s })}
            >
              <i />
              {T.status[s]}
            </button>
          ))}
        </div>
      )}

      <div className="plan-inspector__row">
        {hasOwner && (
          <label className="plan-inspector__field">
            <span>{T.owner}</span>
            <select value={item.owner} onChange={(e) => patch({ owner: e.currentTarget.value })}>
              <option value="">{T.nobody}</option>
              {state.crew.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
              {item.owner && !state.crew.some(([s]) => s === item.owner) && <option value={item.owner}>{item.owner}</option>}
            </select>
          </label>
        )}
        {(hasStatus || item.kind === "goal") && (
          <label className="plan-inspector__field">
            <span>{item.kind === "goal" ? T.goalDate : T.due}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
              onBlur={() => date !== item.date && patch({ date })}
            />
          </label>
        )}
      </div>

      {state.waits.length > 0 && (
        <div className={`plan-inspector__waits${item.kind === "risk" ? " is-risk" : ""}`}>
          <span>{item.kind === "risk" ? T.threatensList : T.waits}</span>
          <ul>
            {state.waits.map((w) => (
              <li key={w.slug} className={w.done ? "is-done" : ""}>
                {w.title}
                <button
                  type="button"
                  aria-label={T.removeLink(w.title)}
                  onClick={() =>
                    item.kind === "risk"
                      ? patch({ affects: item.affects.filter((a) => a !== w.slug) })
                      : patch({ depends_on: item.depends_on.filter((d) => d !== w.slug) })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="plan-inspector__field plan-inspector__field--body">
        <span>{T.body}</span>
        <textarea value={body} rows={7} onChange={(e) => setBody(e.currentTarget.value)} onBlur={() => body.trim() !== item.body && patch({ body })} />
      </label>

      {item.source && <p className="plan-inspector__source">{T.sourceLine(item.source.replace(/\[\[|\]\]/g, ""))}</p>}

      <div className="plan-inspector__actions">
        <button type="button" onClick={() => onObsidian(state.path)}>
          {T.openObsidian}
        </button>
        <button type="button" onClick={() => onReveal(state.path)}>
          {T.reveal}
        </button>
        {item.kind !== "goal" && item.kind !== "horizon" && (
          <button type="button" className="plan-inspector__archive" onClick={() => patch({ status: "archived" })}>
            {T.archive}
          </button>
        )}
      </div>
      <p className="plan-inspector__file">{state.path.replace(/^\/Users\/[^/]+/, "~")}</p>
    </aside>
  );
});

export default PlanInspector;
