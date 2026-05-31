import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

export type TemplateType = "template" | "prompt";

export interface TemplateEntry {
  key: string;
  type: TemplateType;
  defaultContent: string;
  sourcePlugin: string;
}

export interface ResolvedTemplate {
  key: string;
  type: TemplateType;
  content: string;
  body: string;
  frontmatter: Record<string, unknown>;
  source: "workspace" | "global" | "default";
  overridePath?: string;
}

export interface AgentConfig {
  tier?: "flash" | "utility" | "dense";
  temperature?: number;
  allowed_tools?: string[];
}

export interface TemplateContext {
  "harness.version": string;
  "harness.timestamp": string;
  "workspace.root": string;
  "workspace.basename": string;
  "git.branch": string;
  "git.sha": string;
  "session.uuid": string;
  "session.model": string;
  [key: string]: string;
}

export interface ValidationDiagnostic {
  phase: "yaml_syntax" | "schema";
  key: string;
  message: string;
  line?: number;
}

/**
 * Harness-Level Template & Prompt Service (G-14).
 *
 * Manages document templates and agent prompts with:
 * - Three-level override cascade (workspace → global → default)
 * - YAML frontmatter parsing and metadata extraction
 * - Agent config governance from prompt frontmatter
 * - Two-phase validation (YAML syntax + schema)
 * - Context enrichment with session telemetry
 */
export class TemplateService {
  private registry = new Map<string, TemplateEntry>();

  constructor(private workspaceRoot: string) {
    this.registerBuiltins();
  }

  register(key: string, type: TemplateType, defaultContent: string, sourcePlugin: string): void {
    this.registry.set(key, { key, type, defaultContent, sourcePlugin });
  }

  resolve(key: string): ResolvedTemplate | null {
    const entry = this.registry.get(key);
    if (!entry) return null;

    const subdir = entry.type === "template" ? "templates" : "prompts";

    // 1. Workspace override
    const wsPath = join(this.workspaceRoot, ".voidrift", subdir, ...key.split("/")) + ".md";
    if (existsSync(wsPath)) {
      const raw = readFileSync(wsPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      return { key, type: entry.type, content: raw, body, frontmatter, source: "workspace", overridePath: wsPath };
    }

    // 2. Global override
    const globalPath = join(homedir(), ".config", "voidrift", subdir, ...key.split("/")) + ".md";
    if (existsSync(globalPath)) {
      const raw = readFileSync(globalPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      return { key, type: entry.type, content: raw, body, frontmatter, source: "global", overridePath: globalPath };
    }

    // 3. Default
    const { frontmatter, body } = parseFrontmatter(entry.defaultContent);
    return { key, type: entry.type, content: entry.defaultContent, body, frontmatter, source: "default" };
  }

  /** Extract agent runtime config from a prompt template's frontmatter */
  extractAgentConfig(key: string): AgentConfig | null {
    const resolved = this.resolve(key);
    if (!resolved || resolved.type !== "prompt") return null;
    const fm = resolved.frontmatter;
    const config: AgentConfig = {};
    if (fm.tier && typeof fm.tier === "string") config.tier = fm.tier as AgentConfig["tier"];
    if (fm.temperature && typeof fm.temperature === "number") config.temperature = fm.temperature;
    if (fm.allowed_tools && Array.isArray(fm.allowed_tools)) config.allowed_tools = fm.allowed_tools;
    return Object.keys(config).length > 0 ? config : null;
  }

  /** Render a template with context enrichment */
  render(key: string, ctx: TemplateContext, extraVars?: Record<string, string>): string | null {
    const resolved = this.resolve(key);
    if (!resolved) return null;

    let content = resolved.body;
    const vars = { ...ctx, ...extraVars };
    for (const [k, v] of Object.entries(vars)) {
      content = content.replaceAll(`{{${k}}}`, v);
    }

    // For document templates, stamp frontmatter metadata
    if (resolved.type === "template") {
      const fm = { ...resolved.frontmatter };
      if (!fm.created_at) fm.created_at = ctx["harness.timestamp"];
      if (!fm.session) fm.session = ctx["session.uuid"];
      return serializeFrontmatter(fm) + content;
    }

    return content;
  }

  /** Two-phase validation of a template file content */
  validate(key: string, content: string): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    // Phase 1: YAML syntax
    const { frontmatter, error, errorLine } = parseFrontmatter(content);
    if (error) {
      diagnostics.push({ phase: "yaml_syntax", key, message: error, line: errorLine });
      return diagnostics; // Can't proceed to schema validation
    }

    // Phase 2: Schema validation per template type
    const entry = this.registry.get(key);
    if (!entry) return diagnostics;

    if (entry.type === "prompt") {
      if (frontmatter.tier && !["flash", "utility", "dense"].includes(frontmatter.tier as string)) {
        diagnostics.push({ phase: "schema", key, message: `Invalid tier "${frontmatter.tier}". Must be flash|utility|dense.` });
      }
      if (frontmatter.temperature !== undefined) {
        const t = Number(frontmatter.temperature);
        if (isNaN(t) || t < 0 || t > 2) {
          diagnostics.push({ phase: "schema", key, message: `temperature must be 0-2, got ${frontmatter.temperature}` });
        }
      }
      if (frontmatter.allowed_tools && !Array.isArray(frontmatter.allowed_tools)) {
        diagnostics.push({ phase: "schema", key, message: `allowed_tools must be an array` });
      }
    }

    if (entry.type === "template") {
      if (frontmatter.depends && !Array.isArray(frontmatter.depends)) {
        diagnostics.push({ phase: "schema", key, message: `depends must be an array` });
      }
    }

    return diagnostics;
  }

  createOverride(key: string, scope: "workspace" | "global"): string | null {
    const entry = this.registry.get(key);
    if (!entry) return null;

    const subdir = entry.type === "template" ? "templates" : "prompts";
    const base = scope === "workspace"
      ? join(this.workspaceRoot, ".voidrift", subdir)
      : join(homedir(), ".config", "voidrift", subdir);

    const filePath = join(base, `${key}.md`);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, entry.defaultContent);
    return filePath;
  }

