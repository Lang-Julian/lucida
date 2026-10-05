/**
 * The heist wall — the same plan as `layoutPlan`, drawn the way a crew plans
 * a coup: a cork board, the target in a manila dossier, the crew as
 * polaroids, the plan of attack as pinned index cards under strips of tape,
 * open calls on sticky notes, risks stamped red, and red string from pin to
 * pin wherever one thing waits on another.
 *
 * Only the look differs. Ids, drop cells, lanes and boxes follow exactly the
 * contract of `layoutPlan`, so dragging a card, dropping a name on it, typing
 * a title or drawing a string writes the same file changes (`diffPlanBoard`).
 */
import type { ExcalidrawElementSkeleton } from "./types";
import { estimateWidth, logoBox, wrap, wrapBalanced } from "./masterplan";
import { strings } from "./i18n";
import {
  currentHorizon,
  daysBetween,
  dueOf,
  isOverdue,
  shortDate,
  waitingOn,
  type Plan,
  type PlanCell,
  type PlanItem,
  type PlanLayout,
  type PlanLayoutOptions,
  type PlanTag,
  markShownTitles,
  brandOf,
  ownPlan,
} from "./plan";

/* ───────────────────────────  The wall  ─────────────────────────── */

export const WALL = {
  cork: "#b98c5f",
  corkDark: "#8a6440",
  frame: "#5a3c22",
  card: "#fbf8ef",
  cardRule: "#e05a5a",
  manila: "#ead7a4",
  manilaDark: "#c9b27a",
  sticky: "#fde68a",
  stickyDark: "#e9c94c",
  tape: "#f4ecd4",
  polaroid: "#fdfdfb",
  photo: "#262626",
  ink: "#1f2937",
  pencil: "#4b5563",
  red: "#c0262d",
  string: "#c41e24",
  pin: "#d42a2a",
  green: "#15803d",
  blue: "#1d4ed8",
  amber: "#b45309",
} as const;

/** Excalidraw font ids: hand-written notes, typewritten labels. */
const HAND = 5; // Excalifont
const TYPE = 3; // Cascadia
const LINE = 1.25;

const PAD = 110;
const LABEL_W = 280;
const COL_W = 380;
const GAP = 18;
const CARD_W = COL_W - 40;
const NOTE_W = 320;
const NOTE_GAP = 34;
const PIN = 16;

/** A small, stable tilt per item: the same card always hangs the same way. */
export function tilt(seed: string, maxDeg = 1.8): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const unit = ((h >>> 0) % 10000) / 10000; // 0..1
  return ((unit * 2 - 1) * maxDeg * Math.PI) / 180;
}

/** Typewriter text is monospaced; handwriting runs a little wide. */
function widthOf(text: string, fontSize: number, family: number, measure?: PlanLayoutOptions["measure"]): number {
  if (measure) return measure(text, fontSize, family);
  if (family === TYPE) return text.length * fontSize * 0.6;
  return estimateWidth(text, fontSize) * (family === HAND ? 1.12 : 1);
}

type Sk = Record<string, unknown> & { x: number; y: number; width?: number; height?: number };

