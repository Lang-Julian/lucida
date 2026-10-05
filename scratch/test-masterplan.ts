/**
 * Masterplan layout (run: npx tsx scratch/test-masterplan.ts).
 *
 * A poster is only as good as its worst line: the checks here are the ways a
 * generated layout goes wrong in front of a customer — text running out of its
 * card, a picture overlapping text, cards of one row at different heights, an
 * element outside the poster.
 */
import { layoutMasterplan, normalizeSpec, wrap, wrapBalanced, estimateWidth } from "../src/lib/masterplan";
import { DEFAULT_HOUSE as HOUSE, houseFrom } from "../src/lib/house";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

type Sk = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  groupIds?: string[];
  strokeColor?: string;
  backgroundColor?: string;
};

// A fictional plan — nothing here is a real company's numbers.
const plan = {
  title: "Café Aurora 2027 — from opening night to a full terrace",
  subtitle: "From the first espresso to two hundred regulars, without a single day closed for repairs.",
  flow: "sequence",
  kpis: [
    { value: "200", label: "Stammgäste bis Sommer" },
    { value: "< 3 min", label: "pro Bestellung" },
    { value: "0", label: "Ruhetage wegen Reparatur" },
  ],
  phases: [
    {
      title: "Opening",
      period: "Q4 2026",
      summary: "One menu, one machine, a full house on the first night.",
      points: ["Espresso machine serviced", "Tasting menu of eight dishes", "Neighbourhood invited"],
      image: "an espresso machine on a counter",
      kpi: { value: "120", label: "Gäste am ersten Abend" },
    },
    {
      title: "First month",
      period: "Q1 2027",
      summary: "What the first guests noticed becomes the routine.",
      points: ["Feedback card on every table", "Two baristas hired", "Supplier contracts signed"],
      image: "a stack of feedback cards",
    },
    {
      title: "Regulars",
      period: "Q2 2027",
      points: ["Loyalty stamp card", "Weekly newsletter"],
      image: "a stamp card with coffee cups",
      kpi: { value: "80", label: "Stammgäste" },
    },
    {
      title: "Terrace",
      period: "Q3 2027",
      summary: "Forty seats outside, open from April to October.",
      points: ["Permit for outdoor seating", "Furniture and heaters"],
      image: "a café terrace with small tables",
      kpi: { value: "200", label: "Stammgäste" },
    },
    {
      title: "Outlook",
      period: "2028",
      points: ["A second location in the old town"],
      image: "a compass",
    },
  ],
  goal: {
    title: "The café the street is proud of — open every day, full every evening.",
    text: "The goal is not size but loyalty: every guest remembered, every day open.",
    image: "a key handed over from one hand to another",
  },
  footer: "Café Aurora · Stand 2026-09-29",
};

const { spec, notes } = normalizeSpec(plan);
const L = layoutMasterplan(spec, { origin: { x: 100, y: 50 }, id: "t", logo: { fileId: "wm", aspect: 1.3 } });
const sk = L.skeletons as unknown as Sk[];

// 1. Normalisation
check("normalize: keeps all 5 phases", spec.phases.length === 5);
check("normalize: no notes for a tidy plan", notes.length === 0, notes.join("; "));
let threw = false;
try {
  normalizeSpec({ title: "", phases: [] });
} catch {
  threw = true;
}
check("normalize: refuses a plan without a title", threw);
const long = normalizeSpec({ title: "x", phases: Array.from({ length: 11 }, (_, i) => ({ title: `P${i}`, points: ["a", "b", "c", "d", "e", "f", "g"] })) });
check("normalize: caps phases at 8", long.spec.phases.length === 8);
check("normalize: says what it dropped", long.notes.some((n) => n.includes("8 of 11")) && long.notes.some((n) => n.includes("5 of 7")));

// 2. Wrapping
const lines = wrap("Selbstbedienung für neue Standorte und quartalsweise Modell-Updates", 16, 280);
check("wrap: every line fits", lines.every((l) => estimateWidth(l, 16) <= 280), JSON.stringify(lines));
check("wrap: keeps every word", lines.join(" ") === "Selbstbedienung für neue Standorte und quartalsweise Modell-Updates");
const balanced = wrapBalanced("Jeden Morgen frisch geröstet, jeden Abend voll besetzt und an keinem Tag geschlossen.", 34, 900);
const greedy = wrap("Jeden Morgen frisch geröstet, jeden Abend voll besetzt und an keinem Tag geschlossen.", 34, 900);
check("balance: same number of lines as greedy", balanced.length === greedy.length);
check("balance: no lonely last word", balanced[balanced.length - 1].split(" ").length > 1, JSON.stringify(balanced));
const hard = wrap("Donaudampfschifffahrtsgesellschaftskapitän", 26, 120);
check("wrap: hard-breaks a word longer than the line", hard.length > 1 && hard.every((l) => estimateWidth(l, 26) <= 120));

// 3. Geometry
const poster = sk[0];
check("poster: first element, so it sits at the back", poster.type === "rectangle" && poster.backgroundColor === HOUSE.paper);
const inside = (e: Sk) =>
  e.x >= poster.x - 0.5 &&
  e.y >= poster.y - 0.5 &&
  e.x + (e.width ?? 0) <= poster.x + poster.width! + 0.5 &&
  e.y + (e.height ?? 0) <= poster.y + poster.height! + 0.5;
