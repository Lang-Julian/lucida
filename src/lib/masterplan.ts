/**
 * Masterplan → infographic.
 *
 * An agent that has understood a plan hands over its structure — a title, the
 * phases or pillars, a goal, the numbers that matter — and this module lays it
 * out as one finished poster in the organisation's house style. Pure geometry:
 * no React, no network. The canvas turns the skeletons into elements and fills
 * the image slots with generated pictures afterwards.
 *
 * The look: cool charcoal on white, the organisation's one accent colour (see
 * house.ts), eyebrows in its darker shade, big numbers, hairline borders, a
 * lot of air. Everything is `roughness: 0` — a board sketch is the input, this
 * is the output that goes in front of a customer.
 */
import type { ExcalidrawElementSkeleton } from "./types";
import { DEFAULT_HOUSE, type House } from "./house";

/* ───────────────────────────  Contract  ─────────────────────────── */

export interface MasterplanKpi {
  /** the number itself, as it should read: "< 50 ms", "99 %", "12" */
  value: string;
  label: string;
}

export interface MasterplanPhase {
  title: string;
  /** when: "Q1 2027", "Monat 1–3" */
  period?: string;
  /** one or two sentences */
  summary?: string;
  /** the concrete steps, short */
  points?: string[];
  /** what to draw for this phase, as a concrete object ("a server rack") */
  image?: string;
  /** the one number this phase is measured by */
  kpi?: MasterplanKpi;
}

export interface MasterplanSpec {
  title: string;
  subtitle?: string;
  /** small line above the title; defaults to "<ORGANISATION> · MASTERPLAN" */
  eyebrow?: string;
  /** "sequence" draws a numbered timeline; "parallel" draws pillars side by side */
  flow?: "sequence" | "parallel";
  phases: MasterplanPhase[];
  /** headline numbers across the top, at most four */
  kpis?: MasterplanKpi[];
  /** where it all leads — drawn as the dark band at the bottom */
  goal?: { title: string; text?: string; image?: string };
  /** bottom line, e.g. an owner and a date */
  footer?: string;
  /** labels the poster itself uses ("Ziel", "Phase"); default "de" */
  lang?: "de" | "en";
  /** "sans" (Helvetica, closest to the site's Inter) or "rounded" (Nunito) */
  typeface?: "sans" | "rounded";
}

/** A place a generated picture goes, in scene coordinates. */
export interface ImageSlot {
  subject: string;
  x: number;
  y: number;
  size: number;
  /** the group the picture joins, so it moves with its card */
  groupIds: string[];
  /** it sits on the dark goal band, so it has to be drawn light */
  onDark?: boolean;
}

export interface MasterplanLayout {
  skeletons: ExcalidrawElementSkeleton[];
  slots: ImageSlot[];
  /** outer bounds of the poster */
  bounds: { x: number; y: number; width: number; height: number };
  /** one line per thing that was shortened or dropped to fit */
  notes: string[];
}

export interface LayoutOptions {
  /** top-left corner of the poster */
  origin?: { x: number; y: number };
  /** reserve and return image slots (false when there is no image model) */
  images?: boolean;
  /** width of a line of text in px; the default is an estimate */
  measure?: (text: string, fontSize: number, fontFamily: number) => number;
  /** makes group ids unique per poster */
  id?: string;
  /** the organisation's look; the default house style without one */
  house?: House;
  /** the organisation's logo, already added to the scene, and its width/height */
  logo?: { fileId: string; aspect: number };
}

/* ───────────────────────────  House style  ─────────────────────────── */

/** Text faces Excalidraw ships: Helvetica (neutral, the default) or Nunito. */
export const TYPEFACES = { sans: 2, rounded: 6 } as const;
const LINE = 1.25;

const MAX_PHASES = 8;
const MAX_POINTS = 5;
const MAX_KPIS = 4;
/** Up to this many phases share one row; more split into two balanced rows. */
const ONE_ROW_MAX = 5;

const PAD = 72; // poster padding
const COL = 360; // card width
const GAP = 40; // between cards
const CARD_PAD = 28;
const NODE = 44; // timeline circle
const IMG = 184; // picture in a card
const GOAL_IMG = 200;
const ACCENT_BAR = 4 + 16; // a pillar's accent mark, and the air below it

/** The logo's box: a fixed height, as wide as its own shape asks, within reason. */
export function logoBox(aspect: number): { width: number; height: number } {
  const height = 64;
  return { width: Math.round(Math.min(260, Math.max(48, height * (aspect || 1)))), height };
}

