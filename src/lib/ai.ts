/**
 * AI suggestion engine.
 *
 * Pure logic, no React: it (1) summarizes the current Excalidraw scene into a
 * compact JSON the model can reason about, (2) asks the local MLX model for the
 * next 1-3 useful elements, and (3) turns those suggestions into Excalidraw
 * element skeletons the canvas can convert + ghost-render. It never throws on
 * bad model output — a failed parse yields an empty suggestion list.
 */
import type {
  SceneSummary,
  NodeInfo,
  EdgeInfo,
  Suggestion,
  SuggestionKind,
  AiConfig,
  ExcalidrawElementSkeleton,
} from "./types";
import { DEFAULT_AI_MODEL, DEFAULT_AI_BASE_URL } from "./config";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/* ───────────────────────────  1. summarizeScene  ─────────────────────────── */

/** Element types that become scene nodes (everything else is structural ink). */
const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond", "text"]);

/**
 * Reduce a live scene to the minimal graph the model needs: labeled boxes /
 * ellipses / diamonds / text as nodes, and bound arrows as directed edges.
 */
export function summarizeScene(
  elements: readonly NonDeletedExcalidrawElement[],
  intent?: string,
): SceneSummary {
  const nodes: NodeInfo[] = [];
  const edges: EdgeInfo[] = [];

  // Index text elements by the shape they label, so a shape can borrow its
  // bound caption. Standalone text (no container) is emitted as its own node.
  const labelByContainer = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) {
      labelByContainer.set(el.containerId, el.text);
    }
  }

  for (const el of elements) {
    if (!NODE_TYPES.has(el.type)) continue;
    if (el.type === "text") {
      if (el.containerId) continue; // already folded into its container's label
      nodes.push({
        id: el.id,
        type: "text",
        text: el.text,
        x: Math.round(el.x),
        y: Math.round(el.y),
        w: Math.round(el.width),
        h: Math.round(el.height),
      });
      continue;
    }
    nodes.push({
      id: el.id,
      type: el.type,
      text: labelByContainer.get(el.id) ?? "",
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.width),
      h: Math.round(el.height),
    });
  }

  for (const el of elements) {
    if (el.type !== "arrow") continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (from && to) edges.push({ from, to });
  }

  return intent ? { nodes, edges, intent } : { nodes, edges };
}

/* ───────────────────────────  2. suggestNext  ─────────────────────────── */

const ALLOWED_KINDS: ReadonlySet<string> = new Set<SuggestionKind>([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
]);

const SYSTEM_PROMPT = [
  "You are a diagramming copilot inside a smart whiteboard.",
  "You are given the current diagram as JSON (nodes have ids, types, text, and",
  "bounding boxes; edges are directed arrows between node ids).",
  "Propose the 1-3 most useful NEXT elements to help express the idea. Prefer",
  "completing obvious structures (flows, hierarchies, groupings) and connect new",
  "nodes to the diagram with arrows. Keep labels short.",
  "",
  "Return STRICT JSON only — no prose, no code fences. Exact schema:",
  '{ "suggestions": [ { "kind": "rectangle"|"ellipse"|"diamond"|"text"|"arrow",',
  '  "text"?: string, "x"?: number, "y"?: number, "w"?: number, "h"?: number,',
  '  "from"?: string, "to"?: string, "rationale"?: string } ] }',
  "",
  'For arrows, "from"/"to" must be either an existing node id from the input, or',
  '"new:<index>" referencing another suggestion in THIS array by its position',
  "(0-based). Omit x/y/w/h to let the canvas place a node automatically.",
  "",
  "Example — input:",
  '{"nodes":[{"id":"a","type":"rectangle","text":"Build","x":0,"y":0,"w":160,"h":80}],"edges":[]}',
  "Example — output:",
  '{"suggestions":[{"kind":"rectangle","text":"Test","rationale":"next CI stage"},' +
    '{"kind":"arrow","from":"a","to":"new:0","rationale":"Build flows into Test"}]}',
].join("\n");

