/**
 * Skill resolution (REQ-CTX-1, REQ-SKL-2).
 *
 * Three-layer search: project → domain → north star. First match wins.
 * Results cached in process memory for the duration of the run.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { voidriftHome } from "./config.js";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, string | null>();

// ---------------------------------------------------------------------------
// Search directories
// ---------------------------------------------------------------------------

function skillDirs(projectDir: string): string[] {
  return [
    join(projectDir, ".voidrift", "skills"),
    join(voidriftHome(), "domain-skills"),
    join(voidriftHome(), "resources", "skills"),
  ];
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function stripFrontmatter(content: string): string {
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) return content.slice(end + 5);
  }
  return content;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) {
      try {
        return parseYaml(content.slice(4, end)) ?? {};
      } catch {
        return {};
      }
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function findSkill(name: string, projectDir?: string): string | null {
  const dir = projectDir ?? process.cwd();
  const upper = name.toUpperCase();
  const key = `${upper}:${dir}`;
  if (cache.has(key)) return cache.get(key)!;

  for (const d of skillDirs(dir)) {
    const candidate = join(d, `${upper}.md`);
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf-8");
      const result = stripFrontmatter(content);
      cache.set(key, result);
      return result;
    }
  }

  cache.set(key, null);
  return null;
}

export interface SkillInfo {
  name: string;
  description: string;
  layer: "project" | "domain" | "north-star";
  path: string;
}

export function listSkills(projectDir?: string): SkillInfo[] {
  const dir = projectDir ?? process.cwd();
  const dirs = skillDirs(dir);
  const labels: Array<"project" | "domain" | "north-star"> = ["project", "domain", "north-star"];
  const seen = new Set<string>();
  const results: SkillInfo[] = [];

  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    if (!existsSync(d)) continue;
    for (const file of readdirSync(d).sort()) {
      if (!file.endsWith(".md")) continue;
      const key = basename(file, ".md").toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const content = readFileSync(join(d, file), "utf-8");
      const fm = parseFrontmatter(content);
      results.push({
        name: key,
        description: String(fm.description ?? ""),
        layer: labels[i],
        path: join(d, file),
      });
    }
  }

  return results;
}

export function availableSkillsWithDesc(projectDir?: string): Record<string, string> {
  const skills = listSkills(projectDir);
  const result: Record<string, string> = {};
  for (const s of skills) {
    result[s.name] = s.description;
  }
  return result;
}

export function getSkillAllowedTools(name: string, projectDir?: string): string[] | null {
  const dir = projectDir ?? process.cwd();
  for (const d of skillDirs(dir)) {
    const candidate = join(d, `${name.toUpperCase()}.md`);
    if (existsSync(candidate)) {
      const fm = parseFrontmatter(readFileSync(candidate, "utf-8"));
      return (fm.allowed_tools as string[] | undefined) ?? null;
    }
  }
  return null;
}

export function clearSkillCache(): void {
  cache.clear();
}
