/**
 * The folder a board belongs to.
 *
 * A board is not a floating document — it opens *inside* a project, and it
 * reads that project's own instructions to agents (`AGENTS.md`, `CLAUDE.md`)
 * the same way a coding agent would. That is what makes a suggestion say
 * "Guardian" instead of "Process B".
 *
 * Everything here is pure: the Tauri side hands over raw file contents, this
 * module turns them into the short brief the model actually sees. A 971-line
 * CLAUDE.md is not context, it is noise — a decision model's accuracy drops
 * on clutter and an LLM's attention does too.
 */

/** Raw files read from the folder by the Rust side. */
export interface ProjectFiles {
  path: string;
  dir_name: string;
  agents?: string | null;
  claude?: string | null;
  readme?: string | null;
  package_json?: string | null;
  board?: string | null;
}

/** What the board knows about where it lives. */
export interface ProjectContext {
  path: string;
  name: string;
  /** the compact brief handed to the model, already capped */
  brief: string;
  /** which files it was built from, shown in the panel */
  sources: string[];
}

const MAX_BRIEF = 900;
const MAX_SUMMARY = 320;
const MAX_TERMS = 18;

/** Strip everything that is markup rather than meaning. */
function stripNoise(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * The first real paragraph — what the project says it is, before the tables of
 * contents and the build instructions.
 */
export function firstParagraph(md: string): string {
  const out: string[] = [];
  for (const raw of stripNoise(md).split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    if (/^([#>|]|[-*+]\s|\d+\.\s)/.test(line)) {
      if (out.length) break;
      continue;
    }
    out.push(line);
    if (out.join(" ").length >= MAX_SUMMARY) break;
  }
  return out.join(" ").slice(0, MAX_SUMMARY).trim();
}

/**
 * The section headings, which are the project's own vocabulary. This is the
 * most valuable part of the brief: "Routing Core", "Request Perimeter",
 * "Smart Rehydration" are exactly the words a diagram in that repo will use.
 */
export function headings(md: string, max = MAX_TERMS): string[] {
  const out: string[] = [];
  for (const m of stripNoise(md).matchAll(/^#{2,3}[ \t]+(.+)$/gm)) {
    const h = m[1]
      .replace(/[`*_~]/g, "")
      .replace(/\s*[·—–-]\s.*$/, "")
      .replace(/^\d+[.)]?\s*/, "")
      .trim();
    if (h.length < 3 || h.length > 48) continue;
    if (out.some((existing) => existing.toLowerCase() === h.toLowerCase())) continue;
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** The project's name: what its manifest calls it, else the folder name. */
function projectName(files: ProjectFiles): string {
  if (files.package_json) {
    try {
      const name = (JSON.parse(files.package_json) as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      // a broken manifest is not worth failing over
    }
  }
  return files.dir_name || "project";
}

/**
 * Build the brief. Instruction files come first because they were written for
 * exactly this purpose — telling an agent what this codebase is — and a README
 * is the fallback when a project has neither.
 */
export function distillProject(files: ProjectFiles): ProjectContext {
  const name = projectName(files);
  const sources: string[] = [];
  const candidates: Array<[string, string | null | undefined]> = [
    ["AGENTS.md", files.agents],
    ["CLAUDE.md", files.claude],
    ["README.md", files.readme],
  ];

  let summary = "";
  const terms: string[] = [];
  for (const [label, content] of candidates) {
    if (!content?.trim()) continue;
    sources.push(label);
    if (!summary) summary = firstParagraph(content);
    for (const h of headings(content)) {
      if (terms.length >= MAX_TERMS) break;
      if (!terms.some((t) => t.toLowerCase() === h.toLowerCase())) terms.push(h);
    }
  }

  const parts = [`The board is open in the project "${name}".`];
  if (summary) parts.push(summary);
  if (terms.length) parts.push(`Its own vocabulary: ${terms.join(", ")}.`);
  parts.push("Prefer this project's words over generic ones when labelling nodes.");

  return {
    path: files.path,
    name,
    brief: parts.join(" ").slice(0, MAX_BRIEF),
    sources,
  };
}
