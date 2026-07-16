import { extname, basename } from "path";
import type { SkillRepository } from "./repository.js";

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
  sourcePlugin: string;
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
  private builtins: SkillEntry[] = [];

  private repo: SkillRepository;

  constructor(repo?: SkillRepository) {
    this.repo = repo ?? { scan: () => [], save: () => {} };
  }

  /** Register a built-in skill programmatically (not from disk). */
  register(entry: Omit<SkillEntry, "filePath">): void {
    this.builtins.push({ ...entry, filePath: "(builtin)" });
  }

  /**
   * Indexes all skill directories from the given parent directories.
   * Skills are flat .md files: dir/{name}.md
   */
  index(directories: string[]): void {
    this.skills = [...this.builtins];
    const fromDisk = this.repo.scan(directories);
    this.skills.push(...fromDisk);
  }

  /**
   * Hybrid Anchor Resolution: evaluates focused files, user input, and active plan
   * against registered skill triggers. Also loads skills bound to the active agent.
   * Returns matching skill content for injection into the Governance Partition's activeSkills slot.
   */
  resolveMatchingSkillContent(ctx: AnchorContext, activeAgentId?: string): string[] {
    const matched = new Set<string>();

    for (const skill of this.skills) {
      if (!skill.active) continue;
      // Agent-bound: load if skill declares this agent
      if (activeAgentId && skill.agents.length > 0 && skill.agents.includes(activeAgentId)) {
        matched.add(skill.content);
        continue;
      }
      // Trigger-based: load if context matches triggers
      if (this.matchesTriggers(skill.triggers, ctx, skill.description)) {
        matched.add(skill.content);
      }
    }

    return [...matched];
  }

  get indexedSkills(): SkillEntry[] {
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
    this.repo.save(skill);
  }

  private matchesTriggers(triggers: SkillTriggers, ctx: AnchorContext, description?: string): boolean {
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

    // Task anchor: check keywords in user input only (not active plan — plan keywords cause permanent bloat)
    if (triggers.keywords?.length) {
      const text = ctx.userInput.toLowerCase();
      if (triggers.keywords.some((kw) => text.includes(kw.toLowerCase()))) return true;
    }

    // Description anchor: check if significant words from description appear in user input
    if (description && ctx.userInput.length > 10) {
      const stopWords = new Set(["a","an","the","and","or","for","to","in","of","is","are","how","when","what","with","that","this"]);
      const descWords = description.toLowerCase().split(/[\s,—\-]+/).filter(w => w.length > 3 && !stopWords.has(w));
      const input = ctx.userInput.toLowerCase();
      const matches = descWords.filter(w => input.includes(w));
      if (matches.length >= 2) return true;
    }

    return false;
  }
}

