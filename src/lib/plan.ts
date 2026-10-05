/**
 * The plan — a masterplan as a board you work on, not a page you read.
 *
 * The single source of truth is a folder of small markdown files in a
 * folder, `wiki/plan/`: one file per goal, horizon, front, card, decision,
 * risk, process and process step. Everything structural lives in the
 * frontmatter (where a card sits, who owns it, what it waits on); the body is
 * the "why". Obsidian, git, Claude and this board all read and write the same
 * files, so they can never disagree.
 *
 * This module is pure: parse the files into a model, lay the model out as one
 * large board, and turn a change made on the board back into new file text.
 */
import type { ExcalidrawElementSkeleton } from "./types";
import { TYPEFACES, estimateWidth, logoBox, wrap } from "./masterplan";
import { DEFAULT_HOUSE, type House } from "./house";
import { strings, type Lang } from "./i18n";
import { parseFrontmatter } from "./companyMap";

/* ───────────────────────────  Model  ─────────────────────────── */

export type PlanKind = "goal" | "horizon" | "front" | "card" | "decision" | "risk" | "process" | "step";
export type PlanStatus = "todo" | "doing" | "done" | "blocked" | "archived";

export interface PlanItem {
  slug: string;
  kind: PlanKind;
  title: string;
  status: PlanStatus;
  owner: string;
  /** card: which front row */
  front: string;
  /** card: which horizon column */
  horizon: string;
  /** step: which process; decision/risk: nothing */
  process: string;
  /** horizon, front, step: position */
  order: number;
  /** YYYY-MM-DD — a horizon's end, a goal's target, a card's own due date */
  date: string;
  depends_on: string[];
  /** risk: the cards it threatens */
  affects: string[];
  severity: "high" | "medium" | "low" | "";
  /** where this came from, e.g. [[2026-09-23-masterplan]] */
  source: string;
  body: string;
  /** the whole file, so a write can keep everything it does not touch */
  raw: string;
}

export interface Plan {
  goal?: PlanItem;
  horizons: PlanItem[];
  fronts: PlanItem[];
  cards: PlanItem[];
  decisions: PlanItem[];
  risks: PlanItem[];
  processes: PlanItem[];
  steps: PlanItem[];
  bySlug: Map<string, PlanItem>;
}

const KINDS = new Set<PlanKind>(["goal", "horizon", "front", "card", "decision", "risk", "process", "step"]);
const STATUSES = new Set<PlanStatus>(["todo", "doing", "done", "blocked", "archived"]);

function splitFile(text: string): { front: string; body: string } {
  if (!text.startsWith("---")) return { front: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { front: "", body: text };
  return { front: text.slice(3, end).replace(/^\n/, ""), body: text.slice(end + 4).replace(/^\r?\n/, "") };
}

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map(cleanLink).filter(Boolean);

/** "[[jane-doe]]" or "jane-doe" → "jane-doe". */
function cleanLink(v: string): string {
  return v.replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
}

export function parsePlanFile(slug: string, text: string): PlanItem | null {
  const { front, body } = splitFile(text);
  const f = parseFrontmatter(front);
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  const kind = s("kind") as PlanKind;
  if (!KINDS.has(kind)) return null;
  const status = (s("status") || "todo").toLowerCase() as PlanStatus;
  const sev = s("severity").toLowerCase();
  return {
    slug,
    kind,
    title: s("title") || slug,
    status: STATUSES.has(status) ? status : "todo",
    owner: cleanLink(s("owner")),
    front: cleanLink(s("front")),
    horizon: cleanLink(s("horizon")),
    process: cleanLink(s("process")),
    order: Number(s("order")) || 0,
    date: s("date").slice(0, 10),
    depends_on: list(f.depends_on),
    affects: list(f.affects),
    severity: sev === "high" || sev === "medium" || sev === "low" ? sev : "",
    source: s("source"),
    body: body.trim(),
    raw: text,
  };
}

export function buildPlan(files: Array<{ slug: string; text: string }>): Plan {
  const items = files.map((f) => parsePlanFile(f.slug, f.text)).filter((x): x is PlanItem => !!x);
  const live = items.filter((i) => i.status !== "archived");
  const byOrder = (a: PlanItem, b: PlanItem) => a.order - b.order || a.title.localeCompare(b.title);
  const of = (k: PlanKind) => live.filter((i) => i.kind === k).sort(byOrder);
  return {
    goal: of("goal")[0],
    horizons: of("horizon"),
    fronts: of("front"),
    cards: of("card"),
    decisions: of("decision"),
    risks: of("risk").sort((a, b) => sevRank(a) - sevRank(b) || byOrder(a, b)),
    processes: of("process"),
    steps: of("step"),
    bySlug: new Map(items.map((i) => [i.slug, i])),
  };
}

const sevRank = (i: PlanItem) => (i.severity === "high" ? 0 : i.severity === "medium" ? 1 : 2);

/* ───────────────────────────  Writing back  ─────────────────────────── */

export type PlanPatch = Partial<Pick<PlanItem, "title" | "status" | "owner" | "front" | "horizon" | "order" | "date" | "depends_on" | "affects" | "body">>;

function yamlValue(v: string | number | string[]): string {
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (typeof v === "number") return String(v);
  return /^[\w./-]*$/.test(v) && v !== "" ? v : JSON.stringify(v);
}

/**
 * New text for a file with some fields changed. Every other key, its order,
 * comments and the body stay exactly as they were — the file is the truth, and
 * the board is only allowed to touch what it changed.
 */
export function patchPlanFile(raw: string, patch: PlanPatch, today: string): string {
  const { front, body } = splitFile(raw);
  const lines = front ? front.split("\n") : [];
  const set = (key: string, value: string | number | string[]) => {
    const rendered = `${key}: ${yamlValue(value)}`;
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (i < 0) {
      lines.push(rendered);
      return;
    }
    // drop a block list that belonged to the old value
    let j = i + 1;
    while (j < lines.length && /^\s+-\s/.test(lines[j])) j++;
    lines.splice(i, j - i, rendered);
  };
  const { body: newBody, ...fields } = patch;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) set(k, v as string | number | string[]);
  set("last_updated", today);
  const b = newBody !== undefined ? `${newBody.trim()}\n` : body;
  return `---\n${lines.join("\n")}\n---\n${b.startsWith("\n") ? b : `\n${b}`}`;
}

