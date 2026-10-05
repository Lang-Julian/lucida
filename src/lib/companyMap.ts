/**
 * The company map — the whole organisation on one board, kept current.
 *
 * Source of truth is a Markdown wiki (`<folder>/wiki`): every entity page is a
 * person, company, product or technology, and `index.md` holds a curated
 * one-line description of each. This module turns those into one poster in
 * the organisation's house style — team, customers, pipeline, partners,
 * investors, products, technology, strategy, competitors — and the board
 * redraws it whenever a page changes.
 *
 * Only frontmatter and the index are read. Page bodies stay on disk, and pages
 * marked `access: leadership` (funding, HR, contracts, candidates) are left off
 * unless the map is explicitly made for leadership.
 */
import type { ExcalidrawElementSkeleton } from "./types";
import { TYPEFACES, estimateWidth, logoBox, wrap, wrapBalanced } from "./masterplan";
import { DEFAULT_HOUSE, type House } from "./house";

/* ───────────────────────────  Reading the wiki  ─────────────────────────── */

export interface WikiSnapshot {
  index?: string | null;
  pages: Array<{ dir: string; slug: string; front: string }>;
}

export interface WikiEntity {
  slug: string;
  title: string;
  dir: "entities" | "concepts";
  category: string;
  tags: string[];
  access: string[];
  status: string;
  sources: number;
  /** YYYY-MM-DD */
  updated: string;
  /** the index's one-liner, markup stripped */
  blurb: string;
}

/** The subset of YAML the wiki's frontmatter uses: scalars, [a, b] and block lists. */
export function parseFrontmatter(front: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of front.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    listKey = null;
    if (value === "") {
      out[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value)) {
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else out[key] = unquote(value);
  }
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  // A double-quoted scalar may carry escapes — the plan writes titles that way.
  if (/^".*"$/.test(t)) {
    try {
      return (JSON.parse(t) as string).trim();
    } catch {
      // not JSON after all; fall through
    }
  }
  return t.replace(/^["']|["']$/g, "").trim();
}

const asList = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];

/** `- [[slug]] — description` lines of the index, by slug. */
export function indexBlurbs(index: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of index.matchAll(/^\s*-\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*[—–-]\s*(.+)$/gm)) {
    const slug = m[1].trim();
    if (out.has(slug)) continue;
    const text = m[2]
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s*\((\d+ sources?|access: \w+|concept mentions)\)\s*/g, " ")
      .replace(/[🔴🟠🟡🟢✅❌⚠️]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    out.set(slug, text);
  }
  return out;
}

export function readEntities(snap: WikiSnapshot): WikiEntity[] {
  const blurbs = indexBlurbs(snap.index ?? "");
  return snap.pages.map((p) => {
    const f = parseFrontmatter(p.front);
    const str = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
    return {
      slug: p.slug,
      title: str("title") || p.slug,
      dir: p.dir === "concepts" ? "concepts" : "entities",
      category: str("category") || (p.dir === "concepts" ? "concept" : "?"),
      tags: asList(f.tags).map((t) => t.toLowerCase()),
      access: asList(f.access).map((a) => a.toLowerCase()),
      status: str("status").toLowerCase() || "active",
      sources: Number(str("source_count")) || 0,
      updated: str("last_updated").slice(0, 10),
      blurb: blurbs.get(p.slug) ?? "",
    };
  });
}

/* ───────────────────────────  Grouping  ─────────────────────────── */

export type GroupKey =
  | "team"
  | "products"
  | "technology"
  | "customers"
  | "pipeline"
  | "partners"
  | "investors"
  | "strategy"
  | "competitors"
  | "contacts"
  | "other";