/**
 * Ask the local model for the next elements. Network/HTTP failures reject;
 * malformed model output resolves to an empty list (never throws on parse).
 */
export async function suggestNext(
  scene: SceneSummary,
  cfg: AiConfig,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const userParts = [JSON.stringify(scene)];
  if (scene.intent) {
    userParts.push(
      `The user's stated intent is: "${scene.intent}". Prioritise elements that advance this intent.`,
    );
  }

  // Tolerate a partial config: fall back to the shared defaults.
  const baseUrl = cfg.baseUrl || DEFAULT_AI_BASE_URL;
  const model = cfg.model || DEFAULT_AI_MODEL;

  const res = await tauriFetch(baseUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts.join("\n\n") },
      ],
      temperature: 0.4,
      max_tokens: 700,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return [];
    return parseSuggestions(content);
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn("suggestNext: failed to parse model response", err);
    }
    return [];
  }
}

/**
 * Strip code fences, isolate the first balanced JSON value (object OR array),
 * validate, and cap to 3. Exported for tests. The model is asked for
 * `{ "suggestions": [...] }`, but smaller models sometimes drop the wrapper and
 * return a bare array — both shapes are accepted.
 */
export function parseSuggestions(raw: string): Suggestion[] {
  const fenced = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const jsonText = firstBalancedJson(fenced);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];

  const out: Suggestion[] = [];
  for (const item of list) {
    const sug = validateSuggestion(item);
    if (sug) out.push(sug);
    if (out.length === 3) break;
  }
  return out;
}