const LABELS = {
  de: { eyebrow: "MASTERPLAN", goal: "ZIEL", phase: "PHASE" },
  en: { eyebrow: "MASTERPLAN", goal: "GOAL", phase: "PHASE" },
} as const;

/* ───────────────────────────  Text  ─────────────────────────── */

/**
 * Nunito averages a little over half its size per character. Slightly
 * generous on purpose: a line wrapped one word early looks fine, a line that
 * runs past its card does not.
 */
export function estimateWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.28;
    else if (/[ilIj.,:;'!|]/.test(ch)) w += 0.3;
    else if (/[mwMW@%]/.test(ch)) w += 0.86;
    else if (/[A-ZÄÖÜ0-9]/.test(ch)) w += 0.66;
    else w += 0.54;
  }
  return w * fontSize;
}

/** Greedy word wrap; a single word longer than the line is hard-broken. */
export function wrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (t: string, fs: number) => number = estimateWidth,
): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, fontSize) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, fontSize) <= maxWidth) {
        line = word;
        continue;
      }
      // hard-break a word that cannot fit on any line
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch, fontSize) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Wrap to the same number of lines, but as narrow as that allows — CSS's
 * `text-wrap: balance`, which the design system asks for on every multi-line
 * headline. No lonely last word under a long first line.
 */
export function wrapBalanced(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: (t: string, fs: number) => number = estimateWidth,
): string[] {
  const greedy = wrap(text, fontSize, maxWidth, measure);
  if (greedy.length < 2) return greedy;
  let lo = maxWidth * 0.4;
  let hi = maxWidth;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(text, fontSize, mid, measure).length > greedy.length) lo = mid;
    else hi = mid;
  }
  return wrap(text, fontSize, hi, measure);
}

const clean = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/* ───────────────────────────  Layout  ─────────────────────────── */

/** Validate and trim an agent's spec; never throws on a merely untidy one. */
export function normalizeSpec(raw: unknown): { spec: MasterplanSpec; notes: string[] } {
  const notes: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = clean(r.title as string);
  if (!title) throw new Error("A masterplan needs a title");
  const rawPhases = Array.isArray(r.phases) ? (r.phases as Record<string, unknown>[]) : [];
  const phases: MasterplanPhase[] = rawPhases
    .filter((p) => p && clean(p.title as string))
    .map((p) => {
      const points = Array.isArray(p.points) ? (p.points as unknown[]).map((x) => clean(String(x))).filter(Boolean) : [];
      if (points.length > MAX_POINTS) notes.push(`"${clean(p.title as string)}": kept ${MAX_POINTS} of ${points.length} points`);
      const kpi = p.kpi as Record<string, unknown> | undefined;
      return {
        title: clean(p.title as string),
        period: clean(p.period as string) || undefined,
        summary: clean(p.summary as string) || undefined,
        points: points.slice(0, MAX_POINTS),
        image: clean(p.image as string) || undefined,
        kpi: kpi && clean(kpi.value as string) ? { value: clean(kpi.value as string), label: clean(kpi.label as string) } : undefined,
      };
    });
  if (!phases.length) throw new Error("A masterplan needs at least one phase with a title");
  if (phases.length > MAX_PHASES) notes.push(`kept ${MAX_PHASES} of ${phases.length} phases`);
  const kpis = (Array.isArray(r.kpis) ? (r.kpis as Record<string, unknown>[]) : [])
    .filter((k) => k && clean(k.value as string))
    .map((k) => ({ value: clean(k.value as string), label: clean(k.label as string) }));
  if (kpis.length > MAX_KPIS) notes.push(`kept ${MAX_KPIS} of ${kpis.length} headline numbers`);
  const goal = r.goal as Record<string, unknown> | undefined;
  return {
    spec: {
      title,
      subtitle: clean(r.subtitle as string) || undefined,
      eyebrow: clean(r.eyebrow as string) || undefined,
      flow: r.flow === "parallel" ? "parallel" : "sequence",
      phases: phases.slice(0, MAX_PHASES),
      kpis: kpis.slice(0, MAX_KPIS),
      goal: goal && clean(goal.title as string)
        ? { title: clean(goal.title as string), text: clean(goal.text as string) || undefined, image: clean(goal.image as string) || undefined }
        : undefined,
      footer: clean(r.footer as string) || undefined,
      lang: r.lang === "en" ? "en" : "de",
      typeface: r.typeface === "rounded" ? "rounded" : "sans",
    },
    notes,
  };
}

