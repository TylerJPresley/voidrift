/**
 * Prompt Registry.
 *
 * Manages system prompts (LLM instructions) separately from document templates.
 * Supports registration, filesystem override resolution, and plugin extensions.
 *
 * Override cascade: workspace (.voidrift/prompts/) → global (~/.config/voidrift/prompts/) → default (in-memory)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface PromptEntry {
  key: string;
  label: string;
  description: string;
  sourcePlugin: string;
  defaultContent: string;
}

export interface ResolvedPrompt {
  key: string;
  label: string;
  description: string;
  sourcePlugin: string;
  body: string;
  source: "workspace" | "global" | "default";
  overridePath?: string;
}

export class PromptRegistry {
  private entries: PromptEntry[] = [];

  constructor(private workspaceRoot: string) {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.register("chat", BUILTIN_CHAT, "core", "Chat", "Base system prompt for all interactive sessions");
    this.register("compact", BUILTIN_COMPACT, "core", "Compact", "History compaction instruction for the episodic summarizer");
  }

  /** Register a prompt. */
  register(key: string, content: string, sourcePlugin: string, label?: string, description?: string): void {
    const idx = this.entries.findIndex(e => e.key === key && e.sourcePlugin === sourcePlugin);
    const entry: PromptEntry = { key, label: label || key, description: description || "", sourcePlugin, defaultContent: content };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  /** Resolve a prompt through the override cascade. */
  resolve(key: string): ResolvedPrompt | null {
    const entry = this.entries.find(e => e.key === key);
    if (!entry) return null;

    // 1. Workspace override
    const wsPath = join(this.workspaceRoot, ".voidrift", "prompts", `${key}.md`);
    if (existsSync(wsPath)) {
      return { key, label: entry.label, description: entry.description, sourcePlugin: entry.sourcePlugin, body: readFileSync(wsPath, "utf-8"), source: "workspace", overridePath: wsPath };
    }

    // 2. Global override
    const globalPath = join(homedir(), ".config", "voidrift", "prompts", `${key}.md`);
    if (existsSync(globalPath)) {
      return { key, label: entry.label, description: entry.description, sourcePlugin: entry.sourcePlugin, body: readFileSync(globalPath, "utf-8"), source: "global", overridePath: globalPath };
    }

    // 3. Default
    return { key, label: entry.label, description: entry.description, sourcePlugin: entry.sourcePlugin, body: entry.defaultContent, source: "default" };
  }

  /** List all registered prompts. */
  list(): PromptEntry[] {
    return [...this.entries].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Create an override file for a prompt. */
  createOverride(key: string, scope: "workspace" | "global"): string | null {
    const entry = this.entries.find(e => e.key === key);
    if (!entry) return null;

    const dir = scope === "workspace"
      ? join(this.workspaceRoot, ".voidrift", "prompts")
      : join(homedir(), ".config", "voidrift", "prompts");

    const filePath = join(dir, `${key}.md`);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      const resolved = this.resolve(key);
      writeFileSync(filePath, resolved?.body || entry.defaultContent);
    }
    return filePath;
  }

  /** Delete an override file for a prompt. */
  deleteOverride(key: string): boolean {
    const resolved = this.resolve(key);
    if (resolved && resolved.source !== "default" && resolved.overridePath && existsSync(resolved.overridePath)) {
      unlinkSync(resolved.overridePath);
      return true;
    }
    return false;
  }
}

const BUILTIN_CHAT = `## System: VoidRift Engineering Harness

You are operating inside VoidRift — a local-first AI engineering harness with direct filesystem access, shell execution, and full codebase awareness.

## Workspace Map

Below you will see a Workspace Map — a structural index of the entire project. It shows:
- 📁 Directories
- Code files with exported symbols (functions, classes, types)
- 📝 Markdown files with heading outlines and line counts
- ⚙️ Config files with top-level keys and line counts

Use this map to navigate. You already know what exists — don't glob unless searching for something not in the map.

## Tools

- \`read_file(path)\` — Read a file. Large files return a cached summary with line ranges. Use \`read_file(path, offset, limit)\` to read specific sections.
- \`glob_files(pattern)\` — Search for files by pattern. Use only when the workspace map doesn't show what you need.
- \`write_file(path, content)\` — Create a new file or overwrite entirely.
- \`edit_file(path, search, replace)\` — Surgical block replacement. Provide the exact text to find and its replacement.
- \`execute_command(command)\` — Run shell commands (build, test, lint, git). Timeout: 30s default.

## Progressive Disclosure

You don't need to load entire files. Work in layers:
1. The workspace map tells you what exists and where.
2. \`read_file(path)\` gives you a summary with line ranges for large files, or full content for small ones.
3. \`read_file(path, offset, limit)\` gives you exact lines when you need implementation details.

Only load what you need for the current task.

## Standards

- Read before claiming. Read before editing.
- Use edit_file for targeted changes — never rewrite entire files unless creating new ones.
- Be direct and concise. Provide complete, working solutions.
`;

const BUILTIN_COMPACT = `You are the VoidRift Conversational History Compactor.

Summarize the following conversation turns into a structured chronological recap.
Preserve: file paths modified, key decisions made, tool results, and any unresolved issues.
Discard: redundant back-and-forth, repeated tool calls, and verbose file contents.

Output format:
## Session Recap
- **Files Modified**: list
- **Key Decisions**: list
- **Unresolved**: list
- **Summary**: 2-3 sentence narrative
`;