export const GROUPS: Record<GroupKey, { de: string; en: string }> = {
  team: { de: "Team", en: "Team" },
  products: { de: "Produkte", en: "Products" },
  technology: { de: "Technologie", en: "Technology" },
  customers: { de: "Kunden", en: "Customers" },
  pipeline: { de: "Pipeline", en: "Pipeline" },
  partners: { de: "Partner & Kanäle", en: "Partners & channels" },
  investors: { de: "Investoren & Beirat", en: "Investors & advisors" },
  strategy: { de: "Strategie", en: "Strategy" },
  competitors: { de: "Wettbewerb", en: "Competition" },
  contacts: { de: "Externe Kontakte", en: "External contacts" },
  other: { de: "Weitere", en: "Other" },
};

/** Reading order — what a newcomer should see first. */
const ORDER: GroupKey[] = [
  "team",
  "products",
  "customers",
  "pipeline",
  "partners",
  "investors",
  "technology",
  "strategy",
  "competitors",
  "contacts",
  "other",
];

const has = (e: WikiEntity, ...tags: string[]) => tags.some((t) => e.tags.includes(t));

/** Which panel a page belongs on; null keeps it off the map. */
export function groupOf(e: WikiEntity): GroupKey | null {
  if (e.status === "archived" || e.status === "superseded" || has(e, "superseded", "ehemalig")) return null;
  if (e.dir === "concepts") return "strategy";
  switch (e.category) {
    case "person":
      if (has(e, "kandidat", "candidate")) return null;
      if (has(e, "investor", "angel", "seed", "advisory-board", "advisor")) return "investors";
      if (has(e, "extern", "external", "kunde", "customer", "prospect")) return "contacts";
      return "team";
    // A product page tagged competitor is someone else's product.
    case "product":
      return has(e, "competitor", "incumbent") ? "competitors" : "products";
    case "technology":
      return has(e, "competitor") ? "competitors" : "technology";
    case "partner":
      return "partners";
    case "company":
      if (has(e, "customer", "kunde")) return "customers";
      if (has(e, "investor")) return "investors";
      if (has(e, "partner", "partnership", "channel", "reseller", "distributor")) return "partners";
      if (has(e, "prospect", "pilot", "lead")) return "pipeline";
      if (has(e, "competitor", "incumbent", "market")) return "competitors";
      return "other";
    default:
      return "other";
  }
}

export interface MapOptions {
  /** include `access: leadership` pages — only for a leadership screen */
  restricted?: boolean;
  /** today, YYYY-MM-DD, for "changed this week" */
  today?: string;
  lang?: "de" | "en";
  measure?: (text: string, fontSize: number, fontFamily: number) => number;
  origin?: { x: number; y: number };
  id?: string;
  /** the organisation's look and name; the default house style without one */
  house?: House;
  /** the organisation's logo, already added to the scene */
  logo?: { fileId: string; aspect: number };
  /** shown in the header, e.g. "~/Documents/wiki" */
  sourceLabel?: string;
}

export interface MapGroup {
  key: GroupKey;
  label: string;
  items: WikiEntity[];
}

/**
 * The organisation's own pages are the map's header, not a chip on it: the
 * page whose slug is the organisation's name, and any page tagged `hub`.
 */
function isHub(e: WikiEntity, orgName: string): boolean {
  if (e.tags.includes("hub")) return true;
  const own = orgName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return !!own && (e.slug === own || (e.slug.startsWith(`${own}-`) && e.category === "company"));
}

/** Sort and group; the hub pages are the header, not a chip. */
export function groupEntities(all: WikiEntity[], opts: MapOptions = {}): { groups: MapGroup[]; hidden: number } {
  const lang = opts.lang ?? "de";
  const buckets = new Map<GroupKey, WikiEntity[]>();
  let hidden = 0;
  for (const e of all) {
    if (isHub(e, opts.house?.name ?? "")) continue;
    if (!opts.restricted && e.access.includes("leadership") && !e.access.includes("all")) {
      hidden++;
      continue;
    }
    const g = groupOf(e);
    if (!g) continue;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(e);
  }
  const groups = ORDER.filter((k) => buckets.get(k)?.length).map((key) => ({
    key,
    label: GROUPS[key][lang],
    // most-cited first, then alphabetically — the ones that matter float up
    items: buckets.get(key)!.sort((a, b) => b.sources - a.sources || a.title.localeCompare(b.title)),
  }));
  return { groups, hidden };
}

