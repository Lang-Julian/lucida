/**
 * Standalone test for the AI engine's pure parts (run: npx tsx scratch/test-ai.ts).
 * Exercises parseSuggestions against real model output shapes, then
 * summarizeScene + suggestionsToSkeletons. No Tauri runtime needed (we never
 * call suggestNext, which is the only function that hits the network).
 */
import { parseSuggestions, summarizeScene, suggestionsToSkeletons } from "../src/lib/ai";
import type { SceneSummary } from "../src/lib/types";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

// 1. The ACTUAL bare-array output the running 3B sidecar returned (no wrapper).
const bareArray =
  '[{"kind":"ellipse","text":"Review","from":"a","rationale":"x"}, ' +
  '{"kind":"diamond","text":"Decision","from":"a","to":"new:2","rationale":"y"}, ' +
  '{"kind":"text","text":"Plan","from":"new:2","to":"new:3","rationale":"z"}]';
const a = parseSuggestions(bareArray);
check("bare array parses to 3 suggestions", a.length === 3, `got ${a.length}`);
check("bare array kinds correct", a.map((s) => s.kind).join(",") === "ellipse,diamond,text");

// 2. The wrapped object form (what the prompt asks for).
const wrapped = '{"suggestions":[{"kind":"rectangle","text":"Test"},{"kind":"arrow","from":"a","to":"new:0"}]}';
const b = parseSuggestions(wrapped);
check("wrapped object parses to 2", b.length === 2, `got ${b.length}`);

// 3. Fenced markdown form.
const fenced = '```json\n{"suggestions":[{"kind":"ellipse","text":"Cache"}]}\n```';
const c = parseSuggestions(fenced);
check("fenced form parses to 1", c.length === 1, `got ${c.length}`);

// 4. Garbage returns [] (never throws).
check("garbage -> []", parseSuggestions("sorry, I cannot do that").length === 0);
check("truncated json -> []", parseSuggestions('{"suggestions":[{"kind":').length === 0);

// 4b. Arrow index remap: an invalid item before the nodes must not desync
// "new:<i>" references (orig: invalid=0, Build=1, Deploy=2, arrow.to=new:2).
const desync =
  '[{"kind":"banana"},{"kind":"rectangle","text":"Build"},' +
  '{"kind":"rectangle","text":"Deploy"},{"kind":"arrow","from":"a","to":"new:2"}]';
const ds = parseSuggestions(desync);
const dsArrow = ds.find((s) => s.kind === "arrow");
check("remap: invalid dropped, 3 kept", ds.length === 3, `got ${ds.length}`);
check('remap: arrow.to rewritten "new:2" -> "new:1" (Deploy)', dsArrow?.to === "new:1", `got ${dsArrow?.to}`);

// 5. summarizeScene: a labeled rectangle + a standalone text + a bound arrow.
const mockElements = [
  { id: "a", type: "rectangle", x: 0, y: 0, width: 160, height: 80 },
  { id: "t1", type: "text", x: 10, y: 30, width: 60, height: 20, text: "Build", containerId: "a" },
  { id: "b", type: "ellipse", x: 300, y: 0, width: 160, height: 80 },
  { id: "note", type: "text", x: 0, y: 200, width: 80, height: 20, text: "Note", containerId: null },
  { id: "arr", type: "arrow", x: 0, y: 0, width: 1, height: 1, startBinding: { elementId: "a" }, endBinding: { elementId: "b" } },
  { id: "ink", type: "freedraw", x: 0, y: 0, width: 1, height: 1 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any;
const summary = summarizeScene(mockElements, "a CI pipeline");
check("summarize: 3 nodes (rect+ellipse+standalone text, skips freedraw)", summary.nodes.length === 3, JSON.stringify(summary.nodes.map((n) => n.id)));
check("summarize: rect borrowed its bound label 'Build'", summary.nodes.find((n) => n.id === "a")?.text === "Build");
check("summarize: 1 edge a->b", summary.edges.length === 1 && summary.edges[0].from === "a" && summary.edges[0].to === "b");
check("summarize: intent carried", summary.intent === "a CI pipeline");

// 6. suggestionsToSkeletons: rectangle + arrow binding to it (new:0) + arrow from existing 'a'.
const scene: SceneSummary = { nodes: [{ id: "a", type: "rectangle", text: "Build", x: 0, y: 0, w: 160, h: 80 }], edges: [] };
const skels = suggestionsToSkeletons(
  [
    { kind: "rectangle", text: "Test" },
    { kind: "arrow", from: "a", to: "new:0", text: "then" },
  ],
  scene,
);
const rectSkel = skels.find((s) => s.type === "rectangle") as any;
const arrowSkel = skels.find((s) => s.type === "arrow") as any;
check("skeletons: rectangle emitted with id + label", !!rectSkel && rectSkel.id === "sugg-0" && rectSkel.label?.text === "Test");
check("skeletons: arrow emitted", !!arrowSkel);
check("skeletons: arrow has 2 points", Array.isArray(arrowSkel?.points) && arrowSkel.points.length === 2);
check("skeletons: arrow END binds to batch node sugg-0", arrowSkel?.end?.id === "sugg-0");
check("skeletons: arrow START not bound (existing scene node = geometric)", arrowSkel?.start === undefined);
check("skeletons: node emitted before arrow", skels.findIndex((s) => s.type === "rectangle") < skels.findIndex((s) => s.type === "arrow"));

console.log(failures === 0 ? "\nALL AI CASES PASSED" : `\n${failures} AI CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
