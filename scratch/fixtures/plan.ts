/**
 * A fictional plan — a café opening — in the `wiki/plan/*.md` format. The
 * tests run against it, and `npm run demo` writes it into a folder so the
 * plan wall can be tried without a plan of your own. Nothing here is real.
 */
const TODAY = "2026-09-29";

type Fm = Record<string, string | number | string[]>;

function file(fm: Fm, body = ""): string {
  const v = (x: string | number | string[]) =>
    Array.isArray(x) ? `[${x.join(", ")}]` : typeof x === "number" ? String(x) : /^[\w./-]+$/.test(x) ? x : JSON.stringify(x);
  return ["---", ...Object.entries({ type: "plan", ...fm, last_updated: TODAY }).map(([k, x]) => `${k}: ${v(x)}`), "---", "", body, ""].join("\n");
}

export const DEMO_PEOPLE = new Map([
  ["mara-klein", "Mara Klein"],
  ["jonas-weber", "Jonas Weber"],
  ["lea-schmidt", "Lea Schmidt"],
  ["tom-becker", "Tom Becker"],
]);

export function demoPlanFiles(): Array<{ slug: string; text: string }> {
  const out: Array<{ slug: string; text: string }> = [];
  const add = (slug: string, fm: Fm, body = "") => out.push({ slug, text: file(fm, body) });

  add("goal", { title: "Café Aurora opens on 30 October — full house, no surprises", kind: "goal", brand: "Café Aurora", date: "2026-10-30" },
    "Opening night is the one date that cannot move. Everything that endangers it is fixed first.");

  const horizons = [
    ["h0-prep", "This week (to 26.09.)", "2026-09-26"],
    ["h1-launch", "To 30.10. · Opening night", "2026-10-30"],
    ["h2-m1", "To 20.11. · First month", "2026-11-20"],
    ["h3-m2", "Q1 2027 · Regulars", "2027-03-31"],
    ["h4-v2", "Summer 2027 · Terrace", "2027-06-28"],
  ];
  horizons.forEach(([slug, title, date], i) => add(slug, { title, kind: "horizon", order: i + 1, date }));

  const fronts = [
    ["product", "Kitchen & menu"],
    ["gtm", "Guests & marketing"],
    ["ops", "Operations"],
    ["knowledge", "Recipes & know-how"],
  ];
  fronts.forEach(([slug, title], i) => add(slug, { title, kind: "front", order: i + 1 }));

  const card = (slug: string, title: string, front: string, horizon: string, extra: Fm = {}) =>
    add(slug, { title, kind: "card", front, horizon, status: "todo", owner: "", depends_on: [], ...extra });

  card("product-espresso", "Fix the espresso machine and get it serviced", "product", "h0-prep", { owner: "tom-becker" });
  card("product-tasting", "Tasting menu, eight dishes", "product", "h0-prep", { owner: "mara-klein", status: "doing" });
  card("product-opening-go", "Opening night GO on the final menu", "product", "h1-launch", { depends_on: ["product-espresso"], owner: "mara-klein" });
  card("product-seasonal", "Seasonal menu for winter", "product", "h3-m2");
  card("gtm-invites", "Invite the neighbourhood", "gtm", "h1-launch", { owner: "lea-schmidt", status: "doing" });
  card("gtm-reviews", "First twenty reviews", "gtm", "h2-m1", { depends_on: ["product-opening-go"] });
  card("ops-permit", "Outdoor seating permit", "ops", "h0-prep", { status: "blocked", owner: "jonas-weber" });
  card("ops-staff", "Hire two baristas", "ops", "h1-launch", { owner: "jonas-weber" });
  card("ops-terrace", "Build the terrace", "ops", "h4-v2", { depends_on: ["ops-permit"] });
  card("knowledge-recipes", "Write down every recipe", "knowledge", "h2-m1", { status: "done" });

  add("decision-opening-hours", { title: "Opening hours: 7–19 or 8–22?", kind: "decision", order: 1, status: "todo", owner: "mara-klein", depends_on: [] },
    "**Recommendation:** 7–19 for the first month, then decide on data.");
  add("decision-supplier", { title: "One coffee roaster or two?", kind: "decision", order: 2, status: "todo", owner: "tom-becker", depends_on: [] });

  add("risk-machine-late", { title: "Spare part for the espresso machine has a 4-week lead time", kind: "risk", order: 1, severity: "high", affects: ["product-espresso"] });
  add("risk-permit", { title: "Permit office closed during autumn holidays", kind: "risk", order: 2, severity: "medium", affects: ["ops-permit"] });

  add("process-sales", { title: "From guest to regular", kind: "process", order: 1, source: "[[demo]]" });
  ["Walk-in", "Order", "Feedback card", "Loyalty stamp", "Newsletter", "Regular", "Ambassador"].forEach((t, i) =>
    add(`process-sales-${String(i + 1).padStart(2, "0")}`, { title: t, kind: "step", process: "process-sales", order: i + 1, status: "todo", owner: "" }),
  );
  return out;
}