/* ───────────────────────────  Layout  ─────────────────────────── */

const LINE = 1.25;
const PAD = 72;
const COLS = 4;
const COL = 440;
const GAP = 32;
const PANEL_PAD = 24;
/** Pages cited this often, or tagged critical/important, get a card with their one-liner. */
const KEY_SOURCES = 5;
/** Recently changed pages carry a cyan dot. */
const FRESH_DAYS = 3;

export function isKey(e: WikiEntity): boolean {
  return e.sources >= KEY_SOURCES || e.tags.includes("critical") || e.tags.includes("important");
}

export function isFresh(e: WikiEntity, today: string): boolean {
  if (!e.updated || !today) return false;
  const d = (Date.parse(today) - Date.parse(e.updated)) / 86_400_000;
  return d >= 0 && d <= FRESH_DAYS;
}

export interface CompanyMapLayout {
  skeletons: ExcalidrawElementSkeleton[];
  bounds: { x: number; y: number; width: number; height: number };
  counts: Record<string, number>;
  hidden: number;
  /** a fingerprint of what is shown, so an unchanged wiki does not redraw */
  signature: string;
}

export function layoutCompanyMap(all: WikiEntity[], opts: MapOptions = {}): CompanyMapLayout {
  const C = opts.house ?? DEFAULT_HOUSE;
  const lang = opts.lang ?? "de";
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const FONT = TYPEFACES.sans;
  const measure = (t: string, fs: number) => (opts.measure ?? estimateWidth)(t, fs, FONT);
  const o = opts.origin ?? { x: 0, y: 0 };
  const gid = opts.id ?? "map";
  const poster = `${gid}-poster`;
  const { groups, hidden } = groupEntities(all, opts);

  const innerW = COLS * COL + (COLS - 1) * GAP;
  const W = innerW + PAD * 2;
  const left = o.x + PAD;
  const out: ExcalidrawElementSkeleton[] = [];

  const text = (t: string, x: number, y: number, fontSize: number, color: string, groupIds: string[]) =>
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
      groupIds,
    } as unknown as ExcalidrawElementSkeleton);
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke: string,
    groupIds: string[],
    round = true,
  ) =>
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
      roundness: round ? { type: 3 } : null,
      groupIds,
    } as unknown as ExcalidrawElementSkeleton);
  const dot = (x: number, y: number, groupIds: string[]) =>
    out.push({
      type: "ellipse",
      x,
      y,
      width: 8,
      height: 8,
      backgroundColor: C.accent,
      fillStyle: "solid",
      strokeColor: C.accent,
      strokeWidth: 1,
      roughness: 0,
      groupIds,
    } as unknown as ExcalidrawElementSkeleton);
  const line = (x: number, y: number, dx: number, color: string, groupIds: string[]) =>
    out.push({
      type: "line",
      x,
      y,
      points: [
        [0, 0],
        [dx, 0],
      ],
      strokeColor: color,
      strokeWidth: 1,
      roughness: 0,
      groupIds,
    } as unknown as ExcalidrawElementSkeleton);

  const posterIndex = out.length;
  rect(o.x, o.y, W, 0, C.paper, C.hair, [poster]);

  /* ── Header ── */
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  let y = o.y + PAD;
  text(`${C.name ? `${C.name.toUpperCase()} · ` : ""}COMPANY MAP`, left, y, 15, C.accent600, [poster]);
  if (opts.logo) {
    const lb = logoBox(opts.logo.aspect);
    out.push({
      type: "image",
      x: left + innerW - lb.width,
      y: y - 6,
      width: lb.width,
      height: lb.height,
      fileId: opts.logo.fileId,
      groupIds: [poster],
    } as unknown as ExcalidrawElementSkeleton);
  }
  y += 15 * LINE + 14;
  text(lang === "de" ? "Die ganze Firma auf einen Blick" : "The whole company at a glance", left, y, 56, C.ink, [poster]);
  y += 56 * LINE + 14;
  const fresh = groups.flatMap((g) => g.items).filter((e) => isFresh(e, today)).length;
  const sub =
    lang === "de"
      ? `Live aus dem Wiki${opts.sourceLabel ? ` (${opts.sourceLabel})` : ""} — ${shown} Seiten, ${fresh} davon in den letzten ${FRESH_DAYS} Tagen geändert. Stand ${today}.`
      : `Live from the wiki${opts.sourceLabel ? ` (${opts.sourceLabel})` : ""} — ${shown} pages, ${fresh} changed in the last ${FRESH_DAYS} days. As of ${today}.`;
  const subLines = wrapBalanced(sub, 20, 1100, measure);
  text(subLines.join("\n"), left, y, 20, C.body, [poster]);
  y += subLines.length * 20 * LINE + 36;

  /* ── Headline numbers ── */
  const counts: Record<string, number> = Object.fromEntries(groups.map((g) => [g.key, g.items.length]));
  const kpiKeys = (["team", "customers", "pipeline", "partners", "competitors"] as GroupKey[]).filter((k) => counts[k]);
  line(left, y, innerW, C.hair, [poster]);
  y += 28;
  const kw = innerW / Math.max(1, kpiKeys.length);
  kpiKeys.forEach((k, i) => {
    const kx = left + i * kw;
    text(String(counts[k]), kx, y, 46, C.accent700, [poster]);
    text(GROUPS[k][lang], kx, y + 46 * LINE + 4, 15, C.muted, [poster]);
  });
  y += 46 * LINE + 4 + 15 * LINE + 28;
  line(left, y, innerW, C.hair, [poster]);
  y += 20;
  // legend
  dot(left, y + 6, [poster]);
  text(lang === "de" ? `geändert in den letzten ${FRESH_DAYS} Tagen` : `changed in the last ${FRESH_DAYS} days`, left + 16, y, 14, C.muted, [poster]);
  y += 14 * LINE + 28;

  /**
   * One panel: a count, a label, the most-cited pages as cards with their
   * one-liner (in `cols` sub-columns), and everything else as pills that flow.
   * Returns its height; nothing is drawn until `draw` is true, so a panel can
   * be measured before it is placed.
   */
  const panel = (g: MapGroup, px: number, py: number, width: number, cols: number, maxKeys: number): number => {
    const gg = [`${gid}-${g.key}`, poster];
    const innerPanel = width - PANEL_PAD * 2;
    const cardW = (innerPanel - (cols - 1) * 24) / cols;
    const bodyStart = py + PANEL_PAD + 12 + 13 * LINE + 2 + 24 * LINE + 16;
    const keyItems = g.items.filter(isKey).slice(0, maxKeys);
    const keySet = new Set(keyItems);
    const rest = g.items.filter((e) => !keySet.has(e));
    const draws: Array<() => void> = [];

    // cards, row by row so a row shares its tallest card's height
    let cy = bodyStart;
    for (let r = 0; r < keyItems.length; r += cols) {
      let rowH = 0;
      keyItems.slice(r, r + cols).forEach((e, i) => {
        const cx = px + PANEL_PAD + i * (cardW + 24);
        const nameLines = wrap(e.title, 17, cardW - 18, measure).slice(0, 2);
        const blurbLines = e.blurb ? wrap(e.blurb, 13, cardW - 18, measure) : [];
        const blurb = blurbLines.slice(0, 2);
        if (blurbLines.length > 2) {
          let t = blurb[1];
          while (t.length > 1 && measure(`${t}…`, 13) > cardW - 18) t = t.slice(0, -1);
          blurb[1] = `${t.trimEnd().replace(/[,;:.—–-]$/, "")}…`;
        }
        const at = cy;
        const fr = isFresh(e, today);
        draws.push(() => {
          if (fr) dot(cx, at + 17 * LINE * 0.5 - 4, gg);
          text(nameLines.join("\n"), cx + 18, at, 17, C.ink, gg);
          if (blurb.length) text(blurb.join("\n"), cx + 18, at + nameLines.length * 17 * LINE + 2, 13, C.muted, gg);
        });
        rowH = Math.max(rowH, nameLines.length * 17 * LINE + (blurb.length ? 2 + blurb.length * 13 * LINE : 0));
      });
      cy += rowH + 14;
    }
    if (keyItems.length && rest.length) {
      const at = cy + 2;
      draws.push(() => line(px + PANEL_PAD, at, innerPanel, C.hair, gg));
      cy += 18;
    }
    let cursor = 0;
    const pillH = 30;
    for (const e of rest) {
      const fr = isFresh(e, today);
      const label = ellipsis(e.title, 14, Math.min(innerPanel, 360) - 28, measure);
      const w = Math.min(innerPanel, measure(label, 14) + 24 + (fr ? 14 : 0));
      if (cursor && cursor + w > innerPanel) {
        cursor = 0;
        cy += pillH + 8;
      }
      const ax = px + PANEL_PAD + cursor;
      const at = cy;
      draws.push(() => {
        rect(ax, at, w, pillH, C.paper, C.hair, gg);
        if (fr) dot(ax + 10, at + pillH / 2 - 4, gg);
        text(label, ax + 12 + (fr ? 14 : 0), at + (pillH - 14 * LINE) / 2, 14, C.body, gg);
      });
      cursor += w + 8;
    }
    if (rest.length) cy += pillH;
    const h = cy - py + PANEL_PAD;

    rect(px, py, width, h, C.subtle, C.hair, gg);
    rect(px + PANEL_PAD, py + PANEL_PAD, 40, 4, C.accent, C.accent, gg, false);
    text(`${g.items.length}`, px + PANEL_PAD, py + PANEL_PAD + 12, 13, C.accent600, gg);
    text(g.label, px + PANEL_PAD, py + PANEL_PAD + 12 + 13 * LINE + 2, 24, C.ink, gg);
    for (const d of draws) d();
    return h;
  };

  // Zone 1 — the company itself, masonry: each panel to the shortest column.
  // Zone 2 — the wide world around it (strategy, competition): full width, so
  // sixty competitors read as a field, not as one endless column.
  const WIDE: GroupKey[] = ["strategy", "competitors"];
  const colY = Array.from({ length: COLS }, () => y);
  for (const g of groups.filter((x) => !WIDE.includes(x.key))) {
    const c = colY.indexOf(Math.min(...colY));
    colY[c] += panel(g, left + c * (COL + GAP), colY[c], COL, 1, 10) + GAP;
  }
  y = Math.max(...colY);
  for (const g of groups.filter((x) => WIDE.includes(x.key))) {
    y += panel(g, left, y, innerW, COLS, COLS * 3) + GAP;
  }
  y += 36 - GAP;
  const foot =
    lang === "de"
      ? `Quelle: Wiki, nur Frontmatter und Index.${hidden ? ` ${hidden} Seiten mit access: leadership ausgeblendet.` : ""} Aktualisiert sich selbst, sobald sich das Wiki ändert.`
      : `Source: the wiki, frontmatter and index only.${hidden ? ` ${hidden} access: leadership pages hidden.` : ""} Redraws itself whenever the wiki changes.`;
  text(foot, left, y, 14, C.muted, [poster]);
  y += 14 * LINE + PAD - 20;

  const H = y - o.y;
  (out[posterIndex] as { height: number }).height = H;

  const signature = JSON.stringify([
    today,
    opts.restricted ?? false,
    groups.map((g) => [g.key, g.items.map((e) => [e.slug, e.title, e.blurb, e.sources, e.updated])]),
  ]);
  return { skeletons: out, bounds: { x: o.x, y: o.y, width: W, height: H }, counts, hidden, signature };
}

function ellipsis(t: string, fs: number, maxW: number, measure: (t: string, fs: number) => number): string {
  if (measure(t, fs) <= maxW) return t;
  let s = t;
  while (s.length > 1 && measure(`${s}…`, fs) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