/**
 * Lay the plan out. Phases run left to right, at most four to a row; every
 * card in a row shares one height so the row reads as one band, and a card's
 * number sits at its bottom edge whatever the text above it.
 */
export function layoutMasterplan(spec: MasterplanSpec, opts: LayoutOptions = {}): MasterplanLayout {
  const C = opts.house ?? DEFAULT_HOUSE;
  const FONT = TYPEFACES[spec.typeface ?? "sans"];
  const measure = (t: string, fs: number) => (opts.measure ?? estimateWidth)(t, fs, FONT);
  const withImages = opts.images !== false;
  const o = opts.origin ?? { x: 0, y: 0 };
  const gid = opts.id ?? "mp";
  const poster = `${gid}-poster`;
  const L = LABELS[spec.lang ?? "de"];
  const sequence = spec.flow !== "parallel";
  const phases = spec.phases.slice(0, MAX_PHASES);

  // Five fit one row; six to eight split evenly, so no phase is left alone.
  const rows = phases.length <= ONE_ROW_MAX ? 1 : 2;
  const perRow = Math.ceil(phases.length / rows);
  const innerW = perRow * COL + (perRow - 1) * GAP;
  const W = innerW + PAD * 2;
  const left = o.x + PAD;

  const out: ExcalidrawElementSkeleton[] = [];
  const slots: ImageSlot[] = [];
  const notes: string[] = [];

  const text = (
    t: string,
    x: number,
    y: number,
    fontSize: number,
    color: string,
    groups: string[],
    extra: Record<string, unknown> = {},
  ) => {
    out.push({
      type: "text",
      x,
      y,
      text: t,
      fontSize,
      fontFamily: FONT,
      lineHeight: LINE,
      strokeColor: color,
      roughness: 0,
      groupIds: groups,
      ...extra,
    } as unknown as ExcalidrawElementSkeleton);
  };
  const block = (
    t: string,
    x: number,
    y: number,
    fontSize: number,
    color: string,
    maxW: number,
    groups: string[],
  ): number => {
    const lines = wrapBalanced(t, fontSize, maxW, measure);
    if (!lines.length) return 0;
    text(lines.join("\n"), x, y, fontSize, color, groups);
    return lines.length * fontSize * LINE;
  };
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke: string,
    groups: string[],
    extra: Record<string, unknown> = {},
  ) => {
    out.push({
      type: "rectangle",
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
      groupIds: groups,
      ...extra,
    } as unknown as ExcalidrawElementSkeleton);
  };
  const line = (x: number, y: number, dx: number, dy: number, color: string, width: number, groups: string[]) => {
    out.push({
      type: "line",
      x,
      y,
      points: [
        [0, 0],
        [dx, dy],
      ],
      strokeColor: color,
      strokeWidth: width,
      roughness: 0,
      groupIds: groups,
    } as unknown as ExcalidrawElementSkeleton);
  };

  // The poster itself goes first so it is at the back; its height is known
  // only at the end, so it is patched in place.
  const posterIndex = out.length;
  rect(o.x, o.y, W, 0, C.paper, C.hair, [poster], { roundness: { type: 3 } });

  /* ── Header ── */
  let y = o.y + PAD;
  const logo = opts.logo ? logoBox(opts.logo.aspect) : null;
  const headW = innerW - (logo ? logo.width + 32 : 0);
  const eyebrow = spec.eyebrow ?? (C.name ? `${C.name} · ${L.eyebrow}` : L.eyebrow);
  text(eyebrow.toUpperCase(), left, y, 15, C.accent600, [poster]);
  if (opts.logo && logo) {
    out.push({
      type: "image",
      x: left + innerW - logo.width,
      y: y - 6,
      width: logo.width,
      height: logo.height,
      fileId: opts.logo.fileId,
      groupIds: [poster],
    } as unknown as ExcalidrawElementSkeleton);
  }
  y += 15 * LINE + 14;
  y += block(spec.title, left, y, 56, C.ink, headW, [poster]);
  if (spec.subtitle) {
    y += 14;
    y += block(spec.subtitle, left, y, 22, C.body, Math.min(headW, 880), [poster]);
  }
  y = Math.max(y, o.y + PAD + (logo?.height ?? 0)) + 36;

  /* ── Headline numbers ── */
  const kpis = (spec.kpis ?? []).slice(0, MAX_KPIS);
  if (kpis.length) {
    line(left, y, innerW, 0, C.hair, 1, [poster]);
    y += 28;
    const kw = innerW / kpis.length;
    let tallest = 0;
    kpis.forEach((k, i) => {
      const kx = left + i * kw;
      const g = [`${gid}-kpi-${i}`, poster];
      text(k.value, kx, y, 46, C.accent700, g);
      const h = block(k.label, kx, y + 46 * LINE + 4, 15, C.muted, kw - 32, g);
      tallest = Math.max(tallest, 46 * LINE + 4 + h);
      if (i > 0) line(kx - 20, y + 4, 0, 46 * LINE + 22, C.hair, 1, [poster]);
    });
    y += tallest + 28;
    line(left, y, innerW, 0, C.hair, 1, [poster]);
    y += 44;
  } else {
    line(left, y, innerW, 0, C.hair, 1, [poster]);
    y += 44;
  }

  /* ── Phases ── */
  const textW = COL - CARD_PAD * 2;
  // Measure every card first, so each row can share its tallest height.
  interface Measured {
    period: string[];
    title: string[];
    summary: string[];
    points: string[][];
    body: number; // everything above the number
    kpi: number;
  }
  const measured: Measured[] = phases.map((p, i) => {
    const period = wrap(
      [sequence ? `${L.phase} ${String(i + 1).padStart(2, "0")}` : "", p.period ?? ""].filter(Boolean).join(" · ").toUpperCase(),
      13,
      textW,
      measure,
    );
    const title = wrap(p.title, 26, textW, measure);
    const summary = p.summary ? wrap(p.summary, 17, textW, measure) : [];
    const points = (p.points ?? []).map((pt) => wrap(pt, 16, textW - 20, measure));
    let body = CARD_PAD + (sequence ? 0 : ACCENT_BAR);
    if (period.length) body += period.length * 13 * LINE + 10;
    body += title.length * 26 * LINE;
    if (withImages && p.image) body += 20 + IMG;
    if (summary.length) body += 16 + summary.length * 17 * LINE;
    if (points.length) body += 16 + points.reduce((s, l) => s + l.length * 16 * LINE + 8, -8);
    body += CARD_PAD;
    const kpi = p.kpi ? 20 + 38 * LINE + 2 + wrap(p.kpi.label, 14, textW, measure).length * 14 * LINE + CARD_PAD : 0;
    return { period, title, summary, points, body, kpi };
  });

  for (let r = 0; r < rows; r++) {
    const rowPhases = phases.slice(r * perRow, (r + 1) * perRow);
    const rowMeasured = measured.slice(r * perRow, (r + 1) * perRow);
    const rowY = y;
    const cardY = sequence ? rowY + NODE + 24 : rowY;
    const cardH = Math.max(...rowMeasured.map((m) => m.body + m.kpi));

    // The timeline: one accent thread through the numbered nodes of this row.
    if (sequence) {
      const cx = (i: number) => left + i * (COL + GAP) + COL / 2;
      const cyNode = rowY + NODE / 2;
      for (let i = 0; i < rowPhases.length - 1; i++) {
        line(cx(i) + NODE / 2 + 6, cyNode, COL + GAP - NODE - 12, 0, C.accent, 2, [poster]);
      }
      // A row that continues below says so with a thread to the next row.
      if (r < rows - 1) {
        const last = rowPhases.length - 1;
        line(cx(last) + NODE / 2 + 6, cyNode, left + innerW - (cx(last) + NODE / 2 + 6), 0, C.accent, 2, [poster]);
      }
      if (r > 0) line(left, cyNode, cx(0) - NODE / 2 - 6 - left, 0, C.accent, 2, [poster]);
    }

    rowPhases.forEach((p, i) => {
      const m = rowMeasured[i];
      const n = r * perRow + i;
      const g = [`${gid}-card-${n}`, poster];
      const x = left + i * (COL + GAP);
      const tx = x + CARD_PAD;

      if (sequence) {
        out.push({
          type: "ellipse",
          x: x + COL / 2 - NODE / 2,
          y: rowY,
          width: NODE,
          height: NODE,
          backgroundColor: C.accent,
          fillStyle: "solid",
          strokeColor: C.accent,
          strokeWidth: 1,
          roughness: 0,
          groupIds: g,
          label: {
            text: String(n + 1).padStart(2, "0"),
            fontSize: 17,
            fontFamily: FONT,
            strokeColor: C.paper,
          },
        } as unknown as ExcalidrawElementSkeleton);
      }

      rect(x, cardY, COL, cardH, C.subtle, C.hair, g);

      let cy = cardY + CARD_PAD;
      // Pillars carry a short accent mark instead of a number on a thread — kept
      // inside the card, so it never fights the rounded corners.
      if (!sequence) {
        rect(tx, cy, 40, 4, C.accent, C.accent, g, { roundness: null });
        cy += ACCENT_BAR;
      }
      if (m.period.length) {
        text(m.period.join("\n"), tx, cy, 13, C.accent600, g);
        cy += m.period.length * 13 * LINE + 10;
      }
      text(m.title.join("\n"), tx, cy, 26, C.ink, g);
      cy += m.title.length * 26 * LINE;
      if (withImages && p.image) {
        cy += 20;
        slots.push({ subject: p.image, x: x + (COL - IMG) / 2, y: cy, size: IMG, groupIds: g });
        cy += IMG;
      }
      if (m.summary.length) {
        cy += 16;
        text(m.summary.join("\n"), tx, cy, 17, C.body, g);
        cy += m.summary.length * 17 * LINE;
      }
      if (m.points.length) {
        cy += 16;
        for (const pl of m.points) {
          // a small accent square, not a typed bullet — crisper at every zoom
          rect(tx, cy + 16 * LINE * 0.5 - 3, 6, 6, C.accent, C.accent, g, { roundness: null });
          text(pl.join("\n"), tx + 20, cy, 16, C.body, g);
          cy += pl.length * 16 * LINE + 8;
        }
      }
      if (p.kpi) {
        // The number sits on the card's bottom edge, level across the row.
        const labelLines = wrap(p.kpi.label, 14, textW, measure);
        const ky = cardY + cardH - CARD_PAD - labelLines.length * 14 * LINE - 2 - 38 * LINE;
        line(tx, ky - 14, textW, 0, C.hair, 1, g);
        text(p.kpi.value, tx, ky, 38, C.accent700, g);
        if (labelLines.length) text(labelLines.join("\n"), tx, ky + 38 * LINE + 2, 14, C.muted, g);
      }
    });

    y = cardY + cardH + (r < rows - 1 ? 48 : 0);
  }

  /* ── Goal ── */
  if (spec.goal) {
    y += 48;
    const g = [`${gid}-goal`, poster];
    const img = withImages && spec.goal.image;
    const gw = innerW - 2 * 40 - (img ? GOAL_IMG + 40 : 0);
    const eyebrowH = 13 * LINE + 10;
    const titleLines = wrapBalanced(spec.goal.title, 34, gw, measure);
    const textLines = spec.goal.text ? wrapBalanced(spec.goal.text, 18, Math.min(gw, 960), measure) : [];
    const contentH = eyebrowH + titleLines.length * 34 * LINE + (textLines.length ? 12 + textLines.length * 18 * LINE : 0);
    const h = Math.max(contentH, img ? GOAL_IMG : 0) + 2 * 40;
    rect(left, y, innerW, h, C.dark, C.dark, g);
    let gy = y + 40 + (h - 80 - contentH) / 2;
    text(L.goal, left + 40, gy, 14, C.accent300, g);
    gy += eyebrowH;
    text(titleLines.join("\n"), left + 40, gy, 34, C.paper, g);
    gy += titleLines.length * 34 * LINE + 12;
    if (textLines.length) text(textLines.join("\n"), left + 40, gy, 18, C.darkBody, g);
    if (img) {
      slots.push({ subject: spec.goal.image!, x: left + innerW - 40 - GOAL_IMG, y: y + (h - GOAL_IMG) / 2, size: GOAL_IMG, groupIds: g, onDark: true });
    }
    y += h;
  }

  /* ── Footer ── */
  y += 36;
  if (spec.footer) {
    text(spec.footer, left, y, 14, C.muted, [poster]);
    y += 14 * LINE;
  }
  y += PAD - 20;

  const H = y - o.y;
  (out[posterIndex] as { height: number }).height = H;

  return { skeletons: out, slots, bounds: { x: o.x, y: o.y, width: W, height: H }, notes };
}

/* ───────────────────────────  Pictures  ─────────────────────────── */

/**
 * The prompt for one picture on the poster. The house style itself comes from
 * the "house" illustration style; this only makes the subject concrete, because
 * an image model given an abstraction ("Skalierung") draws a stock-photo cliché.
 */
export function slotSubject(slot: ImageSlot, spec: MasterplanSpec): string {
  // Charcoal on the near-black goal band would vanish, so there the greys invert.
  const tone = slot.onDark
    ? " Drawn for a near-black background: white and light greys (#f3f4f6 to #9ca3af) instead of charcoal, the accent colour unchanged."
    : "";
  return `${slot.subject} — an icon-like picture for a masterplan titled "${spec.title}".${tone}`;
}
