/**
 * Framework configuration loader (REQ-CFG-1..4).
 *
 * Loads config from ~/.voidrift/config.yml with env var expansion.
 * Operational limits live on each model entry in the models file.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

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
