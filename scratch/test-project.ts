/**
 * Project-context distillation (run: npx tsx scratch/test-project.ts).
 *
 * The interesting case is not a toy fixture — it is a real, long
 * CLAUDE.md of a working repo (LUCIDA_TEST_CLAUDE_MD), which must come out as a short brief that still
 * carries the project's own vocabulary.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { distillProject, firstParagraph, headings } from "../src/lib/project";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}

// 1. Name resolution: manifest wins over folder name.
check(
  "name: package.json wins",
  distillProject({ path: "/p", dir_name: "folder", package_json: '{"name":"some-app"}' }).name ===
    "some-app",
);
check(
  "name: folder name is the fallback",
  distillProject({ path: "/p", dir_name: "my-repo" }).name === "my-repo",
);
check(
  "name: a broken manifest does not throw",
  distillProject({ path: "/p", dir_name: "fallback", package_json: "{oops" }).name === "fallback",
);

// 2. The first paragraph skips headings, badges, quotes and lists.
const md = [
  "# Title",
  "",
  "[![CI](https://img.shields.io/x.svg)](https://ci)",
  "",
  "> a pull quote",
  "",
  "This project does the thing that matters.",
  "It has a second line.",
  "",
  "- a list item",
  "",
  "## Architecture",
  "### Routing Core",
  "## Testing",
].join("\n");
check(
  "paragraph: badges, quote and headings skipped",
  firstParagraph(md) === "This project does the thing that matters. It has a second line.",
  JSON.stringify(firstParagraph(md)),
);
check(
  "headings: h2 and h3 collected in order",
  headings(md).join("|") === "Architecture|Routing Core|Testing",
  headings(md).join("|"),
);
check("headings: code fences are not mined for headings", headings("```\n## Fake\n```\n## Real").join("") === "Real");

// 3. Precedence: AGENTS.md before CLAUDE.md before README.md.
const three = distillProject({
  path: "/p",
  dir_name: "x",
  agents: "Agents brief here.\n\n## FromAgents",
  claude: "Claude brief here.\n\n## FromClaude",
  readme: "Readme brief here.\n\n## FromReadme",
});
check("precedence: AGENTS.md supplies the summary", three.brief.includes("Agents brief here."));
check("precedence: every source contributes vocabulary", ["FromAgents", "FromClaude", "FromReadme"].every((t) => three.brief.includes(t)));
check("sources: all three listed", three.sources.join(",") === "AGENTS.md,CLAUDE.md,README.md");
check("empty project: still a usable brief", distillProject({ path: "/p", dir_name: "bare" }).brief.includes('"bare"'));

// 4. The real thing: a long CLAUDE.md must become a short, useful brief.
//    Point LUCIDA_TEST_CLAUDE_MD at one to check it.
const real = process.env.LUCIDA_TEST_CLAUDE_MD ?? "";
if (real && existsSync(real)) {
  const ctx = distillProject({
    path: "/repo",
    dir_name: "some-repo",
    claude: readFileSync(real, "utf8"),
    package_json: '{"name":"some-app"}',
  });
  const lines = readFileSync(real, "utf8").split("\n").length;
  check(`real CLAUDE.md (${lines} lines) → brief under 900 chars`, ctx.brief.length <= 900, `${ctx.brief.length} chars`);
  check("real: the project is named", ctx.brief.includes("some-app"));
  check(
    "real: the repo's own vocabulary survives",
    /Its own vocabulary: \S/.test(ctx.brief),
    ctx.brief.slice(0, 200),
  );
  check("real: no code fence content leaked in", !ctx.brief.includes("```") && !ctx.brief.includes("docker compose"));
} else {
  console.log("⏭  set LUCIDA_TEST_CLAUDE_MD to check a real CLAUDE.md");
}

console.log(failures === 0 ? "\nALL PROJECT CASES PASSED" : `\n${failures} PROJECT CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
