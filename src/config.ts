/**
 * Framework configuration loader (REQ-CFG-1..4).
 *
 * Loads config from ~/.voidrift/config.yml with env var expansion.
 * Operational limits live on each model entry in the models file.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BashConfig {
  enabled: boolean;
  allowedPatterns: string[];
  timeout: number;
  maxOutputLines: number;
}

export interface Config {
  modelsFile: string;
  activeContainerFile: string;
  apiKeys: Record<string, string>;
  protectedPaths: string[];
  allowedCommands: string[];
  ssrfAllowList: string[];
  git: { maxDiffLines: number; maxDiffFiles: number; maxFileDiffLines: number };
  retention: { project: number; global: number };
  cache: { maxEntries: number; ttlDays: number };
  stageMaxTokens: Record<string, number>;
  skills: { synthesisModel: string; repos: string[] };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------

export function voidriftHome(): string {
  return process.env.VOIDRIFT_HOME ?? join(homedir(), ".voidrift");
}

// ---------------------------------------------------------------------------
// Env var expansion (REQ-CFG-1, REQ-CFG-10)
// ---------------------------------------------------------------------------

export function expandEnv(value: string): string {
  if (typeof value !== "string" || !value.includes("${")) return value;
  return value.replace(/\$\{([^}]+)}/g, (_, expr: string) => {
    let name = expr;
    let fallback = "";
    if (name.includes(":-")) {
      [name, fallback] = name.split(":-", 2);
    }
    const resolved = process.env[name] ?? fallback;
    return resolved.replace(/[\r\n]/g, "");
  });
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

let _cached: Config | null = null;

function expandRecursive(obj: unknown): unknown {
  if (typeof obj === "string") return expandEnv(obj);
  if (Array.isArray(obj)) return obj.map(expandRecursive);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = expandRecursive(v);
    }
    return out;
  }
  return obj;
}

export function loadConfig(home?: string): Config {
  if (_cached) return _cached;
  const h = home ?? voidriftHome();
  const p = join(h, "config.yml");
  if (!existsSync(p)) {
    _cached = {} as Config;
    return _cached;
  }
  const raw = parseYaml(readFileSync(p, "utf-8")) ?? {};
  _cached = expandRecursive(raw) as Config;
  return _cached;
}

export function clearConfigCache(): void {
  _cached = null;
}

// ---------------------------------------------------------------------------
// Config cross-reference expansion
// ---------------------------------------------------------------------------

export function expandConfigRefs(value: string): string {
  if (typeof value !== "string" || !value.includes("${")) return value;
  const config = loadConfig();
  return value.replace(/\$\{([^}]+)}/g, (_, expr: string) => {
    let name = expr;
    let fallback = "";
    if (name.includes(":-")) {
      [name, fallback] = name.split(":-", 2);
    }
    if (name.includes(".")) {
      const [section, key] = name.split(".", 2);
      const s = (config as Record<string, unknown>)[section];
      if (s && typeof s === "object" && key in (s as Record<string, unknown>)) {
        return String((s as Record<string, unknown>)[key]);
      }
    }
    return process.env[name] ?? fallback;
  });
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getModelsFile(): string {
  const configured = loadConfig().modelsFile ?? (loadConfig() as Record<string, unknown>)["models_file"];
  if (configured && typeof configured === "string") {
    return configured.replace(/^~/, homedir());
  }
  return join(homedir(), ".worker-cli", "models.yml");
}

export function getProtectedPaths(): string[] {
  return (loadConfig() as Record<string, unknown>)["protected_paths"] as string[] ?? [];
}

export function getAllowedCommands(): string[] {
  return (loadConfig() as Record<string, unknown>)["allowed_commands"] as string[] ?? [];
}

export function getSsrfAllowList(): string[] {
  return (loadConfig() as Record<string, unknown>)["ssrf_allow_list"] as string[] ?? [];
}

export function getRetention(scope: "project" | "global"): number {
  const defaults = { project: 5, global: 30 };
  const r = (loadConfig() as Record<string, unknown>)["retention"] as Record<string, unknown> | undefined;
  const val = r?.[scope];
  return val != null ? Number(val) : defaults[scope];
}

// ---------------------------------------------------------------------------
// Per-stage max_tokens (REQ-CFG-7)
// ---------------------------------------------------------------------------

const STAGE_MAX_TOKENS: Record<string, number> = {
  "gather.triage": 8192,
  "gather.analysis": 8192,
  "gather.consolidation": 8192,
  "plan.delta": 8192,
  "plan.architecture": 32768,
  "plan.module-arch": 8192,
  "plan.outline": 8192,
  "plan.deps": 4096,
  "plan.task": 4000,
  "plan.readme": 8192,
  "develop.task": 16384,
  "develop.escalation": 8192,
  "verify.plan": 32768,
  "verify.execute": 8192,
  "chat.session": 16384,
  "chat.quick": 2048,
  "deploy.version": 4096,
  "deploy.iac": 8192,
};

export function getMaxTokens(model: { maxTokens: number }, stage: string): number {
  const configValues = (loadConfig() as Record<string, unknown>)["stage_max_tokens"] as Record<string, number> | undefined;
  const stageDefault = configValues?.[stage] ?? STAGE_MAX_TOKENS[stage] ?? 4096;
  return Math.min(stageDefault, model.maxTokens);
}

// ---------------------------------------------------------------------------
// Bash config (REQ-CFG-9)
// ---------------------------------------------------------------------------

export function getBashConfig(command: string): BashConfig {
  const bash = (loadConfig() as Record<string, unknown>)["bash"] as Record<string, unknown> | undefined;
  const timeout = Number(bash?.["timeout"] ?? 120);
  const maxOutputLines = Number(bash?.["max_output_lines"] ?? 500);
  const cmd = bash?.[command] as Record<string, unknown> | undefined;
  return {
    enabled: cmd?.["enabled"] !== false,
    allowedPatterns: (cmd?.["allowed_patterns"] as string[]) ?? [],
    timeout: Number(cmd?.["timeout"] ?? timeout),
    maxOutputLines: Number(cmd?.["max_output_lines"] ?? maxOutputLines),
  };
}

// ---------------------------------------------------------------------------
// ConfigManager — read/write config from CLI (REQ-CFG-1)
// ---------------------------------------------------------------------------

type Validator = (v: unknown) => string | null;
const gt0: Validator = v => typeof v === "number" && v > 0 ? null : "must be a positive number";
const gte0: Validator = v => typeof v === "number" && v >= 0 ? null : "must be a non-negative number";

/** Schema for all valid config keys — type + optional constraint. */
export const CONFIG_SCHEMA: Record<string, { type: "string" | "number" | "boolean" | "array"; validate?: Validator; description: string }> = {
  "models_file":                  { type: "string",  description: "Path to models YAML file" },
  "active_container_file":        { type: "string",  description: "Path to active container marker" },
  "protected_paths":              { type: "array",   description: "Files blocked from agent writes" },
  "allowed_commands":             { type: "array",   description: "Shell commands that bypass security classification" },
  "ssrf_allow_list":              { type: "array",   description: "Hostnames/CIDRs that bypass SSRF blocking" },
  "git.max_diff_lines":           { type: "number",  validate: gt0, description: "Max total lines in git diff output" },
  "git.max_diff_files":           { type: "number",  validate: gt0, description: "Max files in git diff" },
  "git.max_file_diff_lines":      { type: "number",  validate: gt0, description: "Max lines per file in diff" },
  "retention.project":            { type: "number",  validate: gt0, description: "Number of recent project logs to keep" },
  "retention.global":             { type: "number",  validate: gt0, description: "Days of global framework logs to keep" },
  "cache.max_entries":            { type: "number",  validate: gt0, description: "Max analysis cache entries before LRU eviction" },
  "cache.ttl_days":               { type: "number",  validate: gt0, description: "Analysis entries older than this are pruned" },
  "skills.synthesis_model":       { type: "string",  description: "Model alias for skill synthesis" },
  "skills.repos":                 { type: "array",   description: "Skill manifest repo URLs" },
  "bash.timeout":                 { type: "number",  validate: gt0, description: "Default shell timeout (seconds)" },
  "bash.max_output_lines":        { type: "number",  validate: gt0, description: "Max shell output lines before truncation" },
  "bash.develop.enabled":         { type: "boolean", description: "Enable shell in develop command" },
  "bash.develop.timeout":         { type: "number",  validate: gt0, description: "Develop shell timeout" },
  "bash.develop.allowed_patterns": { type: "array",  description: "Develop shell command patterns" },
  "bash.chat.enabled":            { type: "boolean", description: "Enable shell in chat command" },
  "bash.chat.timeout":            { type: "number",  validate: gt0, description: "Chat shell timeout" },
  "bash.chat.allowed_patterns":   { type: "array",   description: "Chat shell command patterns" },
  "bash.verify.enabled":          { type: "boolean", description: "Enable shell in verify command" },
  "bash.verify.timeout":          { type: "number",  validate: gt0, description: "Verify shell timeout" },
  "bash.verify.allowed_patterns": { type: "array",   description: "Verify shell command patterns" },
};

