/**
 * Write the fictional café plan into a folder so the plan wall can be tried
 * without a plan of your own (run: npm run demo -- <folder>, then open it in
 * Lucida and choose "Masterplan (live)" in the menu).
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { demoPlanFiles, DEMO_PEOPLE } from "../scratch/fixtures/plan";

const root = resolve(process.argv[2] ?? "lucida-demo");
const plan = join(root, "wiki", "plan");
const people = join(root, "wiki", "entities");
if (existsSync(plan) && readdirSync(plan).length) {
  console.error(`${plan} already has files — pick an empty folder`);
  process.exit(1);
}
mkdirSync(plan, { recursive: true });
mkdirSync(people, { recursive: true });
for (const f of demoPlanFiles()) writeFileSync(join(plan, `${f.slug}.md`), f.text);
for (const [slug, name] of DEMO_PEOPLE) {
  writeFileSync(join(people, `${slug}.md`), `---\ntitle: "${name}"\ntype: entity\ncategory: person\ntags: [person, team]\naccess: [all]\nstatus: active\n---\n`);
}
writeFileSync(join(root, "wiki", "index.md"), "# Demo wiki\n");
console.log(`Demo plan written to ${root}\nOpen it:  lucida ${root}   → menu → Masterplan (live)`);