/** A new card's file — everything a card needs, nothing it does not. */
export function newCardFile(title: string, front: string, horizon: string, today: string): string {
  return [
    "---",
    `title: ${yamlValue(title)}`,
    "type: plan",
    "kind: card",
    `front: ${front}`,
    `horizon: ${horizon}`,
    "status: todo",
    'owner: ""',
    "depends_on: []",
    "access: [leadership]",
    "source: board",
    `last_updated: ${today}`,
    "---",
    "",
    "",
  ].join("\n");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "card"
  );
}

/* ───────────────────────────  Layout  ─────────────────────────── */

/** What an element on the board is, in plan terms. Stored in customData.lucidaPlan. */
export interface PlanTag {
  root: string;
  /** card, decision, risk and step are editable; crew chips assign; deco is locked */
  role: "card" | "decision" | "risk" | "step" | "crew" | "dep" | "deco";
  slug?: string;
  /** dep: "a->b" */
  edge?: string;
  /** a title as drawn — shortened to fit, so only a real edit differs from it */
  shown?: string;
}

const TITLE_ID = (id: string, slug: string) =>
  id === `plan-card-${slug}-t` || id === "plan-score-title" || id === `plan-f-${slug}-t` || id === `plan-p-${slug}-t`;

/**
 * Remember what each title looks like on the board. A title cut to fit its
 * card must not read as "the user shortened it" — that would write the
 * shortened title into the file.
 */
export function markShownTitles(skeletons: ExcalidrawElementSkeleton[]): void {
  for (const sk of skeletons as unknown as Array<{ type: string; id?: string; text?: string; customData?: { lucidaPlan?: PlanTag } }>) {
    const t = sk.customData?.lucidaPlan;
    if (sk.type !== "text" || !t?.slug || !sk.id || !TITLE_ID(sk.id, t.slug)) continue;
    sk.customData = { ...sk.customData, lucidaPlan: { ...t, shown: sk.text ?? "" } };
  }
}