export class ConfigManager {
  private _path: string;

  constructor(home?: string) {
    this._path = join(home ?? voidriftHome(), "config.yml");
  }

  /** Read raw config (no env expansion) for editing. */
  private _readRaw(): Record<string, unknown> {
    if (!existsSync(this._path)) return {};
    return (parseYaml(readFileSync(this._path, "utf-8")) ?? {}) as Record<string, unknown>;
  }

  private _write(data: Record<string, unknown>): void {
    mkdirSync(join(this._path, ".."), { recursive: true });
    writeFileSync(this._path, stringifyYaml(data), "utf-8");
    clearConfigCache();
  }

  /** Get a value by dot-notation key (e.g. "skills.synthesis_model"). */
  get(key: string): unknown {
    const parts = key.split(".");
    let obj: unknown = this._readRaw();
    for (const p of parts) {
      if (obj === null || typeof obj !== "object") return undefined;
      obj = (obj as Record<string, unknown>)[p];
    }
    return obj;
  }

  /** Set a value by dot-notation key. Creates intermediate objects as needed. */
  set(key: string, value: unknown): void {
    const data = this._readRaw();
    const parts = key.split(".");
    let obj = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj) || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
    this._write(data);
  }

  /** Delete a key. */
  delete(key: string): void {
    const data = this._readRaw();
    const parts = key.split(".");
    let obj = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj)) return;
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    delete obj[parts[parts.length - 1]];
    this._write(data);
  }

  /** Validate a key and value against CONFIG_SCHEMA. Returns error message or null. */
  validate(key: string, value: unknown): string | null {
    const schema = CONFIG_SCHEMA[key];
    if (!schema) return `Unknown setting '${key}'. Use /settings to see valid keys.`;

    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== schema.type) return `${key} must be ${schema.type}, got ${actualType}.`;

    if (schema.validate) {
      const err = schema.validate(value);
      if (err) return `${key}: ${err}.`;
    }

    return null;
  }

  /** List all config as flat dot-notation key-value pairs. */
  list(): Array<[string, unknown]> {
    const results: Array<[string, unknown]> = [];
    const walk = (obj: unknown, prefix: string) => {
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        results.push([prefix, obj]);
        return;
      }
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    };
    walk(this._readRaw(), "");
    return results;
  }
}
