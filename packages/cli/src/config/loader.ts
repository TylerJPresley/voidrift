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

export function loadConfig(cwd: string = process.cwd()): { model: ModelConfig; modelName: string } {
  const configPath = join(cwd, ".voidrift", "models.json");
  if (!existsSync(configPath)) {
    throw new Error(`No config found at ${configPath}`);
  }
  const raw: ModelsFile = JSON.parse(readFileSync(configPath, "utf-8"));
  const modelName = raw.default_model;
  const model = raw.models[modelName];
  if (!model) {
    throw new Error(`Model "${modelName}" not found in config`);
  }
  return { model: { ...model, api_key: resolveEnvVar(model.api_key) }, modelName };
}