/** Coerce one raw model item into a Suggestion, or null if it is unusable. */
function validateSuggestion(item: unknown): Suggestion | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const kind = rec.kind;
  if (typeof kind !== "string" || !ALLOWED_KINDS.has(kind)) return null;

  const sug: Suggestion = { kind: kind as SuggestionKind };
  if (typeof rec.text === "string") sug.text = rec.text;
  if (typeof rec.rationale === "string") sug.rationale = rec.rationale;
  if (typeof rec.from === "string") sug.from = rec.from;
  if (typeof rec.to === "string") sug.to = rec.to;

  const x = coerceNumber(rec.x);
  const y = coerceNumber(rec.y);
  const w = coerceNumber(rec.w);
  const h = coerceNumber(rec.h);
  if (x !== undefined) sug.x = x;
  if (y !== undefined) sug.y = y;
  if (w !== undefined) sug.w = w;
  if (h !== undefined) sug.h = h;

  return sug;
}

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Return the first balanced JSON value ({...} or [...]) substring, or null. */
function firstBalancedJson(s: string): string | null {
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" || s[i] === "[") {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/* ───────────────────────────  3. suggestionsToSkeletons  ─────────────────────────── */

const DEFAULT_W = 160;
const DEFAULT_H = 80;
const TEXT_H = 30;
const STEP_X = 260;
const STEP_Y = 140;
const PER_ROW = 3;

/** A resolved node box for a non-arrow suggestion, keyed by its batch index. */
interface PlacedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: SuggestionKind;
  text?: string;
}

/**
 * Turn suggestions into Excalidraw skeletons. Non-arrow nodes are emitted first
 * (so batch arrow bindings can reference their ids), then arrows. Auto-places
 * any node missing geometry. Never throws.
 */
export function suggestionsToSkeletons(
  suggestions: Suggestion[],
  scene: SceneSummary,
): ExcalidrawElementSkeleton[] {
  // Anchor auto-placement to the right of the rightmost existing node.
  let cursorX = 200;
  let baseY = 200;
  if (scene.nodes.length > 0) {
    let maxRight = -Infinity;
    let minTop = Infinity;
    for (const n of scene.nodes) {
      maxRight = Math.max(maxRight, n.x + n.w);
      minTop = Math.min(minTop, n.y);
    }
    cursorX = maxRight + STEP_X - DEFAULT_W;
    baseY = minTop;
  }

  // Pass 1 — resolve geometry + ids for every non-arrow suggestion.
  const placed = new Map<number, PlacedNode>();
  let autoIndex = 0;
  const nodeSkeletons: ExcalidrawElementSkeleton[] = [];

  suggestions.forEach((sug, index) => {
    if (sug.kind === "arrow") return;

    const id = `sugg-${index}`;
    const isText = sug.kind === "text";
    const defaultW = isText
      ? Math.max(80, (sug.text?.length ?? 0) * 9)
      : DEFAULT_W;
    const defaultH = isText ? TEXT_H : DEFAULT_H;

    let x = sug.x;
    let y = sug.y;
    if (x === undefined || y === undefined) {
      const col = autoIndex % PER_ROW;
      const row = Math.floor(autoIndex / PER_ROW);
      const autoX = cursorX + col * STEP_X;
      const autoY = baseY + row * STEP_Y;
      if (x === undefined) x = autoX;
      if (y === undefined) y = autoY;
      autoIndex++;
    }
    const w = sug.w ?? defaultW;
    const h = sug.h ?? defaultH;

    placed.set(index, { id, x, y, w, h, kind: sug.kind, text: sug.text });

    if (sug.kind === "text") {
      nodeSkeletons.push({ type: "text", x, y, text: sug.text ?? "" });
    } else {
      // sug.kind is narrowed to "rectangle" | "ellipse" | "diamond" here.
      nodeSkeletons.push({
        type: sug.kind,
        id,
        x,
        y,
        width: w,
        height: h,
        ...(sug.text ? { label: { text: sug.text } } : {}),
      });
    }
  });

  // Pass 2 — arrows. Resolve endpoints, compute boundary points, bind only to
  // batch nodes; existing scene nodes are connected geometrically.
  const arrowSkeletons: ExcalidrawElementSkeleton[] = [];

  for (const sug of suggestions) {
    if (sug.kind !== "arrow") continue;
    const source = resolveEndpoint(sug.from, placed, scene);
    const target = resolveEndpoint(sug.to, placed, scene);
    if (!source || !target) continue;

    const sc = boxCenter(source.box);
    const tc = boxCenter(target.box);
    const [startX, startY] = boundaryPoint(source.box, tc);
    const [endX, endY] = boundaryPoint(target.box, sc);

    arrowSkeletons.push({
      type: "arrow",
      x: startX,
      y: startY,
      points: [
        [0, 0],
        [endX - startX, endY - startY],
      ],
      ...(source.bindId ? { start: { id: source.bindId } } : {}),
      ...(target.bindId ? { end: { id: target.bindId } } : {}),
      ...(sug.text ? { label: { text: sug.text } } : {}),
    });
  }

  return [...nodeSkeletons, ...arrowSkeletons];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResolvedEndpoint {
  box: Box;
  /** Present only when the endpoint is a node added in THIS batch (bindable). */
  bindId?: string;
}

/**
 * Resolve an arrow endpoint ref to a box. "new:<i>" hits the batch map (and is
 * bindable); a bare id is looked up in the existing scene (geometry only).
 */
function resolveEndpoint(
  ref: string | undefined,
  placed: Map<number, PlacedNode>,
  scene: SceneSummary,
): ResolvedEndpoint | null {
  if (!ref) return null;

  const m = /^new:(\d+)$/.exec(ref);
  if (m) {
    const node = placed.get(Number(m[1]));
    if (!node) return null;
    return { box: { x: node.x, y: node.y, w: node.w, h: node.h }, bindId: node.id };
  }

  const node = scene.nodes.find((n) => n.id === ref);
  if (!node) return null;
  return { box: { x: node.x, y: node.y, w: node.w, h: node.h } };
}

function boxCenter(b: Box): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * Point on box boundary along the ray from the box center toward `toward`.
 * Falls back to the center if the two points coincide.
 */
function boundaryPoint(b: Box, toward: [number, number]): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];

  const hw = b.w / 2;
  const hh = b.h / 2;
  // Scale the direction so it just touches the nearest box edge.
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return [cx + dx * t, cy + dy * t];
}