  buildContext(sessionId: string, model: string): TemplateContext {
    let branch = "main";
    let sha = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      sha = execSync("git rev-parse --short HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch {}

    return {
      "harness.version": "0.1.0",
      "harness.timestamp": new Date().toISOString(),
      "workspace.root": this.workspaceRoot,
      "workspace.basename": this.workspaceRoot.split("/").pop() || "workspace",
      "git.branch": branch,
      "git.sha": sha,
      "session.uuid": sessionId,
      "session.model": model,
    };
  }

  get all(): TemplateEntry[] {
    return [...this.registry.values()];
  }

  private registerBuiltins(): void {
    this.register("dev/task", "template", BUILTIN_DEV_TASK, "core");
    this.register("dev/idea", "template", BUILTIN_DEV_IDEA, "core");
    this.register("dev/cr", "template", BUILTIN_DEV_CR, "core");
    this.register("prompts/plan-arch", "prompt", BUILTIN_PLAN_ARCH, "core");
    this.register("prompts/develop-task", "prompt", BUILTIN_DEVELOP_TASK, "core");
    this.register("prompts/auditor", "prompt", BUILTIN_AUDITOR, "core");
    this.register("prompts/chat", "prompt", BUILTIN_CHAT, "core");
    this.register("prompts/compact", "prompt", BUILTIN_COMPACT, "core");
  }

  /** Delete an override file, falling back to the next level in the cascade */
  deleteOverride(key: string, scope: "workspace" | "global"): boolean {
    const entry = this.registry.get(key);
    if (!entry) return false;
    const subdir = entry.type === "template" ? "templates" : "prompts";
    const base = scope === "workspace"
      ? join(this.workspaceRoot, ".voidrift", subdir)
      : join(homedir(), ".config", "voidrift", subdir);
    const filePath = join(base, `${key}.md`);
    if (existsSync(filePath)) {
      const { unlinkSync } = require("fs");
      unlinkSync(filePath);
      return true;
    }
    return false;
  }
}

// ─── Frontmatter Parser ──────────────────────────────────────────────────────

interface ParseResult {
  frontmatter: Record<string, unknown>;
  body: string;
  error?: string;
  errorLine?: number;
}

function parseFrontmatter(content: string): ParseResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];

  try {
    const parsed = parseSimpleYaml(yamlBlock);
    return { frontmatter: parsed, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { frontmatter: {}, body: content, error: `YAML parse error: ${msg}`, errorLine: 1 };
  }
}

