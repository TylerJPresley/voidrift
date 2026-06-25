import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { VERSION } from "../version.js";

export type TemplateType = "template" | "prompt";
export type SlotAction = "base" | "override" | "extends";

export interface TemplateSlot {
  key: string;
  label: string;
  description: string;
  type: TemplateType;
  action: SlotAction;
  sourcePlugin: string;
  defaultContent: string;
}

export interface ResolvedSlot {
  key: string;
  type: TemplateType;
  action: SlotAction;
  sourcePlugin: string;
  content: string;
  body: string;
  frontmatter: Record<string, unknown>;
  source: "workspace" | "global" | "default";
  overridePath?: string;
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
 * Slot-based architecture:
 * - Each registration is a "slot" with a key, source plugin, and action (base/override/extends)
 * - Each slot independently resolves through the operator override cascade
 * - Final content = resolved base (or override) + resolved extensions
 * - Operator can override any slot via file on disk
 */
export class TemplateService {
  private slots: TemplateSlot[] = [];
  private activePlugins: string[] = [];

  constructor(private workspaceRoot: string, activePlugins?: string[]) {
    this.activePlugins = activePlugins ?? [];
    this.registerBuiltins();
    this.discover();
  }

  setActivePlugins(plugins: string[]): void {
    this.activePlugins = plugins;
  }

  /** Register a base prompt/template. */
  register(key: string, type: TemplateType, defaultContent: string, sourcePlugin: string, label?: string, description?: string): void {
    this.registerSlot(key, type, "base", sourcePlugin, defaultContent, label, description);
  }

  /** Register an override — replaces the base entirely. */
  registerOverride(key: string, type: TemplateType, defaultContent: string, sourcePlugin: string): void {
    this.registerSlot(key, type, "override", sourcePlugin, defaultContent);
  }

  /** Register an extension — appends to the resolved base. */
  registerExtension(key: string, type: TemplateType, defaultContent: string, sourcePlugin: string): void {
    this.registerSlot(key, type, "extends", sourcePlugin, defaultContent);
  }

  private registerSlot(key: string, type: TemplateType, action: SlotAction, sourcePlugin: string, defaultContent: string, label?: string, description?: string): void {
    // Replace if same plugin + same action re-registers for same key
    const idx = this.slots.findIndex(s => s.key === key && s.sourcePlugin === sourcePlugin && s.action === action);
    const slot: TemplateSlot = { key, label: label || key, description: description || "", type, action, sourcePlugin, defaultContent };
    if (idx >= 0) this.slots[idx] = slot;
    else this.slots.push(slot);
  }

