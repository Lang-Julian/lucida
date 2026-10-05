/**
 * Plan SSOT (run: npx tsx scratch/test-plan.ts).
 *
 * The board may only ever touch what it changed: a patch must leave every
 * other key, and the body, byte-for-byte alone. Layout is checked on the real
 * fictional plan in scratch/fixtures/plan.ts.
 */
import { parsePlanFile, patchPlanFile, buildPlan, layoutPlan, cellAt, newCardFile, isOverdue, waitingOn, currentHorizon, diffPlanBoard, type BoardElement } from "../src/lib/plan";
import { estimateWidth } from "../src/lib/masterplan";
import { layoutHeist } from "../src/lib/heist";
import { demoPlanFiles } from "./fixtures/plan";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

const file = `---
title: "Ledger v1"
type: plan
kind: card
front: record-ledger
# a comment someone wrote
horizon: h2-m1
depends_on:
  - spec-ledger
status: todo
custom_key: keep me
---

Why this matters.

- a list in the body
`;
const item = parsePlanFile("ledger-v1", file)!;
check("parse: kind, front, horizon", item.kind === "card" && item.front === "record-ledger" && item.horizon === "h2-m1");
check("parse: block list", JSON.stringify(item.depends_on) === '["spec-ledger"]');
const patched = patchPlanFile(file, { status: "doing", depends_on: ["spec-ledger", "x"] }, "2026-09-29");
check("patch: changes what it was asked to", /status: doing/.test(patched) && /depends_on: \[spec-ledger, x\]/.test(patched));
check("patch: the old block list is gone", !/^\s+- spec-ledger/m.test(patched));
check("patch: keeps unknown keys and comments", /custom_key: keep me/.test(patched) && /# a comment someone wrote/.test(patched));
check("patch: keeps the body byte for byte", patched.endsWith("Why this matters.\n\n- a list in the body\n"));
check("patch: stamps last_updated", /last_updated: 2026-09-29/.test(patched));
check("patch: quotes a title with a colon", /title: "A: b"/.test(patchPlanFile(file, { title: "A: b" }, "2026-09-29")));
const again = parsePlanFile("ledger-v1", patched)!;
check("patch: round-trips", again.status === "doing" && again.depends_on.length === 2 && again.body.startsWith("Why"));
const fresh = parsePlanFile("new", newCardFile('Say "hi"', "gtm", "h1", "2026-09-29"))!;
check("new card: parses back", fresh.kind === "card" && fresh.title === 'Say "hi"' && fresh.front === "gtm" && fresh.owner === "");

// The plan wall is checked on a fictional plan (a café opening), not on anyone's real one.
const root = "/demo";
{
  const files = demoPlanFiles();
  const plan = buildPlan(files);
  console.log(`   ${plan.fronts.length} fronts × ${plan.horizons.length} horizons, ${plan.cards.length} cards, ${plan.decisions.length} decisions, ${plan.risks.length} risks, ${plan.processes.length} processes / ${plan.steps.length} steps`);
  check("wiki: every file parses", files.every((f) => parsePlanFile(f.slug, f.text)));
  check("wiki: has a goal", !!plan.goal);
  check("wiki: every card sits in a real front and horizon", plan.cards.every((c) => plan.bySlug.get(c.front)?.kind === "front" && plan.bySlug.get(c.horizon)?.kind === "horizon"));
  check("wiki: every dependency points at a real item", [...plan.cards, ...plan.decisions].every((c) => c.depends_on.every((d) => plan.bySlug.has(d))));
  check("wiki: every risk points at real cards", plan.risks.every((r) => r.affects.every((a) => plan.bySlug.has(a))));
  const today = "2026-09-29";
  check("time: the current column is the opening horizon", currentHorizon(plan, today) === "h1-launch");
  const week = plan.cards.filter((c) => c.horizon === "h0-prep");
  check("time: last week's open cards are overdue", week.length > 0 && week.every((c) => isOverdue(c, plan, today)));
  const opening = plan.cards.find((c) => c.title.startsWith("Opening night GO"))!;
  check("deps: opening night waits on the espresso machine", waitingOn(opening, plan).some((d) => d.title.startsWith("Fix the espresso machine")));

  for (const [look, layout] of [["clean", layoutPlan], ["heist", layoutHeist]] as const) {
  console.log(`   — look: ${look}`);
  const L = layout(plan, { root, today });
  type Sk = { type: string; id?: string; x: number; y: number; width?: number; height?: number; text?: string; fontSize?: number; customData?: { lucidaPlan?: { role: string; slug?: string } } };
  const sk = L.skeletons as unknown as Sk[];
  check("layout: one cell per front × horizon", L.cells.length === plan.fronts.length * plan.horizons.length);
  check("layout: ids are unique", new Set(sk.map((s) => s.id)).size === sk.length);
  check("layout: every element is tagged as plan", sk.every((s) => s.customData?.lucidaPlan));
  let overflow = 0;
  for (const s of sk) {
    if (s.type !== "text" || !s.id?.startsWith("plan-card-")) continue;
    const slug = s.customData!.lucidaPlan!.slug!;
    const box = L.boxes.get(slug)!;
    const w = Math.max(...s.text!.split("\n").map((l) => estimateWidth(l, s.fontSize!)));
    const tol = look === "heist" ? 9 : 0.5;
    if (s.x + w > box.x + box.width + tol || s.y + s.text!.split("\n").length * s.fontSize! * 1.25 > box.y + box.height + tol) {
      overflow++;
      if (overflow < 4) console.log("   overflow:", JSON.stringify(s.text));
    }
  }
  check("layout: no card text runs out of its card", overflow === 0, String(overflow));
  const box = L.boxes.get(opening.slug)!;
  const cell = cellAt(L.cells, box.x + box.width / 2, box.y + box.height / 2);
  check("layout: a card's centre is in its own cell", cell?.front === opening.front && cell?.horizon === opening.horizon);
  const deps = sk.filter((s) => (s.type === "arrow" || s.type === "line") && s.id?.startsWith("plan-dep-")).length;
  const want = [...plan.cards, ...plan.decisions].reduce((n, c) => n + c.depends_on.length, 0);
  check("layout: one arrow per dependency", deps === want, `${deps}/${want}`);
  const inside = (s: Sk) => s.x >= L.bounds.x && s.y >= L.bounds.y && s.x + (s.width ?? 0) <= L.bounds.x + L.bounds.width && s.y + (s.height ?? 0) <= L.bounds.y + L.bounds.height;
  check("layout: everything inside the board", sk.filter((s) => s.type !== "arrow" && s.type !== "line").every(inside));
  console.log(`   board ${Math.round(L.bounds.width)}×${Math.round(L.bounds.height)} px, ${sk.length} elements`);

  // 5. Reading the board back — each gesture becomes exactly one file change.
  const asScene = (): BoardElement[] =>
    (L.skeletons as unknown as Array<Record<string, any>>).map((k) => ({
      id: k.id,
      type: k.type,
      x: k.x,
      y: k.y,
      width: k.width ?? (k.text ? Math.max(...String(k.text).split("\n").map((l: string) => estimateWidth(l, k.fontSize))) : 0),
      height: k.height ?? (k.text ? String(k.text).split("\n").length * k.fontSize * 1.25 : 0),
      text: k.text,
      customData: k.customData,
      startBinding: k.start ? { elementId: k.start.id } : null,
      endBinding: k.end ? { elementId: k.end.id } : null,
    }));
  const opts = { today, exists: (slug: string) => plan.bySlug.has(slug) };
  const untouched = diffPlanBoard(asScene(), plan, L, opts);
  const firstCard = plan.bySlug.get([...L.boxes.keys()].find((k) => !k.startsWith("crew:"))!)!;
  check("sync: titles are remembered as drawn", (L.skeletons as unknown as Array<{ id?: string; customData?: { lucidaPlan?: { shown?: string } } }>).some((k) => k.id === `plan-card-${firstCard.slug}-t` && typeof k.customData?.lucidaPlan?.shown === "string"));
  check("sync: an untouched board changes nothing", untouched.patches.size === 0 && untouched.creates.length === 0 && !untouched.drifted);

  // drag the opening card (and its parts) into the Q1-2027 cell of GTM
  const target = L.cells.find((c) => c.front === "gtm" && c.horizon === "h3-m2")!;
  const dragged = asScene().map((e) =>
    e.id.startsWith(`plan-card-${opening.slug}`) ? { ...e, x: e.x + (target.x - box.x) + 20, y: e.y + (target.y - box.y) + 20 } : e,
  );
  const drag = diffPlanBoard(dragged, plan, L, opts);
  check("sync: dragging a card to another cell moves it there", JSON.stringify(drag.patches.get(opening.slug)) === '{"front":"gtm","horizon":"h3-m2"}', JSON.stringify([...drag.patches]));
  check("sync: …and touches nothing else", drag.patches.size === 1);

  // drop a crew chip on the opening card
  const person = [...L.boxes.keys()].find((k) => k.startsWith("crew:") && k.slice(5) !== opening.owner)!;
  const chip = L.boxes.get(person)!;
  const assigned = asScene().map((e) =>
    e.id.startsWith(`plan-crew-${person.slice(5)}`) ? { ...e, x: e.x + (box.x + 30 - chip.x), y: e.y + (box.y + 10 - chip.y) } : e,
  );
  const assign = diffPlanBoard(assigned, plan, L, opts);
  check("sync: dropping a name on a card makes them the owner", assign.patches.get(opening.slug)?.owner === person.slice(5), JSON.stringify([...assign.patches]));

  // type a new title
  const retitled = asScene().map((e) => (e.id === `plan-card-${opening.slug}-t` ? { ...e, text: "Opening night GO\non the winter menu" } : e));
  check("sync: a title typed on the board is written", diffPlanBoard(retitled, plan, L, opts).patches.get(opening.slug)?.title === "Opening night GO on the winter menu");

  // draw an arrow from one card to another
  const other = plan.cards.find((c) => c.title.startsWith("Tasting menu"))!;
  const withArrow = [...asScene(), { id: "user-arrow", type: "arrow", x: 0, y: 0, width: 1, height: 1, startBinding: { elementId: `plan-card-${other.slug}` }, endBinding: { elementId: `plan-card-${opening.slug}-s` } }];
  const arrow = diffPlanBoard(withArrow, plan, L, opts);
  check("sync: an arrow drawn between cards becomes a dependency", arrow.patches.get(opening.slug)?.depends_on?.includes(other.slug) === true && arrow.remove.has("user-arrow"));
  check("sync: …keeping the ones it had", arrow.patches.get(opening.slug)?.depends_on?.length === opening.depends_on.length + 1);

  // delete a dependency arrow
  const depId = `plan-dep-${opening.depends_on[0]}--${opening.slug}`;
  const cut = diffPlanBoard(asScene().filter((e) => e.id !== depId), plan, L, opts);
  check("sync: deleting an arrow removes the dependency", JSON.stringify(cut.patches.get(opening.slug)?.depends_on) === "[]", JSON.stringify([...cut.patches]));

  // delete a card
  const gone = diffPlanBoard(asScene().filter((e) => !e.id.startsWith(`plan-card-${other.slug}`)), plan, L, opts);
  check("sync: deleting a card archives it, never deletes the file", gone.patches.get(other.slug)?.status === "archived");

  // write a word into an empty cell
  const empty = L.cells.find((c) => c.front === "knowledge" && c.horizon === "h4-v2")!;
  const typed = [...asScene(), { id: "user-text", type: "text", x: empty.x + 30, y: empty.y + 30, width: 120, height: 20, text: "Recipe book v2" }];
  const created = diffPlanBoard(typed, plan, L, opts);
  const nc = created.creates[0] && parsePlanFile(created.creates[0].slug, created.creates[0].text);
  check("sync: a word written into a cell becomes a card there", !!nc && nc.front === "knowledge" && nc.horizon === "h4-v2" && nc.title === "Recipe book v2" && created.remove.has("user-text"));

  // drag a card into nowhere
  const lost = asScene().map((e) => (e.id.startsWith(`plan-card-${opening.slug}`) ? { ...e, x: e.x - 5000 } : e));
  const nowhere = diffPlanBoard(lost, plan, L, opts);
  check("sync: a card dropped outside the grid snaps back", nowhere.patches.size === 0 && nowhere.drifted);

  // reorder a process step
  const sales = plan.steps.filter((st) => st.process === "process-sales").sort((a, b) => a.order - b.order);
  const first = L.boxes.get(sales[0].slug)!;
  const third = L.boxes.get(sales[2].slug)!;
  const reordered = asScene().map((e) => (e.id.startsWith(`plan-card-${sales[0].slug}`) ? { ...e, x: e.x + (third.x - first.x) + 40 } : e));
  const re = diffPlanBoard(reordered, plan, L, opts);
  check("sync: dragging a step along its lane reorders the process", re.patches.get(sales[0].slug)?.order === 3 && re.patches.get(sales[1].slug)?.order === 1, JSON.stringify([...re.patches]));
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