export interface PlanCell {
  front: string;
  horizon: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanLayout {
  skeletons: ExcalidrawElementSkeleton[];
  /** where a dropped card lands */
  cells: PlanCell[];
  /** each editable box as drawn, so a move can be recognised */
  boxes: Map<string, { x: number; y: number; width: number; height: number }>;
  bounds: { x: number; y: number; width: number; height: number };
  /** process lanes, for reordering a step by dragging it */
  lanes: Array<{ process: string; y: number; height: number }>;
  signature: string;
}

export interface PlanLayoutOptions {
  /** the language of the board's own labels; German by default */
  lang?: Lang;
  /** "heist": cork wall, pinned cards, red string (default on the board); "clean": the grid */
  look?: "heist" | "clean";
  root: string;
  today: string;
  origin?: { x: number; y: number };
  /** display names for owner slugs, from the wiki's people */
  people?: Map<string, string>;
  measure?: (text: string, fontSize: number, fontFamily: number) => number;
  /** the organisation's look and name */
  house?: House;
  /** the organisation's logo for this look (light or dark surface), already in the scene */
  logo?: { fileId: string; aspect: number };
}

export const STATUS_COLOR: Record<PlanStatus, string> = {
  todo: "#9ca3af",
  doing: "#2563eb",
  done: "#16a34a",
  blocked: "#dc2626",
  archived: "#d1d5db",
};
const RED = "#dc2626";
const RED_SOFT = "#fef2f2";

const LINE = 1.25;
const PAD = 80;
const LABEL_W = 280;
const COL_W = 372;
const GAP = 14;
const CARD_W = COL_W - 24;
const RAIL_W = 440;
const RAIL_GAP = 56;

/** "2026-10-30" → "30.10." (or "30.10.27" in another year) */
export function shortDate(d: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y === today.slice(0, 4) ? "" : y.slice(2)}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** The column that contains today: the first horizon that has not ended yet. */
export function currentHorizon(plan: Plan, today: string): string | null {
  return plan.horizons.find((h) => h.date && h.date >= today)?.slug ?? null;
}

/** A card's due date: its own, else the end of its horizon. */
export function dueOf(card: PlanItem, plan: Plan): string {
  return card.date || plan.bySlug.get(card.horizon)?.date || "";
}

export function isOverdue(card: PlanItem, plan: Plan, today: string): boolean {
  const due = dueOf(card, plan);
  return !!due && due < today && card.status !== "done";
}

/** Cards a card waits on that are not done yet. */
export function waitingOn(card: PlanItem, plan: Plan): PlanItem[] {
  return card.depends_on.map((s) => plan.bySlug.get(s)).filter((d): d is PlanItem => !!d && d.status !== "done" && d.status !== "archived");
}

export function layoutPlan(plan: Plan, opts: PlanLayoutOptions): PlanLayout {
  const C = opts.house ?? DEFAULT_HOUSE;
  const T = strings(opts.lang ?? "de");
  const FONT = TYPEFACES.sans;
  const measure = (t: string, fs: number) => (opts.measure ?? estimateWidth)(t, fs, FONT);
  const today = opts.today;
  const o = opts.origin ?? { x: 0, y: 0 };
  const tag = (t: Omit<PlanTag, "root">): { lucidaPlan: PlanTag } => ({ lucidaPlan: { root: opts.root, ...t } });
  const deco = tag({ role: "deco" });
  const name = (slug: string) => opts.people?.get(slug) ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const now = currentHorizon(plan, today);

  const out: ExcalidrawElementSkeleton[] = [];
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const cells: PlanCell[] = [];
  const lanes: PlanLayout["lanes"] = [];

  const push = (sk: Record<string, unknown>) => out.push(sk as unknown as ExcalidrawElementSkeleton);
  const text = (id: string, t: string, x: number, y: number, fontSize: number, color: string, customData = deco, groupIds: string[] = []) =>
    push({ type: "text", id, x, y, text: t, fontSize, fontFamily: FONT, lineHeight: LINE, strokeColor: color, roughness: 0, customData, groupIds, locked: customData === deco });
  const rect = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke: string,
    customData = deco,
    extra: Record<string, unknown> = {},
  ) =>
    push({
      type: "rectangle",
      id,
      x,
      y,
      width,
      height,
      backgroundColor: fill,
      fillStyle: "solid",
      strokeColor: stroke,
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      customData,
      locked: customData === deco,
      ...extra,
    });
  const hline = (id: string, x: number, y: number, dx: number, color: string, width = 1) =>
    push({ type: "line", id, x, y, points: [[0, 0], [dx, 0]], strokeColor: color, strokeWidth: width, roughness: 0, customData: deco, locked: true });

  const nH = Math.max(1, plan.horizons.length);
  const gridW = LABEL_W + nH * COL_W + (nH - 1) * GAP;
  const W = PAD + gridW + RAIL_GAP + RAIL_W + PAD;
  const left = o.x + PAD;
  const posterId = "plan-poster";
  rect(posterId, o.x, o.y, W, 0, C.paper, C.hair);