check("poster: every element is inside it", sk.every(inside), sk.filter((e) => !inside(e)).map((e) => e.type + ":" + (e.text ?? "")).join(", "));
check("poster: bounds match the poster", L.bounds.width === poster.width && L.bounds.height === poster.height);

const cards = sk.filter((e) => e.type === "rectangle" && e.backgroundColor === HOUSE.subtle);
check("cards: one per phase", cards.length === 5, String(cards.length));
check("cards: five phases share one row", new Set(cards.map((c) => c.y)).size === 1);
check("cards: one height per row", new Set(cards.map((c) => c.height)).size === 1);
const seven = normalizeSpec({ ...plan, phases: [...plan.phases, { title: "Sechs" }, { title: "Sieben" }] }).spec;
const sevenCards = (layoutMasterplan(seven, {}).skeletons as unknown as Sk[]).filter(
  (e) => e.type === "rectangle" && e.backgroundColor === HOUSE.subtle,
);
const rowsOf7 = [...new Set(sevenCards.map((c) => c.y))];
check("cards: seven phases split 4 + 3, never leaving one alone", rowsOf7.length === 2 && sevenCards.filter((c) => c.y === rowsOf7[1]).length === 3);
check("cards: second row starts below the first", rowsOf7[1] > rowsOf7[0] + sevenCards[0].height!);

// Every text line of a card must stay inside that card.
let overflow = 0;
cards.forEach((card, n) => {
  const texts = sk.filter((e) => e.type === "text" && e.groupIds?.[0] === `t-card-${n}`);
  for (const t of texts) {
    const widest = Math.max(...t.text!.split("\n").map((l) => estimateWidth(l, t.fontSize!)));
    const h = t.text!.split("\n").length * t.fontSize! * 1.25;
    if (t.x + widest > card.x + card.width! + 0.5 || t.y + h > card.y + card.height! + 0.5 || t.y < card.y) {
      overflow++;
      console.log("   overflow:", JSON.stringify(t.text));
    }
  }
});
check("cards: no text runs out of its card", overflow === 0, `${overflow} lines`);

// 4. Pictures
check("slots: one per phase with an image, plus the goal", L.slots.length === 6, String(L.slots.length));
const overlapsText = L.slots.some((s) =>
  sk.some(
    (e) =>
      e.type === "text" &&
      e.x < s.x + s.size &&
      e.x + Math.max(...e.text!.split("\n").map((l) => estimateWidth(l, e.fontSize!))) > s.x &&
      e.y < s.y + s.size &&
      e.y + e.text!.split("\n").length * e.fontSize! * 1.25 > s.y,
  ),
);
check("slots: no picture covers text", !overlapsText);
check("slots: pictures join their card's group", L.slots[0].groupIds[0] === "t-card-0" && L.slots[0].groupIds[1] === "t-poster");
const noImages = layoutMasterplan(spec, { images: false });
check("slots: none without an image model", noImages.slots.length === 0);
check("slots: the poster is shorter without them", noImages.bounds.height < L.bounds.height);

// 5. House style
const colours = new Set(sk.flatMap((e) => [e.strokeColor, e.backgroundColor]).filter(Boolean));
const allowed = new Set<string>([...Object.values(HOUSE), "transparent"]);
check("style: only house-style colours are used", [...colours].every((c) => allowed.has(c!)), [...colours].filter((c) => !allowed.has(c!)).join(", "));
check("style: the logo is placed", sk.some((e) => e.type === "image"));
const plain = layoutMasterplan(spec, {});
check("style: no logo without one", !(plain.skeletons as unknown as Sk[]).some((e) => e.type === "image"));
const acme = layoutMasterplan(spec, { house: houseFrom("#c2410c", "Acme") });
const acmeSk = acme.skeletons as unknown as Sk[];
check("style: the organisation's colour is used", acmeSk.some((e) => e.strokeColor === "#c2410c" || e.backgroundColor === "#c2410c"));
check("style: its name heads the poster", acmeSk.some((e) => e.text === "ACME · MASTERPLAN"));
check("style: no organisation, no name", (plain.skeletons as unknown as Sk[]).some((e) => e.text === "MASTERPLAN"));
check("style: phases are numbered 01…", sk.some((e) => e.type === "ellipse"));
const pillars = layoutMasterplan({ ...spec, flow: "parallel" }, {});
check("style: pillars have no numbered thread", !(pillars.skeletons as unknown as Sk[]).some((e) => e.type === "ellipse"));
const pSk = pillars.skeletons as unknown as Sk[];
const pCards = pSk.filter((e) => e.type === "rectangle" && e.backgroundColor === HOUSE.subtle);
const marks = pSk.filter((e) => e.type === "rectangle" && e.backgroundColor === HOUSE.accent && e.width === 40);
check(
  "style: each pillar's cyan mark sits inside its card",
  marks.length === pCards.length && marks.every((m, i) => m.x > pCards[i].x && m.y > pCards[i].y && m.x + m.width! < pCards[i].x + pCards[i].width!),
);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
