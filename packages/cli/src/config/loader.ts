import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface ModelConfig {
  model_id: string;
  base_url: string;
  api_key: string;
  protocol: string;
  max_tokens: number;
  max_context: number;
}

interface ModelsFile {
  default_model: string;
  models: Record<string, ModelConfig>;
}

function resolveEnvVar(value: string): string {
  const match = value.match(/^\$\{(\w+)(?::-(.*))?\}$/);
  if (!match) return value;
  return process.env[match[1]] || match[2] || "";
}

/**
 * Config resolution order:
 * 1. .voidrift/models.json in cwd (workspace override)
 * 2. ~/.config/voidrift/models.json (global)
 */
export function loadConfig(cwd: string = process.cwd()): { model: ModelConfig; modelName: string } {
  const workspacePath = join(cwd, ".voidrift", "models.json");
  const globalPath = join(process.env.HOME || "/", ".config", "voidrift", "models.json");

  let configPath: string;
  if (existsSync(workspacePath)) {
    configPath = workspacePath;
  } else if (existsSync(globalPath)) {
    configPath = globalPath;
  } else {
    throw new Error(`No config found. Checked:\n  ${workspacePath}\n  ${globalPath}`);
  }

  const raw: ModelsFile = JSON.parse(readFileSync(configPath, "utf-8"));
  const modelName = raw.default_model;
  const model = raw.models[modelName];
  if (!model) {
    throw new Error(`Model "${modelName}" not found in ${configPath}`);
  }
  return { model: { ...model, api_key: resolveEnvVar(model.api_key) }, modelName };
}