export function layoutHeist(plan: Plan, opts: PlanLayoutOptions): PlanLayout {
  const today = opts.today;
  const T = strings(opts.lang ?? "de");
  const o = opts.origin ?? { x: 0, y: 0 };
  const w = (t: string, fs: number, fam: number) => widthOf(t, fs, fam, opts.measure);
  const wrapF = (t: string, fs: number, max: number, fam: number) => wrap(t, fs, max, (x, f) => w(x, f, fam));
  const tag = (t: Omit<PlanTag, "root">): { lucidaPlan: PlanTag } => ({ lucidaPlan: { root: opts.root, ...t } });
  const deco = tag({ role: "deco" });
  const name = (slug: string) => opts.people?.get(slug) ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const initials = (slug: string) =>
    name(slug)
      .replace(/^(Dr\.|Prof\.)\s+/i, "")
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const now = currentHorizon(plan, today);

  const out: ExcalidrawElementSkeleton[] = [];
  const pins: Sk[] = [];
  const pinAt = new Map<string, { x: number; y: number }>();
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const cells: PlanCell[] = [];
  const lanes: PlanLayout["lanes"] = [];
  const push = (sk: Sk) => out.push(sk as unknown as ExcalidrawElementSkeleton);

  const text = (id: string, t: string, x: number, y: number, fontSize: number, color: string, family: number, customData = deco, groupIds: string[] = []): Sk => {
    const lines = t.split("\n");
    return {
      type: "text",
      id,
      x,
      y,
      text: t,
      fontSize,
      fontFamily: family,
      lineHeight: LINE,
      strokeColor: color,
      roughness: 0,
      customData,
      groupIds,
      locked: customData === deco,
      width: Math.max(...lines.map((l) => w(l, fontSize, family))),
      height: lines.length * fontSize * LINE,
    };
  };
  const rect = (id: string, x: number, y: number, width: number, height: number, fill: string, stroke: string, customData = deco, extra: Record<string, unknown> = {}): Sk => ({
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
    roundness: null,
    customData,
    locked: customData === deco,
    ...extra,
  });
  /** A push pin, kept for the end so it sits on the string it holds. */
  const pin = (id: string, cx: number, cy: number, key?: string) => {
    pins.push({ type: "ellipse", id, x: cx - PIN / 2, y: cy - PIN / 2, width: PIN, height: PIN, backgroundColor: WALL.pin, fillStyle: "solid", strokeColor: "#7f1d1d", strokeWidth: 1, roughness: 0, customData: deco, locked: true });
    pins.push({ type: "ellipse", id: `${id}-hi`, x: cx - 4, y: cy - 5, width: 5, height: 5, backgroundColor: "#ffd5d5", fillStyle: "solid", strokeColor: "transparent", roughness: 0, customData: deco, locked: true });
    if (key) pinAt.set(key, { x: cx, y: cy });
  };
  /**
   * Hang a group of elements at a slight tilt around its own centre. Every
   * element turns with it, so the text stays on its card.
   */
  const hang = (items: Sk[], cx: number, cy: number, angle: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const it of items) {
      const iw = it.width ?? 0;
      const ih = it.height ?? 0;
      const ex = it.x + iw / 2 - cx;
      const ey = it.y + ih / 2 - cy;
      const nx = cx + ex * cos - ey * sin;
      const ny = cy + ex * sin + ey * cos;
      // the box an item is recognised by keeps its own x/y: Excalidraw turns
      // an element around its centre, so only the parts around it move
      if (it.keepXY) {
        delete it.keepXY;
      } else {
        it.x = nx - iw / 2;
        it.y = ny - ih / 2;
      }
      it.angle = angle;
      if (it.type === "text") {
        // text width is Excalidraw's to measure, not ours
        delete it.width;
        delete it.height;
      }
      push(it);
    }
  };
  /** A rubber stamp: a ruled frame and typewritten word, turned like a stamp is. */
  const stamp = (id: string, word: string, x: number, y: number, color: string, customData = deco, groupIds: string[] = [], size = 12): Sk[] => {
    const tw = w(word, size, TYPE);
    const fw = tw + 16;
    const fh = size * LINE + 8;
    return [
      rect(`${id}-st`, x, y, fw, fh, "transparent", color, customData, { strokeWidth: 2, groupIds, opacity: 85 }),
      { ...text(`${id}-sx`, word, x + 8, y + 4, size, color, TYPE, customData, groupIds), opacity: 85 },
    ];
  };

  /* ── The board itself ── */
  const nH = Math.max(1, plan.horizons.length);
  const gridW = LABEL_W + nH * COL_W + (nH - 1) * GAP;
  // open calls and risks hang in bands under the plan, not in a side column:
  // a side column of forty notes made the wall three times as tall as the plan
  const W = PAD + gridW + PAD;
  const left = o.x + PAD;
  const posterIndex = out.length;
  push(rect("plan-poster", o.x, o.y, W, 0, WALL.cork, WALL.frame, deco, { strokeWidth: 4 }));
  // cork grain: a faint cross-hatch over the board
  const grainIndex = out.length;
  push(rect("plan-cork-grain", o.x + 6, o.y + 6, W - 12, 0, WALL.corkDark, "transparent", deco, { fillStyle: "cross-hatch", roughness: 2, opacity: 18 }));

  /* ── The target: a manila dossier ── */
  let y = o.y + PAD;
  const goal = plan.goal;
  // Whose coup it is: `brand:` on the goal file, else the organisation. The
  // organisation's logo only hangs on its own plan.
  const orgName = opts.house?.name ?? "";
  const brand = brandOf(plan) || orgName;
  const showMark = !!opts.logo && ownPlan(brandOf(plan), orgName);
  const dossierW = Math.min(1500, gridW - 360);
  const dossierH = 300;
  {
    const items: Sk[] = [];
    const dx = left + 20;
    items.push(rect("plan-score-tab", dx + 40, y - 26, 220, 34, WALL.manilaDark, WALL.manilaDark, deco));
    items.push(text("plan-score-tabt", T.dossierTab, dx + 58, y - 18, 14, WALL.ink, TYPE));
    items.push(rect("plan-score", dx, y, dossierW, dossierH, WALL.manila, WALL.manilaDark, deco, { strokeWidth: 1.5 }));
    items.push(text("plan-score-eyebrow", `${T.objective}${brand ? ` · ${brand.toUpperCase()}` : ""}`, dx + 48, y + 36, 15, WALL.red, TYPE));
    const titleW = dossierW - 96 - 300;
    const gl = wrapBalanced(goal?.title ?? T.noGoal, 40, titleW, (x, f) => w(x, f, HAND)).slice(0, 3);
    items.push(text("plan-score-title", gl.join("\n"), dx + 48, y + 70, 40, WALL.ink, HAND, goal ? tag({ role: "decision", slug: goal.slug }) : deco));
    const first = goal?.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.replace(/\*\*/g, "") ?? "";
    if (first) {
      const bl = wrapF(first, 19, titleW, HAND).slice(0, 3);
      items.push(text("plan-score-body", bl.join("\n"), dx + 48, y + 70 + gl.length * 40 * LINE + 14, 19, WALL.pencil, HAND));
    }
    if (showMark && opts.logo) {
      const lb = logoBox(opts.logo.aspect);
      items.push({ type: "image", id: "plan-logo", x: dx + dossierW - 48 - lb.width, y: y + 30, width: lb.width, height: lb.height, fileId: opts.logo.fileId, customData: deco, locked: true });
    }
    if (goal?.date) items.push(...stamp("plan-score-stamp", T.goalStamp(shortDate(goal.date, today)), dx + dossierW - 260, y + dossierH - 80, WALL.red, deco, [], 18));
    hang(items, dx + dossierW / 2, y + dossierH / 2, tilt("goal", 0.6));
    pin("plan-score-pin", dx + dossierW / 2, y + 12);

    // the countdown on a sticky note, slapped on the dossier's corner
    const nx = dx + dossierW + 40;
    const note: Sk[] = [rect("plan-count", nx, y + 20, 280, 230, WALL.sticky, WALL.stickyDark, deco)];
    if (goal?.date) {
      const d = daysBetween(today, goal.date);
      const big = T.countBig(d);
      const size = Math.min(56, Math.floor(224 / Math.max(1, w(big, 1, HAND))));
      note.push(text("plan-count-v", big, nx + 26, y + 46, size, WALL.red, HAND));
      note.push(text("plan-count-l", T.countSmall(d, shortDate(goal.date, today)), nx + 28, y + 50 + 60 * LINE + 4, 20, WALL.ink, HAND));
    }
    const cards = plan.cards;
    const done = cards.filter((c) => c.status === "done").length;
    const blocked = cards.filter((c) => c.status === "blocked" || waitingOn(c, plan).length > 0).length;
    const overdue = cards.filter((c) => isOverdue(c, plan, today)).length;
    note.push(text("plan-count-s", T.tally(done, cards.length, blocked, overdue), nx + 28, y + 160, 15, overdue ? WALL.red : WALL.ink, TYPE));
    hang(note, nx + 140, y + 135, tilt("countdown", 4));
    pin("plan-count-pin", nx + 140, y + 30);
  }
  y += dossierH + 70;

  /* ── The crew: polaroids. Drag one onto a card to hand it over. ── */
  const owners = new Map<string, number>();
  for (const i of [...plan.cards, ...plan.decisions, ...plan.steps]) if (i.owner) owners.set(i.owner, (owners.get(i.owner) ?? 0) + 1);
  for (const slug of opts.people?.keys() ?? []) if (!owners.has(slug)) owners.set(slug, 0);
  push(text("plan-crew-eyebrow", T.crewWall, left, y, 15, WALL.ink, TYPE));
  y += 15 * LINE + 26;
  const crew = [...owners.entries()].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));
  const PW = 132;
  const PH = 172;
  let cx = 0;
  for (const [slug, n] of crew) {
    if (cx && cx + PW > W - PAD * 2) {
      cx = 0;
      y += PH + 36;
    }
    const px = left + cx;
    const g = [`plan-crew-${slug}`];
    const ct = tag({ role: "crew", slug });
    const items: Sk[] = [
      { ...rect(`plan-crew-${slug}`, px, y, PW, PH, WALL.polaroid, "#d4d4d4", ct, { groupIds: g }), keepXY: true },
      rect(`plan-crew-${slug}-ph`, px + 10, y + 10, PW - 20, PW - 20, n ? WALL.photo : "#6b6b6b", "transparent", ct, { groupIds: g }),
      text(`plan-crew-${slug}-i`, initials(slug), px + PW / 2 - w(initials(slug), 40, HAND) / 2, y + 10 + (PW - 20) / 2 - 25, 40, "#f5f5f5", HAND, ct, g),
      text(`plan-crew-${slug}-t`, wrapF(name(slug), 14, PW - 16, HAND).slice(0, 1).join(""), px + 8, y + PW - 4, 14, WALL.ink, HAND, ct, g),
      text(`plan-crew-${slug}-n`, n ? T.cards(n) : T.free, px + 8, y + PW + 16, 11, n ? WALL.red : WALL.pencil, TYPE, ct, g),
    ];
    hang(items, px + PW / 2, y + PH / 2, tilt(`crew-${slug}`, 4));
    pin(`plan-crew-${slug}-pin`, px + PW / 2, y + 6);
    boxes.set(`crew:${slug}`, { x: px, y, width: PW, height: PH });
    cx += PW + 22;
  }
  y += PH + 70;

  /* ── The plan of attack: tape strips over the columns ── */
  const colX = (i: number) => left + LABEL_W + i * (COL_W + GAP);
  plan.horizons.forEach((h, i) => {
    const isNow = h.slug === now;
    const past = !!h.date && h.date < today;
    const hx = colX(i);
    const items: Sk[] = [rect(`plan-h-${h.slug}-tape`, hx + 10, y, COL_W - 20, 64, WALL.tape, "#e6dcbd", deco, { opacity: 92 })];
    const hl = wrapF(h.title, 19, COL_W - 60, HAND).slice(0, 2);
    items.push(text(`plan-h-${h.slug}-t`, hl.join("\n"), hx + 28, y + 10, 19, past ? WALL.pencil : WALL.ink, HAND));
    hang(items, hx + COL_W / 2, y + 32, tilt(`h-${h.slug}`, 1.5));
    const word = isNow ? T.now : past ? T.past : h.date ? T.daysLeft(daysBetween(today, h.date)) : "";
    if (word) {
      const st = stamp(`plan-h-${h.slug}-e`, word, hx + COL_W - 40 - w(word, 12, TYPE), y + 58, isNow || past ? WALL.red : WALL.ink);
      hang(st, hx + COL_W - 60, y + 70, tilt(`hs-${h.slug}`, 6));
    }
  });
  y += 110;

  /**
   * One pinned card. Index cards for the plan, sticky notes for open calls,
   * red-ruled cards for risks; status is a stamp, not a colour bar.
   */
  const cardBlock = (c: PlanItem, x: number, cy: number, width: number, role: "card" | "decision" | "step" | "risk"): number => {
    const g = [`plan-g-${c.slug}`];
    const ct = tag({ role, slug: c.slug });
    const sticky = role === "decision";
    const fs = sticky ? 18 : 16;
    const titleLines = wrapF(c.title, fs, width - 40, HAND).slice(0, 4);
    const waits = role === "risk" ? [] : waitingOn(c, plan);
    const late = role !== "risk" && isOverdue(c, plan, today);
    const due = role === "risk" ? "" : dueOf(c, plan);
    const meta: string[] = [];
    if (c.owner) meta.push(`@${initials(c.owner)}`);
    if (due && role !== "step") meta.push(T.until(shortDate(due, today)));
    if (role === "risk" && c.affects.length) meta.push(T.hits(c.affects.length));
    const metaLine = meta.join(" · ").toUpperCase();
    const waitLines = waits.length ? wrapF(T.waitsOn(waits.map((x2) => x2.title).join(", ")), 13, width - 40, HAND).slice(0, 2) : [];
    const threats = role === "risk" ? [] : plan.risks.filter((r) => r.affects.includes(c.slug));
    const threatLines = threats.length ? wrapF(T.risk(threats.map((t) => t.title).join(" · ")), 13, width - 40, HAND).slice(0, 2) : [];
    const word =
      role === "risk"
        ? c.severity === "high"
          ? T.stamp.riskHigh
          : c.severity === "medium"
            ? T.stamp.risk
            : T.stamp.riskLow
        : c.status === "done"
          ? T.stamp.done
          : c.status === "blocked"
            ? T.stamp.blocked
            : c.status === "doing"
              ? T.stamp.doing
              : late
                ? T.stamp.late
                : "";
    const stampColor = role === "risk" || c.status === "blocked" || late ? WALL.red : c.status === "done" ? WALL.green : WALL.blue;
    const top = 22;
    const bodyH =
      titleLines.length * fs * LINE +
      10 +
      (metaLine || word ? 22 : 0) +
      (waitLines.length ? 6 + waitLines.length * 13 * LINE : 0) +
      (threatLines.length ? 6 + threatLines.length * 13 * LINE : 0);
    const h = Math.max(sticky ? 120 : 84, top + bodyH + 16);
    const fill = sticky ? WALL.sticky : role === "risk" ? "#fff5f5" : WALL.card;
    const items: Sk[] = [
      { ...rect(`plan-card-${c.slug}`, x, cy, width, h, fill, sticky ? WALL.stickyDark : role === "risk" ? "#f3b3b3" : "#e2dccb", ct, { groupIds: g }), keepXY: true },
    ];
    // an index card has its red rule; a risk card a red band
    if (!sticky) items.push(rect(`plan-card-${c.slug}-s`, x + 10, cy + 14, width - 20, role === "risk" ? 4 : 1.5, role === "risk" ? WALL.red : WALL.cardRule, "transparent", ct, { groupIds: g }));
    let ty = cy + top;
    items.push(text(`plan-card-${c.slug}-t`, titleLines.join("\n"), x + 18, ty, fs, c.status === "done" ? WALL.pencil : WALL.ink, HAND, ct, g));
    ty += titleLines.length * fs * LINE + 10;
    if (word) items.push(...stamp(`plan-card-${c.slug}`, word, x + width - 26 - w(word, 11, TYPE), ty - 2, stampColor, ct, g, 11));
    if (metaLine) items.push(text(`plan-card-${c.slug}-m`, metaLine, x + 18, ty + 2, 11, late ? WALL.red : WALL.pencil, TYPE, ct, g));
    if (metaLine || word) ty += 22;
    if (waitLines.length) {
      items.push(text(`plan-card-${c.slug}-w`, waitLines.join("\n"), x + 18, ty + 6, 13, WALL.amber, HAND, ct, g));
      ty += 6 + waitLines.length * 13 * LINE;
    }
    if (threatLines.length) items.push(text(`plan-card-${c.slug}-r`, threatLines.join("\n"), x + 18, ty + 6, 13, WALL.red, HAND, ct, g));
    const angle = tilt(c.slug, sticky ? 3 : 1.6);
    hang(items, x + width / 2, cy + h / 2, angle);
    // the pin sits where the card's top centre ended up after the tilt
    const px = x + width / 2 + (-(h / 2 - 8)) * -Math.sin(angle);
    const py = cy + h / 2 + -(h / 2 - 8) * Math.cos(angle);
    pin(`plan-card-${c.slug}-pin`, px, py, c.slug);
    boxes.set(c.slug, { x, y: cy, width, height: h });
    return h;
  };

  for (const f of plan.fronts) {
    const rowTop = y;
    let rowH = 0;
    const rowMark = out.length;
    plan.horizons.forEach((h, i) => {
      let cy = rowTop;
      for (const c of plan.cards.filter((k) => k.front === f.slug && k.horizon === h.slug)) {
        cy += cardBlock(c, colX(i) + 20, cy, CARD_W, "card") + 26;
      }
      rowH = Math.max(rowH, cy - rowTop);
    });
    rowH = Math.max(rowH + 10, 120);
    // the drop zones, behind the cards: a chalked outline, lighter where it is now
    const rowCards = out.splice(rowMark);
    plan.horizons.forEach((h, i) => {
      const isNow = h.slug === now;
      push(
        rect(`plan-cell-${f.slug}-${h.slug}`, colX(i), rowTop - 14, COL_W, rowH + 8, isNow ? "#f6e7cf" : "transparent", WALL.corkDark, deco, {
          strokeStyle: "dashed",
          opacity: isNow ? 30 : 45,
          roundness: { type: 3 },
        }),
      );
      cells.push({ front: f.slug, horizon: h.slug, x: colX(i), y: rowTop - 14, width: COL_W, height: rowH + 8 });
    });
    out.push(...rowCards);
    // the front's own card on the left edge
    const fc = plan.cards.filter((k) => k.front === f.slug);
    const fDone = fc.filter((k) => k.status === "done").length;
    const fl = wrapF(f.title, 22, LABEL_W - 70, HAND).slice(0, 3);
    const fh = 34 + fl.length * 22 * LINE + 50;
    const items: Sk[] = [
      rect(`plan-f-${f.slug}-card`, left, rowTop, LABEL_W - 30, fh, WALL.card, "#e2dccb"),
      rect(`plan-f-${f.slug}-rule`, left + 10, rowTop + 14, LABEL_W - 50, 3, WALL.red, "transparent"),
      text(`plan-f-${f.slug}-t`, fl.join("\n"), left + 18, rowTop + 26, 22, WALL.ink, HAND, tag({ role: "decision", slug: f.slug })),
      text(`plan-f-${f.slug}-m`, `${T.frontDone(fDone, fc.length).toUpperCase()}${f.owner ? ` · @${initials(f.owner)}` : ""}`, left + 18, rowTop + 26 + fl.length * 22 * LINE + 10, 11, WALL.pencil, TYPE),
    ];
    hang(items, left + (LABEL_W - 30) / 2, rowTop + fh / 2, tilt(`f-${f.slug}`, 1.2));
    pin(`plan-f-${f.slug}-pin`, left + (LABEL_W - 30) / 2, rowTop + 8);
    y = rowTop + rowH + 34;
  }
  push(text("plan-grid-hint", T.gridHintWall, left, y, 13, WALL.ink, TYPE));
  y += 13 * LINE + 60;

  /* ── Open calls and risks: bands of notes under the plan ── */
  const band = (label: string, color: string, items: PlanItem[], role: "decision" | "risk", id: string) => {
    if (!items.length) return;
    push(text(id, label, left, y, 15, color, TYPE));
    y += 15 * LINE + 30;
    const perRow = Math.max(1, Math.floor((gridW + NOTE_GAP) / (NOTE_W + NOTE_GAP)));
    for (let i = 0; i < items.length; i += perRow) {
      let rowH = 0;
      items.slice(i, i + perRow).forEach((it, j) => {
        rowH = Math.max(rowH, cardBlock(it, left + j * (NOTE_W + NOTE_GAP), y, NOTE_W, role));
      });
      y += rowH + 34;
    }
    y += 40;
  };
  band(T.decisions(plan.decisions.filter((d) => d.status !== "done").length), WALL.ink, plan.decisions, "decision", "plan-dec-eyebrow");
  band(T.risksWall(plan.risks.length), WALL.red, plan.risks, "risk", "plan-risk-eyebrow");
  /* ── How the job runs: each process a row of cards on one string ── */
  if (plan.processes.length) {
    push(text("plan-proc-eyebrow", T.processesWall, left, y, 15, WALL.ink, TYPE));
    y += 15 * LINE + 30;
    const stepW = 260;
    const perRow = Math.max(1, Math.floor((W - PAD * 2 - LABEL_W + 40) / (stepW + 40)));
    for (const p of plan.processes) {
      const steps = plan.steps.filter((s) => s.process === p.slug).sort((a, b) => a.order - b.order);
      const laneTop = y;
      const pl = wrapF(p.title, 20, LABEL_W - 60, HAND).slice(0, 3);
      push(text(`plan-p-${p.slug}-t`, pl.join("\n"), left, y + 10, 20, WALL.ink, HAND, tag({ role: "decision", slug: p.slug })));
      if (p.source) push(text(`plan-p-${p.slug}-s`, T.source(p.source.replace(/\[\[|\]\]/g, "")).toUpperCase(), left, y + 10 + pl.length * 20 * LINE + 8, 11, WALL.pencil, TYPE));
      let sx = left + LABEL_W;
      let laneH = 0;
      steps.forEach((s, i) => {
        if (i && i % perRow === 0) {
          sx = left + LABEL_W;
          y += laneH + 36;
          laneH = 0;
        }
        laneH = Math.max(laneH, cardBlock(s, sx, y, stepW, "step"));
        sx += stepW + 40;
      });
      y += Math.max(laneH, pl.length * 20 * LINE + 40);
      lanes.push({ process: p.slug, y: laneTop, height: y - laneTop });
      // the steps hang on one string, in order
      for (let i = 0; i + 1 < steps.length; i++) thread(`plan-flow-${steps[i].slug}`, steps[i].slug, steps[i + 1].slug, "flow");
      y += 50;
    }
  }

  /* ── Red string, pin to pin, sagging a little ── */
  function thread(id: string, from: string, to: string, kind: "dep" | "risk" | "flow") {
    const a = pinAt.get(from);
    const b = pinAt.get(to);
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    // a process's string is pulled taut above its cards, so it never runs
    // through their text; a dependency hangs loose
    const sag = kind === "flow" ? -18 : Math.min(90, 14 + dist * 0.08);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + sag;
    push({
      type: "line",
      id,
      x: a.x,
      y: a.y,
      points: [
        [0, 0],
        [mx - a.x, my - a.y],
        [b.x - a.x, b.y - a.y],
      ],
      strokeColor: kind === "flow" ? "#7a1418" : WALL.string,
      strokeWidth: kind === "risk" ? 1.5 : 2.5,
      opacity: kind === "risk" ? 55 : kind === "flow" ? 70 : 92,
      roughness: 0,
      roundness: { type: 2 },
      customData: kind === "flow" ? deco : tag({ role: "dep", edge: `${kind}:${from}->${to}` }),
      locked: kind === "flow",
    });
  }
  for (const c of [...plan.cards, ...plan.decisions]) for (const d of c.depends_on) thread(`plan-dep-${d}--${c.slug}`, d, c.slug, "dep");
  // Risks get no string: forty threads across the wall hid the plan. Each
  // threatened card carries the risk in red instead; a string a user draws
  // from a risk to a card is still read as "affects".
  for (const p of pins) push(p);

  y += 10;
  push(text("plan-footer", T.footerWall(`${opts.root.replace(/^\/Users\/[^/]+/, "~")}/wiki/plan/`, today), left, y, 12, WALL.ink, TYPE));
  y += 12 * LINE + PAD - 40;

  const H = y - o.y;
  (out[posterIndex] as unknown as { height: number }).height = H;
  (out[grainIndex] as unknown as { height: number }).height = H - 12;

  // text sizes were only ours for layout; Excalidraw measures the real ones
  for (const sk of out as unknown as Sk[]) {
    if (sk.type === "text") {
      delete sk.width;
      delete sk.height;
    }
  }
  markShownTitles(out);
  const signature = JSON.stringify(["heist", today, [...plan.bySlug.values()].map((i) => i.raw), [...(opts.people ?? new Map()).entries()]]);
  return { skeletons: out, cells, boxes, bounds: { x: o.x, y: o.y, width: W, height: H }, lanes, signature };
}