  /** Resolve a single slot through the operator override cascade. */
  resolveSlot(slot: TemplateSlot): ResolvedSlot {
    const subdir = slot.type === "template" ? "templates" : "prompts";
    
    // 1. Workspace override candidates
    const wsPaths: string[] = [];
    if (slot.sourcePlugin && slot.sourcePlugin !== "custom") {
      wsPaths.push(join(this.workspaceRoot, ".voidrift", subdir, slot.sourcePlugin, `${slot.key}.md`));
    }
    wsPaths.push(join(this.workspaceRoot, ".voidrift", subdir, `${slot.key}.md`));

    for (const wsPath of wsPaths) {
      if (existsSync(wsPath)) {
        const raw = readFileSync(wsPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        return { ...slot, content: raw, body, frontmatter, source: "workspace", overridePath: wsPath };
      }
    }

    // 2. Global override candidates
    const globalPaths: string[] = [];
    if (slot.sourcePlugin && slot.sourcePlugin !== "custom") {
      globalPaths.push(join(homedir(), ".config", "voidrift", subdir, slot.sourcePlugin, `${slot.key}.md`));
    }
    globalPaths.push(join(homedir(), ".config", "voidrift", subdir, `${slot.key}.md`));

    for (const globalPath of globalPaths) {
      if (existsSync(globalPath)) {
        const raw = readFileSync(globalPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        return { ...slot, content: raw, body, frontmatter, source: "global", overridePath: globalPath };
      }
    }

    // 3. Default (in-memory registration)
    const { frontmatter, body } = parseFrontmatter(slot.defaultContent);
    return { ...slot, content: slot.defaultContent, body, frontmatter, source: "default" };
  }

  /**
   * Resolve the final content for a key.
   *
   * Resolution order:
   * 1. Find the base: plugin override → core base (first active plugin override wins)
   * 2. Each slot resolves independently through operator file cascade
   * 3. Final = resolved base + resolved extensions (concatenated)
   */
  resolve(key: string): ResolvedTemplate | null {
    const keySlots = this.slots.filter(s => s.key === key);
    if (keySlots.length === 0) return null;

    const type = keySlots[0].type;

    // Find the effective base slot: plugin override > core base
    let baseSlot: TemplateSlot | undefined;
    // Check active plugins for an override first
    for (const plugin of this.activePlugins) {
      const override = keySlots.find(s => s.action === "override" && s.sourcePlugin === plugin);
      if (override) { baseSlot = override; break; }
    }
    // Fallback: any override from any plugin
    if (!baseSlot) baseSlot = keySlots.find(s => s.action === "override");
    // Fallback: core base
    if (!baseSlot) baseSlot = keySlots.find(s => s.action === "base" && s.sourcePlugin === "core");
    // Fallback: any base
    if (!baseSlot) baseSlot = keySlots.find(s => s.action === "base");
    if (!baseSlot) return null;

    const resolvedBase = this.resolveSlot(baseSlot);

    // Collect extensions from active plugins
    const extensions = keySlots.filter(s => s.action === "extends");
    const resolvedExtensions = extensions.map(s => this.resolveSlot(s));

    // Concatenate
    let finalBody = resolvedBase.body;
    for (const ext of resolvedExtensions) {
      finalBody += "\n\n" + ext.body;
    }

    // Merge frontmatter (base wins for conflicts)
    let finalFrontmatter = { ...resolvedBase.frontmatter };

    const finalContent = resolvedBase.frontmatter && Object.keys(resolvedBase.frontmatter).length > 0
      ? serializeFrontmatter(finalFrontmatter) + finalBody
      : finalBody;

    return {
      key,
      type,
      content: finalContent,
      body: finalBody,
      frontmatter: finalFrontmatter,
      source: resolvedBase.source,
      overridePath: resolvedBase.overridePath,
    };
  }

  /** Extract agent runtime config from a prompt's frontmatter */
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

    const { frontmatter, error, errorLine } = parseFrontmatter(content);
    if (error) {
      diagnostics.push({ phase: "yaml_syntax", key, message: error, line: errorLine });
      return diagnostics;
    }

    const keySlots = this.slots.filter(s => s.key === key);
    if (keySlots.length === 0) return diagnostics;
    const type = keySlots[0].type;

    if (type === "prompt") {
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

    if (type === "template") {
      if (frontmatter.depends && !Array.isArray(frontmatter.depends)) {
        diagnostics.push({ phase: "schema", key, message: `depends must be an array` });
      }
    }

    return diagnostics;
  }

  /** Create an override file for a specific slot. */
  createOverrideForSlot(slot: TemplateSlot, scope: "workspace" | "global"): string | null {
    const subdir = slot.type === "template" ? "templates" : "prompts";
    const base = scope === "workspace"
      ? join(this.workspaceRoot, ".voidrift", subdir)
      : join(homedir(), ".config", "voidrift", subdir);

    const filePath = slot.sourcePlugin && slot.sourcePlugin !== "custom"
      ? join(base, slot.sourcePlugin, `${slot.key}.md`)
      : join(base, `${slot.key}.md`);

    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      const resolved = this.resolveSlot(slot);
      writeFileSync(filePath, resolved.content);
    }
    return filePath;
  }

  /** Delete an override file for a specific slot. */
  deleteOverrideForSlot(slot: TemplateSlot): boolean {
    const resolved = this.resolveSlot(slot);
    if (resolved.source === "default") return false;
    if (resolved.overridePath && existsSync(resolved.overridePath)) {
      unlinkSync(resolved.overridePath);
      return true;
    }
    return false;
  }

  /** Discover custom template and prompt files from filesystem directories. */
  discover(): void {
    const types: { subdir: "prompts" | "templates"; type: TemplateType }[] = [
      { subdir: "prompts", type: "prompt" },
      { subdir: "templates", type: "template" },
    ];
    const bases = [
      { path: join(homedir(), ".config", "voidrift"), scope: "global" },
      { path: join(this.workspaceRoot, ".voidrift"), scope: "workspace" },
    ];

    for (const { path: baseDir, scope } of bases) {
      for (const { subdir, type } of types) {
        const dir = join(baseDir, subdir);
        if (!existsSync(dir)) continue;
        let entries: string[];
        try { entries = readdirSync(dir); } catch { continue; }

        for (const entry of entries) {
          const filePath = join(dir, entry);
          let stat;
          try { stat = statSync(filePath); } catch { continue; }

          if (stat.isFile() && entry.endsWith(".md")) {
            const key = entry.slice(0, -3);
            const content = readFileSync(filePath, "utf-8");
            const exists = this.slots.some(s => s.key === key && s.type === type && s.action === "base");
            if (!exists) {
              this.register(key, type, content, "custom");
            }
          } else if (stat.isDirectory()) {
            let subEntries: string[];
            try { subEntries = readdirSync(filePath); } catch { continue; }
            for (const subEntry of subEntries) {
              const subFilePath = join(filePath, subEntry);
              if (subEntry.endsWith(".md")) {
                const key = subEntry.slice(0, -3);
                const content = readFileSync(subFilePath, "utf-8");
                const exists = this.slots.some(s => s.key === key && s.type === type && s.action === "base");
                if (!exists) {
                  this.register(key, type, content, entry);
                }
              }
            }
          }
        }
      }
    }
  }

  // Legacy compat
  createOverride(key: string, scope: "workspace" | "global"): string | null {
    const keySlots = this.slots.filter(s => s.key === key);
    const base = keySlots.find(s => s.action === "base") ?? keySlots[0];
    if (!base) return null;
    return this.createOverrideForSlot(base, scope);
  }

  deleteOverride(key: string, scope: "workspace" | "global"): boolean {
    const keySlots = this.slots.filter(s => s.key === key);
    const base = keySlots.find(s => s.action === "base") ?? keySlots[0];
    if (!base) return false;
    const subdir = base.type === "template" ? "templates" : "prompts";
    const dir = scope === "workspace"
      ? join(this.workspaceRoot, ".voidrift", subdir)
      : join(homedir(), ".config", "voidrift", subdir);
    const filePath = join(dir, base.sourcePlugin, `${base.key}.md`);
    if (existsSync(filePath)) { unlinkSync(filePath); return true; }
    return false;
  }

  buildContext(sessionId: string, model: string): TemplateContext {
    let branch = "main";
    let sha = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      sha = execSync("git rev-parse --short HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch {}

    return {
      "harness.version": VERSION,
      "harness.timestamp": new Date().toISOString(),
      "workspace.root": this.workspaceRoot,
      "workspace.basename": this.workspaceRoot.split("/").pop() || "workspace",
      "git.branch": branch,
      "git.sha": sha,
      "session.uuid": sessionId,
      "session.model": model,
    };
  }

  /** Get all slots for the TUI panel, sorted alphabetically by key. */
  get allSlots(): TemplateSlot[] {
    return [...this.slots].sort((a, b) => a.key.localeCompare(b.key) || a.sourcePlugin.localeCompare(b.sourcePlugin));
  }

  /** Get all unique keys. */
  get allKeys(): string[] {
    return [...new Set(this.slots.map(s => s.key))].sort();
  }

  /** Get slots for a specific type. */
  slotsByType(type: TemplateType): TemplateSlot[] {
    return this.allSlots.filter(s => s.type === type);
  }

  /** Legacy: get all entries (returns one per key for backward compat). */
  get all(): TemplateSlot[] {
    const seen = new Set<string>();
    const result: TemplateSlot[] = [];
    for (const slot of this.allSlots) {
      if (!seen.has(slot.key)) {
        seen.add(slot.key);
        result.push(slot);
      }
    }
    return result;
  }

  private registerBuiltins(): void {
    this.register("plan", "template", PLAN_TEMPLATE, "core", "Plan", "Template for creating plans");
  }
}

const PLAN_TEMPLATE = `---
priority: now | next | later
description: One sentence summary (under 20 words, enough to understand without loading body)
---

<!-- Why: The problem or motivation driving this work -->
## Why


<!-- Overview: Detailed context, approach, affected areas (optional for small plans) -->
## Overview


<!-- Constraints: What to avoid, dependencies, things that must not break -->
## Constraints


<!-- Tasks: Ordered checklist of concrete steps — this IS the progress tracker -->
## Tasks
- [ ] 

<!-- Done When: Clear exit condition — how to verify the work is complete -->
## Done When

`;

// ─── Frontmatter Parser ──────────────────────────────────────────────────────

interface ParseResult {
  frontmatter: Record<string, unknown>;
  body: string;
  error?: string;
  errorLine?: number;
}

export function parseFrontmatter(content: string): ParseResult {
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

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && currentKey) {
      if (!currentArray) currentArray = [];
      currentArray.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      result[currentKey] = currentArray;
      continue;
    }

    if (currentArray) currentArray = null;

    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      const rawVal = kvMatch[2].trim();
      if (rawVal === "" || rawVal === "[]") {
        if (rawVal === "[]") result[currentKey] = [];
      } else if (rawVal === "true") result[currentKey] = true;
      else if (rawVal === "false") result[currentKey] = false;
      else if (rawVal === "null") result[currentKey] = null;
      else if (/^\d+(\.\d+)?$/.test(rawVal)) result[currentKey] = parseFloat(rawVal);
      else if (rawVal.startsWith("[")) {
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
