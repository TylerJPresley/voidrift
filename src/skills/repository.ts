/**
 * Skill Repository — persistence interface for skill entries.
 *
 * The SkillManager uses this interface for all I/O. Default implementation
 * reads/writes markdown files from skill directories. Alternative implementations
 * can use in-memory stores (testing).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import type { SkillEntry, SkillTriggers } from "./manager.js";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface SkillRepository {
  /** Scan directories and return all skill entries */
  scan(directories: string[]): SkillEntry[];

  /** Update a skill's frontmatter on disk (for agent reference changes) */
  save(skill: SkillEntry): void;
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemSkillRepository implements SkillRepository {
  scan(directories: string[]): SkillEntry[] {
    const skills: SkillEntry[] = [];
    for (const dir of directories) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const parsed = this.parseFile(join(dir, entry));
          if (parsed) skills.push(parsed);
        }
      }
    }
    return skills;
  }

  save(skill: SkillEntry): void {
    if (skill.filePath === "(builtin)") return;
    try {
      const raw = readFileSync(skill.filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return;
      let header = match[1];
      const body = match[2];
      const agentsStr = skill.agents.length > 0 ? `[${skill.agents.map(a => `"${a}"`).join(", ")}]` : "[]";
      if (header.includes("agents:")) {
        header = header.replace(/agents:\s*\[[^\]]*\]/, `agents: ${agentsStr}`);
      } else {
        header += `\nagents: ${agentsStr}`;
      }
      writeFileSync(skill.filePath, `---\n${header}\n---\n${body}`);
    } catch {}
  }

  private parseFile(filePath: string): SkillEntry | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!frontmatterMatch) return null;

      const header = frontmatterMatch[1];
      const content = frontmatterMatch[2].trim();

      const name = this.extractField(header, "name") || basename(filePath, ".md");
      const description = this.extractField(header, "description") || "";
      const triggers = this.extractTriggers(header);
      const agents = this.extractArray(header, "agents");
      const activeField = this.extractField(header, "active");
      const active = activeField === null ? true : activeField !== "false";

      return { name, description, triggers, agents, active, content, filePath, sourcePlugin: "filesystem" };
    } catch {
      return null;
    }
  }

  private extractField(yaml: string, field: string): string | null {
    const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : null;
  }

  private extractTriggers(yaml: string): SkillTriggers {
    const triggers: SkillTriggers = {};
    const extMatch = yaml.match(/extensions:\s*\[([^\]]*)\]/);
    if (extMatch) triggers.extensions = this.parseArray(extMatch[1]);
    const filesMatch = yaml.match(/files:\s*\[([^\]]*)\]/);
    if (filesMatch) triggers.files = this.parseArray(filesMatch[1]);
    const kwMatch = yaml.match(/keywords:\s*\[([^\]]*)\]/);
    if (kwMatch) triggers.keywords = this.parseArray(kwMatch[1]);
    return triggers;
  }

  private parseArray(raw: string): string[] {
    return raw.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }

  private extractArray(yaml: string, field: string): string[] {
    const match = yaml.match(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`));
    return match ? this.parseArray(match[1]) : [];
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemorySkillRepository implements SkillRepository {
  private skills: SkillEntry[] = [];

  add(skill: SkillEntry): void {
    this.skills.push(skill);
  }

  scan(_directories: string[]): SkillEntry[] {
    return [...this.skills];
  }

  save(skill: SkillEntry): void {
    const idx = this.skills.findIndex(s => s.name === skill.name);
    if (idx >= 0) this.skills[idx] = skill;
  }
}