  /* ── The score: the goal, and how far away it is ── */
  let y = o.y + PAD;
  const goal = plan.goal;
  const cardsLive = plan.cards;
  const done = cardsLive.filter((c) => c.status === "done").length;
  const blocked = cardsLive.filter((c) => c.status === "blocked" || waitingOn(c, plan).length > 0).length;
  const overdue = cardsLive.filter((c) => isOverdue(c, plan, today)).length;
  const bandH = 250;
  rect("plan-score", left, y, W - PAD * 2, bandH, C.dark, C.dark);
  const brand = brandOf(plan) || C.name;
  text("plan-score-eyebrow", `${brand ? `${brand.toUpperCase()} · ` : ""}MASTERPLAN`, left + 44, y + 40, 15, C.accent300);
  if (opts.logo && ownPlan(brand, C.name)) {
    const lb = logoBox(opts.logo.aspect);
    push({ type: "image", id: "plan-logo", x: left + W - PAD * 2 - 44 - lb.width, y: y + 32, width: lb.width, height: lb.height, fileId: opts.logo.fileId, customData: deco, locked: true });
  }
  const goalTitle = goal?.title ?? T.noGoal;
  const gLines = wrap(goalTitle, 42, W - PAD * 2 - 88 - 700, measure).slice(0, 2);
  text("plan-score-title", gLines.join("\n"), left + 44, y + 72, 42, C.paper, goal ? tag({ role: "decision", slug: goal.slug }) : deco);
  const firstBody = goal?.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.replace(/\*\*/g, "") ?? "";
  if (firstBody) {
    const bl = wrap(firstBody, 17, W - PAD * 2 - 88 - 700, measure).slice(0, 2);
    text("plan-score-body", bl.join("\n"), left + 44, y + 72 + gLines.length * 42 * LINE + 12, 17, C.darkBody);
  }
  // the live numbers — what a static page cannot do
  const stats: Array<[string, string, string]> = [];
  if (goal?.date) {
    const d = daysBetween(today, goal.date);
    stats.push([d >= 0 ? String(d) : `+${-d}`, T.countSmall(d, shortDate(goal.date, today)), C.accent300]);
  }
  stats.push([`${done}/${cardsLive.length}`, T.cardsDone, C.paper]);
  stats.push([String(blocked), T.blockedWaiting, blocked ? "#fca5a5" : C.paper]);
  stats.push([String(overdue), T.overdue, overdue ? "#fca5a5" : C.paper]);
  const statX = left + W - PAD * 2 - 44 - stats.length * 150;
  stats.forEach(([v, l, c], i) => {
    text(`plan-stat-${i}-v`, v, statX + i * 150, y + bandH - 110, 44, c);
    text(`plan-stat-${i}-l`, l, statX + i * 150, y + bandH - 110 + 44 * LINE + 2, 13, C.darkBody);
  });
  y += bandH + 36;

