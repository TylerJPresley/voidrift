/**
 * Prompt and template loading (REQ-RES-6, REQ-CTX-6).
 *
 * Three-layer search: project → domain → north star.
 * Results cached in process memory for the duration of the run.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { voidriftHome } from "./config.js";

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const promptCache = new Map<string, string>();
const templateCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Search directories
// ---------------------------------------------------------------------------

function promptDirs(projectDir: string): string[] {
  return [
    join(projectDir, ".voidrift", "prompts"),
    join(voidriftHome(), "domain-prompts"),
    join(voidriftHome(), "resources", "prompts"),
  ];
}

function templateDirs(projectDir: string): string[] {
  return [
    join(projectDir, ".voidrift", "templates"),
    join(voidriftHome(), "domain-templates"),
    join(voidriftHome(), "resources", "templates"),
  ];
}

// ---------------------------------------------------------------------------
// Section parser
// ---------------------------------------------------------------------------

function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = content.split(/^## (.+)$/m);
  // parts[0] = preamble; then alternating: name, body
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].trim();
    const body = (parts[i + 1] ?? "").trim();
    sections.set(name, body);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadPrompt(
  cmd: string,
  section: string,
  projectDir?: string,
): string {
  const dir = projectDir ?? process.cwd();
  const key = `${cmd}:${section}:${dir}`;
  const cached = promptCache.get(key);
  if (cached !== undefined) return cached;

  for (const d of promptDirs(dir)) {
    const candidate = join(d, `${cmd}.md`);
    if (existsSync(candidate)) {
      const sections = parseSections(readFileSync(candidate, "utf-8"));
      const result = sections.get(section) ?? "";
      promptCache.set(key, result);
      return result;
    }
  }

  promptCache.set(key, "");
  return "";
}

export function loadTemplate(name: string, projectDir?: string): string {
  const dir = projectDir ?? process.cwd();
  const upper = name.toUpperCase();
  const key = `${upper}:${dir}`;
  const cached = templateCache.get(key);
  if (cached !== undefined) return cached;

  for (const d of templateDirs(dir)) {
    const candidate = join(d, `${upper}.md`);
    if (existsSync(candidate)) {
      let content = readFileSync(candidate, "utf-8");
      // Strip YAML frontmatter
      if (content.startsWith("---\n")) {
        const end = content.indexOf("\n---\n", 4);
        if (end !== -1) content = content.slice(end + 5);
      }
      const result = content.trim();
      templateCache.set(key, result);
      return result;
    }
  }

  templateCache.set(key, "");
  return "";
}

export function clearCache(): void {
  promptCache.clear();
  templateCache.clear();
}
