/**
 * Company map (run: npx tsx scratch/test-company-map.ts).
 *
 * Parsing is checked on fixtures; the grouping and layout on a real
 * wiki when LUCIDA_TEST_WIKI points at one, because the interesting failures — a page
 * in the wrong panel, a leadership page on a shared screen — only show up there.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, indexBlurbs, readEntities, groupEntities, groupOf, layoutCompanyMap, type WikiSnapshot } from "../src/lib/companyMap";
import { estimateWidth } from "../src/lib/masterplan";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

// 1. Frontmatter: all three list shapes the wiki uses.
const f = parseFrontmatter(['title: "Mara Klein"', "category: person", "tags: [person, ceo, founder]", "access:", "  - all", "source_count: 7"].join("\n"));
check("frontmatter: quoted scalar", f.title === "Mara Klein");
check("frontmatter: inline list", JSON.stringify(f.tags) === '["person","ceo","founder"]');
check("frontmatter: block list", JSON.stringify(f.access) === '["all"]');

// 2. Index one-liners lose their markup and bookkeeping.
const b = indexBlurbs("- [[aurora-app]] — Ordering app for the café, **main product** (4 sources)\n- [[x|X]] – see [[y|Y]] (access: leadership)");
check("index: markup and source counts stripped", b.get("aurora-app") === "Ordering app for the café, main product", b.get("aurora-app"));
check("index: aliased links read as their label", b.get("x") === "see Y", b.get("x"));

// 3. Grouping rules.
const e = (category: string, tags: string[], extra: Partial<{ access: string[]; status: string; dir: string }> = {}) =>
  readEntities({ pages: [{ dir: extra.dir ?? "entities", slug: "s", front: `category: ${category}\ntags: [${tags.join(", ")}]\naccess: [${(extra.access ?? ["all"]).join(", ")}]\nstatus: ${extra.status ?? "active"}` }] })[0];
check("group: a customer that is also a prospect is a customer", groupOf(e("company", ["customer", "prospect"])) === "customers");
check("group: a competitor", groupOf(e("company", ["company", "competitor"])) === "competitors");
check("group: an investor person", groupOf(e("person", ["investor", "seed"])) === "investors");
check("group: a candidate never appears", groupOf(e("person", ["kandidat"])) === null);
check("group: an archived page never appears", groupOf(e("company", ["customer"], { status: "archived" })) === null);
check("group: a competitor's product is competition", groupOf(e("product", ["product", "competitor"])) === "competitors");
check("group: a concept is strategy", groupOf(e("x", [], { dir: "concepts" })) === "strategy");
const lead = groupEntities([e("person", ["team"], { access: ["leadership"] })]);
check("access: leadership pages are hidden by default", lead.hidden === 1 && lead.groups.length === 0);
check("access: …and shown for a leadership map", groupEntities([e("person", ["team"], { access: ["leadership"] })], { restricted: true }).groups.length === 1);

// 4. A real wiki.
// Point LUCIDA_TEST_WIKI at a wiki folder (with entities/ and index.md) to check a real one.
const root = process.env.LUCIDA_TEST_WIKI ?? "";
if (!root || !existsSync(join(root, "entities"))) {
  console.log("↷ skipped: set LUCIDA_TEST_WIKI to check a real wiki");
} else {
  const front = (t: string) => (t.startsWith("---") ? t.slice(3, t.indexOf("\n---", 3)) : "");
  const snap: WikiSnapshot = {
    index: readFileSync(join(root, "index.md"), "utf8"),
    pages: ["entities", "concepts"].flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((n) => n.endsWith(".md"))
        .map((n) => ({ dir, slug: n.slice(0, -3), front: front(readFileSync(join(root, dir, n), "utf8")) })),
    ),
  };
  const all = readEntities(snap);
  const { groups, hidden } = groupEntities(all);
  const shown = groups.flatMap((g) => g.items);
  console.log("   " + groups.map((g) => `${g.label} ${g.items.length}`).join(" · ") + ` · hidden ${hidden}`);
  check("wiki: every page is read", all.length === snap.pages.length);
  check("wiki: no leadership page on the default map", !shown.some((x) => x.access.includes("leadership") && !x.access.includes("all")));
  check("wiki: a page tagged hub is the header, not a chip", !shown.some((x) => x.tags.includes("hub")));
  check("wiki: someone is on the team", (groups.find((g) => g.key === "team")?.items.length ?? 0) > 0);
  const withBlurb = shown.filter((x) => x.blurb).length;
  check("wiki: most pages have an index one-liner", withBlurb / shown.length > 0.6, `${withBlurb}/${shown.length}`);

  const L = layoutCompanyMap(all, { today: "2026-09-29", id: "m" });
  type Sk = { type: string; x: number; y: number; width?: number; height?: number; text?: string; fontSize?: number; groupIds?: string[] };
  const sk = L.skeletons as unknown as Sk[];
  const poster = sk[0];
  const inside = (s: Sk) => s.x >= poster.x && s.y >= poster.y && s.x + (s.width ?? 0) <= poster.x + poster.width! && s.y + (s.height ?? 0) <= poster.y + poster.height!;
  check("layout: everything inside the poster", sk.every(inside));
  // Every text stays inside its panel.
  const panels = new Map<string, Sk>();
  for (const s of sk) if (s.type === "rectangle" && s.groupIds?.[0]?.startsWith("m-") && s.groupIds[0] !== "m-poster" && (s.width ?? 0) >= 440) panels.set(s.groupIds[0], s);
  let overflow = 0;
  for (const s of sk) {
    if (s.type !== "text" || !s.groupIds?.[0]) continue;
    const p = panels.get(s.groupIds[0]);
    if (!p) continue;
    const w = Math.max(...s.text!.split("\n").map((l) => estimateWidth(l, s.fontSize!)));
    const h = s.text!.split("\n").length * s.fontSize! * 1.25;
    if (s.x + w > p.x + p.width! + 0.5 || s.y + h > p.y + p.height! + 0.5) {
      overflow++;
      if (overflow < 4) console.log("   overflow:", JSON.stringify(s.text));
    }
  }
  check("layout: no text runs out of its panel", overflow === 0, `${overflow}`);
  check("layout: exhaustive — one chip per shown page", sk.filter((s) => s.type === "text" && s.fontSize && (s.fontSize === 17 || s.fontSize === 14) && s.groupIds?.[0] !== "m-poster").length >= shown.length);
  check("layout: same wiki, same signature", L.signature === layoutCompanyMap(all, { today: "2026-09-29", id: "other" }).signature);
  console.log(`   poster ${Math.round(L.bounds.width)}×${Math.round(L.bounds.height)} px, ${sk.length} elements`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
