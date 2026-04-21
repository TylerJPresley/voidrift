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

/**
 * Resolve template variables in a prompt string (REQ-ARCH-18).
 *
 * Replaces all `{key}` patterns with values from the vars map.
 * Raises an error if any `{key}` patterns remain after substitution.
 */
export function resolvePrompt(prompt: string, vars: Record<string, string>): string {
  let result = prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  const unresolved = result.match(/\{[a-z_]+\}/g);
  if (unresolved) {
    const unique = [...new Set(unresolved)];
    throw new Error(`Unresolved template variable(s): ${unique.join(", ")}`);
  }
  return result;
}

/**
 * Build a system prompt from the 4-layer structure (REQ-ARCH-19).
 *
 * Layer 1: Shared framework context (loaded once per command run)
 * Layer 2: Methodology skill (how to think)
 * Layer 3: Stage-specific instructions (what to do)
 * Layer 4: Injected context (what to work with)
 *
 * All layers are optional — empty/undefined values are filtered out.
 */
export function buildSystemPrompt(
  frameworkContext: string,
  skill?: string,
  stagePrompt?: string,
  ...injectedContext: (string | undefined)[]
): string {
  return [frameworkContext, skill, stagePrompt, ...injectedContext]
    .filter(Boolean)
    .join("\n\n");
}
