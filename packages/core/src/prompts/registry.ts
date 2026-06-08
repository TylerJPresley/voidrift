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
    this.register("core.context-guide", BUILTIN_CONTEXT_GUIDE, "core", "Context Guide", "Explains the 4-layer context architecture to the model");
    this.register("core.rules", BUILTIN_RULES, "core", "Rules", "Behavioral constraints: directive/inquiry, standards, retry protocol, safety, conciseness");
    this.register("core.tool-usage", BUILTIN_TOOL_USAGE, "core", "Tool Usage", "Context efficiency guidance, tool preferences, parallel execution rules");
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

const BUILTIN_CONTEXT_GUIDE = `# Context Guide

Your context has four layers:
• Agent: Your identity, tools, and rules. Do not repeat these back.
• Orbit: Project landscape — file map, plan, memory, skills.
• Drift: Active files — SUMMARIES ONLY. Use read_file() for actual content.
• Void: Conversation history.

Available systems: File Map (workspace structure), Plan (plan tool), Memory (save_memory tool), Skills (auto-loaded), Schedule (schedule tool), Task Agents (run_task_agent tool).

Files in Drift are summaries. Always call read_file(path, offset, limit) for real content before quoting or editing.`;

const BUILTIN_RULES = `# Rules

## Directive vs Inquiry
Distinguish between **Directives** (explicit requests for action) and **Inquiries** (questions, analysis, opinions).
- Assume requests are Inquiries unless they contain an explicit instruction to implement, fix, create, or modify.
- For Inquiries: research and respond. Do NOT modify files until a Directive is issued.
- For Directives: work autonomously. Only clarify if critically underspecified.

## Standards
- Follow existing conventions, patterns, and structure in the workspace.
- Never assume a tool, library, or framework is available — verify first.
- Read files before modifying them. Understand existing content before suggesting changes.
- Prefer editing existing files over creating new ones.
- Do not add scope beyond what was requested.
- Do not revert changes unless explicitly asked. Fix forward.

## Retry Protocol
If an approach has failed 3 times:
1. Stop and restate the original goal.
2. List your current assumptions and identify which may be wrong.
3. Propose a fundamentally different approach rather than patching the current one.

## Safety
- Never expose secrets, API keys, or credentials in file content.
- For destructive or hard-to-reverse actions, explain the action and wait for confirmation.
- Match the scope of actions to what was actually requested.

## Conciseness
- Be direct and concise. Aim for minimal text output outside of tool use.
- No conversational filler, preambles ("I'll now..."), or postambles ("I've finished...").
- Use tools for actions. Use text only for communication.
- After completing a task, provide a brief summary — not a play-by-play.`;

const BUILTIN_TOOL_USAGE = `# Tool Usage

## Context Efficiency
Minimize unnecessary context consumption while maintaining quality:
- Prefer glob/grep to identify relevant files before reading them in full.
- For large files, use offset/limit for targeted reads. Read only what you need.
- If a file is small (< 1000 lines), read it fully rather than making multiple partial reads.
- Combine independent tool calls in parallel. Sequential only when one depends on another's result.
- Do not re-read files you have already read in the same turn unless they may have changed.

## Tool Preferences
- Read files: use read_file (not execute_command with cat/head)
- Edit files: use edit_file (not execute_command with sed)
- Search files: use glob_files (not execute_command with find)
- Reserve execute_command for shell operations that have no dedicated tool equivalent.

## Parallel Execution
Call multiple independent tools in a single response. Only use sequential calls when a result is needed as input to the next call.`;