  /* ── The crew: drag a name onto a card to hand it over ── */
  const owners = new Map<string, number>();
  for (const i of [...plan.cards, ...plan.decisions, ...plan.steps]) if (i.owner) owners.set(i.owner, (owners.get(i.owner) ?? 0) + 1);
  for (const slug of opts.people?.keys() ?? []) if (!owners.has(slug)) owners.set(slug, 0);
  text("plan-crew-eyebrow", T.crewGrid, left, y, 13, C.accent600);
  y += 13 * LINE + 12;
  let cx = 0;
  const crewW = W - PAD * 2;
  const crew = [...owners.entries()].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));
  for (const [slug, n] of crew) {
    const label = n ? `${name(slug)}  ${n}` : name(slug);
    const w = measure(label, 14) + 28;
    if (cx && cx + w > crewW) {
      cx = 0;
      y += 40;
    }
    const g = [`plan-crew-${slug}`];
    const ct = tag({ role: "crew", slug });
    rect(`plan-crew-${slug}`, left + cx, y, w, 32, n ? C.paper : C.subtle, n ? C.accent : C.hair, ct, { groupIds: g });
    text(`plan-crew-${slug}-t`, label, left + cx + 14, y + (32 - 14 * LINE) / 2, 14, n ? C.ink : C.muted, ct, g);
    boxes.set(`crew:${slug}`, { x: left + cx, y, width: w, height: 32 });
    cx += w + 8;
  }
  y += 32 + 40;

  /* ── The grid: fronts × horizons ── */
  const gridTop = y;
  const colX = (i: number) => left + LABEL_W + i * (COL_W + GAP);
  plan.horizons.forEach((h, i) => {
    const isNow = h.slug === now;
    const past = !!h.date && h.date < today;
    const hx = colX(i);
    if (isNow) rect(`plan-h-${h.slug}-now`, hx, y - 8, COL_W, 4, C.accent, C.accent, deco, { roundness: null });
    const eyebrow = isNow ? T.now : past ? T.past : h.date ? T.daysLeft(daysBetween(today, h.date)) : "";
    text(`plan-h-${h.slug}-e`, eyebrow, hx, y + 4, 12, isNow ? C.accent600 : past ? RED : C.muted);
    const hl = wrap(h.title, 18, COL_W - 8, measure).slice(0, 2);
    text(`plan-h-${h.slug}-t`, hl.join("\n"), hx, y + 4 + 12 * LINE + 4, 18, past ? C.muted : C.ink);
  });
  y += 4 + 12 * LINE + 4 + 2 * 18 * LINE + 16;
  hline("plan-grid-top", left, y, gridW, C.hair);
  y += 16;

  const cardBlock = (c: PlanItem, x: number, cy: number, width: number, role: "card" | "decision" | "step" | "risk"): number => {
    const g = [`plan-g-${c.slug}`];
    const ct = tag({ role, slug: c.slug });
    const titleLines = wrap(c.title, 15, width - 34, measure).slice(0, 4);
    const waits = role === "risk" ? [] : waitingOn(c, plan);
    const late = role !== "risk" && isOverdue(c, plan, today);
    const due = role === "risk" ? "" : dueOf(c, plan);
    const meta: string[] = [];
    if (role === "risk") meta.push(T.severityCaps[c.severity || "low"]);
    else meta.push(T.status[c.status].toUpperCase());
    if (c.owner) meta.push(name(c.owner));
    if (due && role !== "step") meta.push(late ? T.overdueSince(shortDate(due, today)) : T.until(shortDate(due, today)));
    const metaLine = meta.join(" · ");
    const waitLine = waits.length ? T.waitsOn(waits.map((w) => w.title).join(", ")) : "";
    const waitLines = waitLine ? wrap(waitLine, 12, width - 34, measure).slice(0, 2) : [];
    // A threat is a line on the card it threatens, not an arrow across the board.
    const threats = role === "risk" ? [] : plan.risks.filter((r) => r.affects.includes(c.slug));
    const threatLine = threats.length ? T.risk(threats.map((t) => t.title).join(" · ")) : "";
    const threatLines = threatLine ? wrap(threatLine, 12, width - 34, measure).slice(0, 2) : [];
    if (threatLines.length && wrap(threatLine, 12, width - 34, measure).length > 2) threatLines[1] = `${threatLines[1].replace(/.{0,2}$/, "")}…`;
    if (role === "risk" && c.affects.length) meta.push(T.threatens(c.affects.length));
    const extra = (waitLines.length ? 4 + waitLines.length * 12 * LINE : 0) + (threatLines.length ? 4 + threatLines.length * 12 * LINE : 0);
    const h = 14 + titleLines.length * 15 * LINE + 8 + 12 * LINE + extra + 14;
    const stroke = late || role === "risk" || threats.length ? "#fca5a5" : c.status === "blocked" ? "#fca5a5" : C.hair;
    const fill = role === "risk" ? RED_SOFT : c.status === "done" ? "#f0fdf4" : C.paper;
    rect(`plan-card-${c.slug}`, x, cy, width, h, fill, stroke, ct, { groupIds: g });
    rect(`plan-card-${c.slug}-s`, x, cy, 5, h, role === "risk" ? RED : STATUS_COLOR[c.status], role === "risk" ? RED : STATUS_COLOR[c.status], ct, { groupIds: g, roundness: null });
    text(`plan-card-${c.slug}-t`, titleLines.join("\n"), x + 18, cy + 14, 15, c.status === "done" ? C.muted : C.ink, ct, g);
    const my = cy + 14 + titleLines.length * 15 * LINE + 8;
    text(`plan-card-${c.slug}-m`, metaLine, x + 18, my, 12, late || role === "risk" ? RED : C.muted, ct, g);
    let ey = my + 12 * LINE + 4;
    if (waitLines.length) {
      text(`plan-card-${c.slug}-w`, waitLines.join("\n"), x + 18, ey, 12, "#b45309", ct, g);
      ey += waitLines.length * 12 * LINE + 4;
    }
    if (threatLines.length) text(`plan-card-${c.slug}-r`, threatLines.join("\n"), x + 18, ey, 12, RED, ct, g);
    boxes.set(c.slug, { x, y: cy, width, height: h });
    return h;
  };

  for (const f of plan.fronts) {
    const rowTop = y;
    let rowH = 0;
    // cards are drawn first to learn the row's height; the cells then go in
    // *before* them in the list, so they sit behind
    const rowMark = out.length;
    plan.horizons.forEach((h, i) => {
      let cy = rowTop;
      for (const c of plan.cards.filter((k) => k.front === f.slug && k.horizon === h.slug)) {
        cy += cardBlock(c, colX(i) + 12, cy, CARD_W, "card") + 10;
      }
      rowH = Math.max(rowH, cy - rowTop);
    });
    rowH = Math.max(rowH + 14, 92);
    // the cells: where a dropped card lands
    const rowCards = out.splice(rowMark);
    plan.horizons.forEach((h, i) => {
      const isNow = h.slug === now;
      rect(`plan-cell-${f.slug}-${h.slug}`, colX(i), rowTop - 8, COL_W, rowH + 4, isNow ? "#f0f9ff" : C.subtle, isNow ? "#bae6fd" : C.hair, deco);
      cells.push({ front: f.slug, horizon: h.slug, x: colX(i), y: rowTop - 8, width: COL_W, height: rowH + 4 });
    });
    out.push(...rowCards);
    const fc = plan.cards.filter((k) => k.front === f.slug);
    const fDone = fc.filter((k) => k.status === "done").length;
    const fl = wrap(f.title, 20, LABEL_W - 28, measure).slice(0, 3);
    text(`plan-f-${f.slug}-t`, fl.join("\n"), left, rowTop + 4, 20, C.ink, tag({ role: "decision", slug: f.slug }));
    text(`plan-f-${f.slug}-m`, `${T.frontDone(fDone, fc.length)}${f.owner ? ` · ${name(f.owner)}` : ""}`, left, rowTop + 4 + fl.length * 20 * LINE + 6, 13, C.muted);
    // progress bar
    const barW = LABEL_W - 40;
    rect(`plan-f-${f.slug}-bar`, left, rowTop + 4 + fl.length * 20 * LINE + 6 + 13 * LINE + 8, barW, 5, C.hair, C.hair, deco, { roundness: null });
    if (fc.length && fDone) rect(`plan-f-${f.slug}-barv`, left, rowTop + 4 + fl.length * 20 * LINE + 6 + 13 * LINE + 8, Math.max(4, (barW * fDone) / fc.length), 5, "#16a34a", "#16a34a", deco, { roundness: null });
    y = rowTop + rowH + 14;
  }
  const gridBottom = y;
  text("plan-grid-hint", T.gridHint, left, y + 4, 13, C.muted);
  y += 13 * LINE + 40;

  /* ── The rail: open decisions and risks ── */
  const railX = left + gridW + RAIL_GAP;
  let ry = gridTop;
  text("plan-dec-eyebrow", T.decisions(plan.decisions.filter((d) => d.status !== "done").length), railX, ry, 13, C.accent600);
  ry += 13 * LINE + 12;
  for (const d of plan.decisions) ry += cardBlock(d, railX, ry, RAIL_W, "decision") + 10;
  ry += 30;
  text("plan-risk-eyebrow", T.risks(plan.risks.length), railX, ry, 13, RED);
  ry += 13 * LINE + 12;
  for (const r of plan.risks) ry += cardBlock(r, railX, ry, RAIL_W, "risk") + 10;
  y = Math.max(y, ry + 40);

  /* ── How we work: processes as lanes ── */
  if (plan.processes.length) {
    hline("plan-proc-top", left, y, W - PAD * 2, C.hair);
    y += 36;
    text("plan-proc-eyebrow", T.processes, left, y, 13, C.accent600);
    y += 13 * LINE + 20;
    const stepW = 250;
    for (const p of plan.processes) {
      const steps = plan.steps.filter((s) => s.process === p.slug).sort((a, b) => a.order - b.order);
      const laneTop = y;
      const pl = wrap(p.title, 18, LABEL_W - 28, measure).slice(0, 3);
      text(`plan-p-${p.slug}-t`, pl.join("\n"), left, y + 4, 18, C.ink, tag({ role: "decision", slug: p.slug }));
      if (p.source) text(`plan-p-${p.slug}-s`, T.source(p.source.replace(/\[\[|\]\]/g, "")), left, y + 4 + pl.length * 18 * LINE + 6, 12, C.muted);
      let sx = left + LABEL_W;
      let laneH = 0;
      const perRow = Math.max(1, Math.floor((W - PAD * 2 - LABEL_W + 40) / (stepW + 40)));
      steps.forEach((s, i) => {
        if (i && i % perRow === 0) {
          sx = left + LABEL_W;
          y += laneH + 24;
          laneH = 0;
        }
        laneH = Math.max(laneH, cardBlock(s, sx, y, stepW, "step"));
        const next = steps[i + 1];
        if (next && (i + 1) % perRow !== 0) {
          push({
            type: "arrow",
            id: `plan-flow-${s.slug}`,
            x: sx + stepW + 6,
            y: y + 28,
            points: [[0, 0], [28, 0]],
            strokeColor: C.accent,
            strokeWidth: 2,
            roughness: 0,
            endArrowhead: "triangle",
            customData: deco,
            locked: true,
          });
        }
        sx += stepW + 40;
      });
      y += Math.max(laneH, pl.length * 18 * LINE + 30);
      lanes.push({ process: p.slug, y: laneTop, height: y - laneTop });
      y += 36;
    }
  }

  /* ── Dependencies and threats, drawn last so they sit on top ── */
  const edge = (from: string, to: string, kind: "dep" | "risk") => {
    const a = boxes.get(from);
    const b = boxes.get(to);
    if (!a || !b) return;
    const ax = a.x + a.width;
    const ay = a.y + a.height / 2;
    const bx = b.x;
    const by = b.y + b.height / 2;
    const [sx, sy, ex, ey] = bx >= ax ? [ax, ay, bx, by] : [a.x, ay, b.x + b.width, by];
    push({
      type: "arrow",
      id: `plan-${kind}-${from}--${to}`,
      x: sx,
      y: sy,
      points: [[0, 0], [ex - sx, ey - sy]],
      strokeColor: kind === "risk" ? RED : "#b45309",
      strokeWidth: 1.5,
      strokeStyle: kind === "risk" ? "dashed" : "solid",
      roughness: 0,
      endArrowhead: "triangle",
      start: { id: `plan-card-${from}` },
      end: { id: `plan-card-${to}` },
      customData: tag({ role: "dep", edge: `${kind}:${from}->${to}` }),
    });
  };
  for (const c of [...plan.cards, ...plan.decisions]) for (const d of c.depends_on) edge(d, c.slug, "dep");

  y += 20;
  text("plan-footer", T.footer(`${opts.root.replace(/^\/Users\/[^/]+/, "~")}/wiki/plan/`, today), left, y, 13, C.muted);
  y += 13 * LINE + PAD - 30;
  const H = y - o.y;
  (out[0] as unknown as { height: number }).height = H;
  void gridBottom;

  markShownTitles(out);
  const signature = JSON.stringify([today, [...plan.bySlug.values()].map((i) => i.raw), [...(opts.people ?? new Map()).entries()]]);
  return { skeletons: out, cells, boxes, bounds: { x: o.x, y: o.y, width: W, height: H }, lanes, signature };
}

