/**
 * Two-layer memory system (REQ-MEM-1). Project + global.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { voidriftHome } from "./config.js";

export interface MemoryEntry {
  name: string;
  description: string;
  layer: "project" | "global";
  path: string;
}

export class MemoryManager {
  private _projectDir: string;
  private _globalDir: string;

  constructor(projectDir: string) {
    this._projectDir = join(projectDir, ".voidrift", "memory");
    this._globalDir = join(voidriftHome(), "memory");
  }

  read(name: string): string | null {
    const upper = name.toUpperCase();
    for (const dir of [this._projectDir, this._globalDir]) {
      const p = join(dir, `${upper}.md`);
      if (existsSync(p)) {
        const content = readFileSync(p, "utf-8");
        return this._stripFrontmatter(content);
      }
    }
    return null;
  }

  write(name: string, content: string, description = "", scope: "project" | "global" = "project"): void {
    const dir = scope === "global" ? this._globalDir : this._projectDir;
    mkdirSync(dir, { recursive: true });
    const upper = name.toUpperCase();
    const frontmatter = `---\nname: ${upper}\ndescription: ${description}\n---\n\n`;
    writeFileSync(join(dir, `${upper}.md`), frontmatter + content, "utf-8");
    this._updateIndex(dir);
  }

  delete(name: string, scope: "project" | "global" = "project"): void {
    const dir = scope === "global" ? this._globalDir : this._projectDir;
    const p = join(dir, `${name.toUpperCase()}.md`);
    if (existsSync(p)) { unlinkSync(p); this._updateIndex(dir); }
  }

  list(): MemoryEntry[] {
    const seen = new Set<string>();
    const entries: MemoryEntry[] = [];
    for (const [dir, layer] of [[this._projectDir, "project"], [this._globalDir, "global"]] as const) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter(f => f.endsWith(".md") && f !== "MEMORY.md").sort()) {
        const key = f.replace(".md", "");
        if (seen.has(key)) continue;
        seen.add(key);
        const content = readFileSync(join(dir, f), "utf-8");
        const fm = this._parseFrontmatter(content);
        entries.push({ name: key, description: String(fm.description ?? ""), layer, path: join(dir, f) });
      }
    }
    return entries;
  }

  /** Build index string for system prompt injection (names + descriptions only). */
  buildIndex(): string {
    const entries = this.list();
    if (!entries.length) return "";
    return "## Memory\n\n" + entries.map(e => `- **${e.name}**: ${e.description}`).join("\n");
  }

  private _stripFrontmatter(content: string): string {
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) return content.slice(end + 5);
    }
    return content;
  }

  private _parseFrontmatter(content: string): Record<string, unknown> {
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) { try { return parseYaml(content.slice(4, end)) ?? {}; } catch { /* */ } }
    }
    return {};
  }

  private _updateIndex(dir: string): void {
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".md") && f !== "MEMORY.md") : [];
    const lines = ["# Memory Index\n"];
    for (const f of files.sort()) {
      const content = readFileSync(join(dir, f), "utf-8");
      const fm = this._parseFrontmatter(content);
      lines.push(`- **${f.replace(".md", "")}**: ${fm.description ?? ""}`);
    }
    writeFileSync(join(dir, "MEMORY.md"), lines.join("\n") + "\n", "utf-8");
  }
}