/** Minimal YAML parser for frontmatter (handles scalars, arrays, nested keys) */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array item
    if (trimmed.startsWith("- ") && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      result[currentKey] = currentArray;
      continue;
    }

    // Flush array
    if (currentArray) currentArray = null;

    // Key: value
    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      const rawVal = kvMatch[2].trim();
      if (rawVal === "" || rawVal === "[]") {
        // Empty value or explicit empty array — wait for array items or leave empty
        if (rawVal === "[]") result[currentKey] = [];
      } else if (rawVal === "true") result[currentKey] = true;
      else if (rawVal === "false") result[currentKey] = false;
      else if (rawVal === "null") result[currentKey] = null;
      else if (/^\d+(\.\d+)?$/.test(rawVal)) result[currentKey] = parseFloat(rawVal);
      else if (rawVal.startsWith("[")) {
        // Inline array: [a, b, c]
        const items = rawVal.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
        result[currentKey] = items;
      } else {
        result[currentKey] = rawVal.replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

// ─── Built-in Templates ──────────────────────────────────────────────────────

const BUILTIN_DEV_TASK = `---
id: TASK-{{task.id}}
title: ""
priority: now
status: pending
created_at: {{harness.timestamp}}
depends: []
---
## Objective


## Acceptance Criteria
- [ ] 

## Notes
`;

const BUILTIN_DEV_IDEA = `---
id: IDEA-{{idea.id}}
title: ""
status: draft
created_at: {{harness.timestamp}}
---
## Problem


## Proposed Solution


## Open Questions
`;

const BUILTIN_PLAN_ARCH = `---
tier: dense
temperature: 0.1
allowed_tools: [read_file, glob_files, web_search, web_fetch]
---
You are the Architect agent. Your role is to analyze the user's intent and produce a structured implementation plan.

Given the user's request, produce:
1. A clear objective statement
2. A list of files to create or modify
3. Step-by-step implementation tasks
4. Acceptance criteria for verification

Be precise. Reference specific file paths. Do not implement — only plan.
`;

const BUILTIN_DEVELOP_TASK = `---
tier: utility
temperature: 0.2
allowed_tools: [read_file, glob_files, write_file, edit_file, execute_command]
---
You are the Engineer agent. Your role is to implement the task described below.

Follow the plan exactly. Write code, run tests, and verify your work compiles.
Use read_file before editing. Use edit_file for targeted changes.
Run tests after every write to validate.
`;

const BUILTIN_DEV_CR = `---
id: CR-{{cr.id}}
title: ""
status: draft
priority: normal
created_at: {{harness.timestamp}}
depends: []
modules: []
---
## Summary


## Motivation


## Changes Required
- [ ] 

## Acceptance Criteria
- [ ] 
`;

const BUILTIN_AUDITOR = `---
tier: flash
temperature: 0.0
allowed_tools: [read_file, execute_command, glob_files]
---
You are the Auditor agent. Verify the Engineer's work by reading modified files and running tests or linters.

Evaluate:
1. Do the changes compile without errors?
2. Do tests pass?
3. Does the implementation match the plan?

Output your verdict: "pass" if everything works, "rework" with specific diagnostics if there are issues.
`;

const BUILTIN_CHAT = `---
tier: utility
temperature: 0.2
allowed_tools: [read_file, glob_files, write_file, edit_file, execute_command]
---
You are a helpful AI coding assistant. You have tools to interact with the user's codebase.

Use read_file(path) to read files directly by their relative path.
Use glob_files(pattern) to search for files.
Use execute_command(command) to run shell commands.
Always use read_file first if the user mentions a specific filename.
`;

const BUILTIN_COMPACT = `---
tier: flash
temperature: 0.0
---
You are the VoidRift Conversational History Compactor.

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