/** Whose plan it is: `brand:` on the goal file. */
export function brandOf(plan: Plan): string {
  return /^brand:\s*"?([^"\n]+)"?\s*$/m.exec(plan.goal?.raw ?? "")?.[1]?.trim() ?? "";
}

/** The organisation's logo belongs on its own plan — one without a brand, or one with its name. */
export function ownPlan(brand: string, orgName: string): boolean {
  return !brand || (!!orgName && brand.trim().toLowerCase() === orgName.trim().toLowerCase());
}

/** The cell a point falls in. */
export function cellAt(cells: readonly PlanCell[], x: number, y: number): PlanCell | null {
  return cells.find((c) => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height) ?? null;
}

/* ───────────────────────────  Reading the board back  ─────────────────────────── */

/** The few element fields the diff needs — Excalidraw elements satisfy it. */
export interface BoardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  customData?: Record<string, unknown>;
}

export interface PlanDiff {
  patches: Map<string, PlanPatch>;
  creates: Array<{ slug: string; text: string }>;
  /** elements to take off the board after the write (drawn arrows, typed words) */
  remove: Set<string>;
  /** something was dragged that means nothing — it should snap back */
  drifted: boolean;
}

const tagOf = (e: BoardElement): PlanTag | null => {
  const t = e.customData?.lucidaPlan as PlanTag | undefined;
  return t && typeof t.root === "string" ? t : null;
};

