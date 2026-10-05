/**
 * The house style — the organisation's look, from the settings, not from the
 * code. One accent colour is all a board needs: the neutrals are fixed cool
 * greys, and every shade of the accent (eyebrows, numbers, text on dark) is
 * derived from it, so a poster, a company map and a plan wall all read as one
 * hand without anyone configuring six colours.
 */

export interface House {
  /** the organisation's name; "" for none */
  name: string;
  ink: string; // headings
  body: string; // body text
  muted: string; // captions
  hair: string; // borders
  subtle: string; // card surface
  paper: string;
  accent: string; // the one accent
  accent600: string; // eyebrows on light
  accent700: string; // numbers on light
  accent300: string; // eyebrows on dark
  dark: string; // dark band
  darkBody: string; // body text on dark
}

/** A calm blue, used until an organisation sets its own colour. */
export const DEFAULT_ACCENT = "#2563eb";

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix a colour with another by `t` (0 = colour, 1 = other). */
function mix(rgb: [number, number, number], other: [number, number, number], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => rgb[i] + (other[i] - rgb[i]) * t) as [number, number, number];
}

export function isHexColour(v: string): boolean {
  return parseHex(v) !== null;
}

export function houseFrom(accent: string = DEFAULT_ACCENT, name = ""): House {
  const rgb = parseHex(accent) ?? (parseHex(DEFAULT_ACCENT) as [number, number, number]);
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  return {
    name: name.trim(),
    ink: "#0b1220",
    body: "#374151",
    muted: "#6b7280",
    hair: "#e5e7eb",
    subtle: "#f9fafb",
    paper: "#ffffff",
    accent: toHex(rgb),
    accent600: toHex(mix(rgb, black, 0.2)),
    accent700: toHex(mix(rgb, black, 0.38)),
    accent300: toHex(mix(rgb, white, 0.42)),
    dark: "#050507",
    darkBody: "#d1d5db",
  };
}

export const DEFAULT_HOUSE = houseFrom();
