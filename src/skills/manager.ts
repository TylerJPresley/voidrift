import { readdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join, extname, basename } from "path";

export interface SkillTriggers {
  extensions?: string[];
  files?: string[];
  keywords?: string[];
}

export interface SkillEntry {
  name: string;
  description: string;
  triggers: SkillTriggers;
  agents: string[];
  active: boolean;
  content: string;
  filePath: string;
}

export interface AnchorContext {
  focusedFiles: string[];
  userInput: string;
  activePlan: string | null;
}

/**
 * Progressive Disclosure Skill Manager.
 *
 * On startup: indexes YAML frontmatter from skill markdown files.
 * On each turn: resolves which skills match the current context via hybrid anchors.
 */
export class SkillManager {
  private skills: SkillEntry[] = [];

  /**
   * Indexes all skill directories from the given parent directories.
   * Each skill lives in its own subdirectory with a SKILL.md file.
   * Falls back to flat .md files for backwards compatibility.
   */
  index(directories: string[]): void {
    this.skills = [];
    for (const dir of directories) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        // Folder-scoped skill: dir/{skill_name}/SKILL.md
        const skillMd = join(entryPath, "SKILL.md");
        if (existsSync(skillMd)) {
          const parsed = parseSkillFile(skillMd);
          if (parsed) this.skills.push(parsed);
          continue;
        }
        // Flat file fallback: dir/{name}.md
        if (entry.endsWith(".md")) {
          const parsed = parseSkillFile(entryPath);
          if (parsed) this.skills.push(parsed);
        }
      }
    }
  }

  /**
   * Hybrid Anchor Resolution: evaluates focused files, user input, and active plan
   * against registered skill triggers. Also loads skills bound to the active agent.
   * Returns matching skill content for injection into the Governance Partition's activeSkills slot.
   */
  resolve(ctx: AnchorContext, activeAgentId?: string): string[] {
    const matched = new Set<string>();

    for (const skill of this.skills) {
      if (!skill.active) continue;
      // Agent-bound: load if skill declares this agent
      if (activeAgentId && skill.agents.length > 0 && skill.agents.includes(activeAgentId)) {
        matched.add(skill.content);
        continue;
      }
      // Trigger-based: load if context matches triggers
      if (this.matchesTriggers(skill.triggers, ctx)) {
        matched.add(skill.content);
      }
    }

    return [...matched];
  }

  get indexed(): SkillEntry[] {
    return this.skills;
  }

  /** Validate skills against known agent ids. Returns skills with invalid agent references. */
  validate(knownAgentIds: string[]): Array<{ skill: SkillEntry; invalidAgents: string[] }> {
    const issues: Array<{ skill: SkillEntry; invalidAgents: string[] }> = [];
    for (const skill of this.skills) {
      const invalid = skill.agents.filter(id => !knownAgentIds.includes(id));
      if (invalid.length > 0) issues.push({ skill, invalidAgents: invalid });
    }
    return issues;
  }

  /** Remove references to a deleted agent from all skills. */
  removeAgentReferences(agentId: string): void {
    for (const skill of this.skills) {
      if (skill.agents.includes(agentId)) {
        skill.agents = skill.agents.filter(id => id !== agentId);
        // Write back to disk
        this.updateFrontmatter(skill);
      }
    }
  }

  private updateFrontmatter(skill: SkillEntry): void {
    try {
      const raw = readFileSync(skill.filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return;
      let header = match[1];
      const body = match[2];
      // Update agents line
      const agentsStr = skill.agents.length > 0 ? `[${skill.agents.map(a => `"${a}"`).join(", ")}]` : "[]";
      if (header.includes("agents:")) {
        header = header.replace(/agents:\s*\[[^\]]*\]/, `agents: ${agentsStr}`);
      } else {
        header += `\nagents: ${agentsStr}`;
      }
      writeFileSync(skill.filePath, `---\n${header}\n---\n${body}`);
    } catch {}
  }

  private matchesTriggers(triggers: SkillTriggers, ctx: AnchorContext): boolean {
    // File anchor: check extensions of focused files
    if (triggers.extensions?.length) {
      const focusedExts = ctx.focusedFiles.map((f) => extname(f).toLowerCase());
      if (triggers.extensions.some((ext) => focusedExts.includes(ext.toLowerCase()))) return true;
    }

    // File anchor: check filenames of focused files
    if (triggers.files?.length) {
      const focusedNames = ctx.focusedFiles.map((f) => basename(f));
      if (triggers.files.some((name) => focusedNames.includes(name))) return true;
    }

    // Task anchor: check keywords in user input and active plan
    if (triggers.keywords?.length) {
      const text = [ctx.userInput, ctx.activePlan || ""].join(" ").toLowerCase();
      if (triggers.keywords.some((kw) => text.includes(kw.toLowerCase()))) return true;
    }

    return false;
  }
}

function parseSkillFile(filePath: string): SkillEntry | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const header = frontmatterMatch[1];
    const content = frontmatterMatch[2].trim();

    const name = extractField(header, "name") || basename(filePath, ".md");
    const description = extractField(header, "description") || "";
    const triggers = extractTriggers(header);
    const agents = extractArray(header, "agents");
    const activeField = extractField(header, "active");
    const active = activeField === null ? true : activeField !== "false";

    return { name, description, triggers, agents, active, content, filePath };
  } catch {
    return null;
  }
}

function extractField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function extractTriggers(yaml: string): SkillTriggers {
  const triggers: SkillTriggers = {};

  const extMatch = yaml.match(/extensions:\s*\[([^\]]*)\]/);
  if (extMatch) triggers.extensions = parseArray(extMatch[1]);

  const filesMatch = yaml.match(/files:\s*\[([^\]]*)\]/);
  if (filesMatch) triggers.files = parseArray(filesMatch[1]);

  const kwMatch = yaml.match(/keywords:\s*\[([^\]]*)\]/);
  if (kwMatch) triggers.keywords = parseArray(kwMatch[1]);

  return triggers;
}

function parseArray(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function extractArray(yaml: string, field: string): string[] {
  const match = yaml.match(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`));
  return match ? parseArray(match[1]) : [];
}
