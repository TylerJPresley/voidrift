/**
 * Doctor command: diagnostic checks (REQ-U-16).
 */

import { existsSync, readFileSync, mkdirSync, accessSync, constants, statfsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { voidriftHome, getModelsFile } from "../config.js";

export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

const VALID_PROTOCOLS = new Set(["openai", "anthropic"]);

export function runChecks(fix = false): CheckResult[] {
  const results: CheckResult[] = [];
  const home = voidriftHome();
  let configOk = false;

  // Config file
  const configPath = join(home, "config.yml");
  if (!existsSync(configPath)) {
    results.push({ name: "config", status: "warn", message: `${configPath} not found` });
  } else {
    try {
      parseYaml(readFileSync(configPath, "utf-8"));
      results.push({ name: "config", status: "pass", message: "config.yml valid" });
      configOk = true;
    } catch (e: unknown) {
      results.push({ name: "config", status: "fail", message: `config.yml parse error: ${e instanceof Error ? e.message : e}` });
    }
  }

  // Models file — skip if config is broken
  if (configOk || !existsSync(configPath)) {
    let modelsPath: string;
    try { modelsPath = getModelsFile(); } catch { modelsPath = ""; }
    if (!modelsPath || !existsSync(modelsPath)) {
      results.push({ name: "models_file", status: "fail", message: `models file not found` });
    } else {
      try {
        const data = parseYaml(readFileSync(modelsPath, "utf-8")) ?? {};
        results.push({ name: "models_file", status: "pass", message: "models file valid" });
        const models = (data.models ?? {}) as Record<string, Record<string, unknown>>;
        let allValid = true;
        for (const [alias, entry] of Object.entries(models)) {
          for (const field of ["base_url", "api_key", "model_id"]) {
            if (!(field in entry)) {
              results.push({ name: "model_entry", status: "fail", message: `Model '${alias}' missing '${field}'` });
              allValid = false;
            }
          }
          const protocol = entry.protocol ? String(entry.protocol) : "openai";
          if (!VALID_PROTOCOLS.has(protocol)) {
            results.push({ name: "model_entry", status: "fail", message: `Model '${alias}' invalid protocol '${protocol}'` });
            allValid = false;
          }
        }
        if (allValid && Object.keys(models).length) {
          results.push({ name: "model_entries", status: "pass", message: `${Object.keys(models).length} model(s) valid` });
        }
      } catch (e) {
        results.push({ name: "models_file", status: "fail", message: `models file parse error: ${e}` });
      }
    }
  }

  // Log directory
  const logDir = join(home, "logs");
  if (!existsSync(logDir)) {
    if (fix) {
      mkdirSync(logDir, { recursive: true });
      results.push({ name: "log_dir", status: "pass", message: "log directory created" });
    } else {
      results.push({ name: "log_dir", status: "warn", message: `${logDir} missing. Run with --fix to create.` });
    }
  } else {
    try {
      accessSync(logDir, constants.W_OK);
      results.push({ name: "log_dir", status: "pass", message: "log directory writable" });
    } catch {
      results.push({ name: "log_dir", status: "fail", message: "log directory not writable" });
    }
  }

  // Disk space
  try {
    const stats = statfsSync(".");
    const availGb = (stats.bavail * stats.bsize) / (1024 ** 3);
    results.push({
      name: "disk_space",
      status: availGb < 0.1 ? "fail" : availGb < 1.0 ? "warn" : "pass",
      message: `${availGb.toFixed(1)} GB available`,
    });
  } catch {
    results.push({ name: "disk_space", status: "warn", message: "could not check disk space" });
  }

  // Skills directory
  const skillsDir = join(home, "resources", "skills");
  results.push(existsSync(skillsDir)
    ? { name: "skills", status: "pass", message: "skills directory present" }
    : { name: "skills", status: "warn", message: "skills directory not found" });

  return results;
}

export function formatResults(results: CheckResult[]): string {
  return results.map(r => {
    const icon = r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗";
    return `  ${icon} ${r.name}: ${r.message}`;
  }).join("\n");
}