/** "plan-card-<slug>" or one of its parts ("-s", "-t", …) → slug. */
export function cardSlugOfId(id: string | undefined, known: ReadonlySet<string>): string | null {
  if (!id?.startsWith("plan-card-")) return null;
  const rest = id.slice("plan-card-".length);
  if (known.has(rest)) return rest;
  const base = rest.replace(/-[stmw]$/, "");
  return known.has(base) ? base : null;
}

/**
 * What the user did on the board, as file changes: a card dragged to another
 * cell, a name dropped on a card, a step moved in its lane, a title typed, an
 * arrow drawn or deleted, a card deleted (archived — never removed from disk),
 * a word written into a cell (a new card). Pure, so every rule is testable.
 */
export function diffPlanBoard(
  scene: readonly BoardElement[],
  plan: Plan,
  layout: PlanLayout,
  opts: { today: string; exists: (slug: string) => boolean },
): PlanDiff {
  const byId = new Map(scene.map((e) => [e.id, e]));
  const patches = new Map<string, PlanPatch>();
  const add = (slug: string, p: PlanPatch) => patches.set(slug, { ...(patches.get(slug) ?? {}), ...p });
  const creates: PlanDiff["creates"] = [];
  const remove = new Set<string>();
  const known = new Set([...layout.boxes.keys()].filter((k) => !k.startsWith("crew:")));
  const moved = (id: string, key: string) => {
    const el = byId.get(id);
    const was = layout.boxes.get(key);
    if (!el || !was) return null;
    return Math.abs(el.x - was.x) > 4 || Math.abs(el.y - was.y) > 4 ? el : null;
  };
  let understood = false;

  // 1. moves
  for (const c of plan.cards) {
    const el = moved(`plan-card-${c.slug}`, c.slug);
    if (!el) continue;
    const cell = cellAt(layout.cells, el.x + el.width / 2, el.y + Math.min(el.height, 40) / 2);
    if (cell && (cell.front !== c.front || cell.horizon !== c.horizon)) add(c.slug, { front: cell.front, horizon: cell.horizon });
  }
  for (const lane of layout.lanes) {
    const steps = plan.steps.filter((st) => st.process === lane.process);
    if (!steps.some((st) => moved(`plan-card-${st.slug}`, st.slug))) continue;
    const pos = (slug: string) => {
      const el = byId.get(`plan-card-${slug}`);
      return el ? Math.round(el.y / 120) * 100000 + el.x : Infinity;
    };
    [...steps].sort((a, b) => pos(a.slug) - pos(b.slug)).forEach((st, i) => {
      if (st.order !== i + 1) add(st.slug, { order: i + 1 });
    });
  }
  for (const key of layout.boxes.keys()) {
    if (!key.startsWith("crew:")) continue;
    const person = key.slice(5);
    const el = moved(`plan-crew-${person}`, key);
    if (!el) continue;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    for (const slug of known) {
      const b = layout.boxes.get(slug)!;
      const item = plan.bySlug.get(slug);
      if (!item || item.kind === "risk") continue;
      if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height && item.owner !== person) add(slug, { owner: person });
    }
  }

  // 2. titles typed on the board
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  for (const e of scene) {
    if (e.type !== "text" || !e.text) continue;
    const t = tagOf(e);
    if (!t?.slug) continue;
    const item = plan.bySlug.get(t.slug);
    if (!TITLE_ID(e.id, t.slug) || !item || !norm(e.text)) continue;
    const shown = t.shown ?? item.title;
    if (norm(e.text) !== norm(shown)) add(t.slug, { title: norm(e.text) });
  }

  // 3. a card deleted on the board is archived, never deleted from disk
  for (const slug of known) if (!byId.has(`plan-card-${slug}`)) add(slug, { status: "archived" });

  // 4. arrows: drawn ones become dependencies (or threats), deleted ones are dropped
  for (const sk of layout.skeletons as unknown as Array<{ id?: string }>) {
    const m = sk.id ? /^plan-(dep|risk)-(.+)--(.+)$/.exec(sk.id) : null;
    if (!m || byId.has(sk.id!)) continue;
    const [, kind, from, to] = m;
    if (kind === "dep") {
      const item = plan.bySlug.get(to);
      if (item) add(to, { depends_on: (patches.get(to)?.depends_on ?? item.depends_on).filter((d) => d !== from) });
    } else {
      const risk = plan.bySlug.get(from);
      if (risk) add(from, { affects: (patches.get(from)?.affects ?? risk.affects).filter((a) => a !== to) });
    }
  }
  // An arrow may be bound to any part of a card (its frame, its stamp, its
  // title) — the part's own tag says which card it belongs to.
  const cardOf = (id: string | undefined): string | null => {
    const el = id ? byId.get(id) : undefined;
    const t = el ? tagOf(el) : null;
    if (t?.slug && t.role !== "crew" && known.has(t.slug)) return t.slug;
    return cardSlugOfId(id, known);
  };
  for (const e of scene) {
    if (e.type !== "arrow" || tagOf(e)) continue;
    const from = cardOf(e.startBinding?.elementId);
    const to = cardOf(e.endBinding?.elementId);
    if (!from || !to || from === to) continue;
    const a = plan.bySlug.get(from);
    const b = plan.bySlug.get(to);
    if (!a || !b) continue;
    remove.add(e.id);
    understood = true;
    if (a.kind === "risk") {
      const cur = patches.get(from)?.affects ?? a.affects;
      if (!cur.includes(to)) add(from, { affects: [...cur, to] });
    } else {
      const cur = patches.get(to)?.depends_on ?? b.depends_on;
      if (!cur.includes(from)) add(to, { depends_on: [...cur, from] });
    }
  }

  // 5. a word written into a cell is a new card there
  for (const e of scene) {
    if (e.type !== "text" || tagOf(e) || e.containerId || !e.text?.trim()) continue;
    const cell = cellAt(layout.cells, e.x + e.width / 2, e.y + e.height / 2);
    if (!cell) continue;
    const title = norm(e.text);
    const base = `${cell.front}-${slugify(title)}`.slice(0, 80).replace(/-+$/, "");
    let slug = base;
    for (let i = 2; opts.exists(slug) || creates.some((c) => c.slug === slug); i++) slug = `${base}-${i}`;
    creates.push({ slug, text: newCardFile(title, cell.front, cell.horizon, opts.today) });
    remove.add(e.id);
  }

  const drifted =
    !understood &&
    [...layout.boxes.keys()].some((k) => (k.startsWith("crew:") ? moved(`plan-crew-${k.slice(5)}`, k) : moved(`plan-card-${k}`, k)));
  return { patches, creates, remove, drifted };
}
