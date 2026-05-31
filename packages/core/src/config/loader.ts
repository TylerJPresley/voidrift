import { z } from "zod";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const ModelSchema = z.object({
  protocol: z.enum(["openai", "anthropic", "google"]),
  model: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKeyEnv: z.string().optional(),
  contextLimit: z.number().positive(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().positive().optional(),
  additionalHeaders: z.record(z.string()).optional(),
});

const TiersSchema = z.object({
  flash: z.string().min(1),
  utility: z.string().min(1),
  dense: z.string().min(1),
});

const SUPPORTED_EDITORS = ["vscode", "code", "cursor", "windsurf", "zed", "vim", "nvim", "neovim", "emacs", "nano", "subl", "kate"] as const;

const EditorSchema = z.enum(SUPPORTED_EDITORS).optional();

export const ConfigSchema = z.object({
  tiers: TiersSchema,
  models: z.record(ModelSchema),
  editor: EditorSchema,
  summarizeThreshold: z.number().positive().default(500),
}).refine(
  (cfg) => {
    const modelNames = Object.keys(cfg.models);
    return (
      modelNames.includes(cfg.tiers.flash) &&
      modelNames.includes(cfg.tiers.utility) &&
      modelNames.includes(cfg.tiers.dense)
    );
  },
  { message: "Each tier must reference a model defined in the models block" }
);

export type VoidRiftConfig = z.infer<typeof ConfigSchema>;
export type ModelConfig = z.infer<typeof ModelSchema>;
export type EditorType = typeof SUPPORTED_EDITORS[number];

export interface LoadConfigOptions {
  globalConfigPath?: string;
  workspaceRoot?: string;
}

const DEFAULT_CONFIG: VoidRiftConfig = {
  tiers: { flash: "default-local", utility: "default-local", dense: "default-local" },
  models: {
    "default-local": {
      protocol: "openai",
      model: "qwen2.5-coder-7b-instruct",
      baseUrl: "http://localhost:11434/v1",
      contextLimit: 32768,
      temperature: 0.2,
    },
  },
};

/**
 * Loads and validates the VoidRift configuration.
 *
 * Resolution order:
 * 1. Load global config from ~/.config/voidrift/config.json (or custom path)
 * 2. If global doesn't exist on first run, create it with defaults
 * 3. If workspaceRoot provided, load <workspace>/.voidrift/config.json
 * 4. Deep merge local over global
 * 5. Validate with zod schema
 * 6. Resolve apiKeyEnv references from process.env
 */
export function loadConfig(opts: LoadConfigOptions = {}): VoidRiftConfig {
  const globalPath = opts.globalConfigPath ?? join(homedir(), ".config", "voidrift", "config.json");

  // First-run: create global config directory and default config
  if (!existsSync(globalPath)) {
    const dir = dirname(globalPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(globalPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  const globalRaw = loadJsonFile(globalPath);
  if (globalRaw === null) {
    throw new Error(`Failed to read global config at: ${globalPath}`);
  }

  // Load local workspace override if workspace provided
  let localRaw: unknown | null = null;
  if (opts.workspaceRoot) {
    const localPath = join(opts.workspaceRoot, ".voidrift", "config.json");
    localRaw = loadJsonFile(localPath);
  }

  const merged = localRaw
    ? deepMerge(globalRaw as Record<string, unknown>, localRaw as Record<string, unknown>)
    : globalRaw;

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid VoidRift config:\n${issues}`);
  }

  return resolveApiKeys(result.data);
}

function loadJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

function resolveApiKeys(config: VoidRiftConfig): VoidRiftConfig {
  const models = { ...config.models };
  const warnings: string[] = [];

  for (const [name, model] of Object.entries(models)) {
    if (model.apiKeyEnv && !process.env[model.apiKeyEnv]) {
      warnings.push(`env var "${model.apiKeyEnv}" not set for model "${name}"`);
    }
  }

  if (warnings.length) {
    console.warn(`[VoidRift Config] ${warnings.join("; ")}`);
  }

  return { ...config, models };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      out[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      out[key] = sv;
    }
  }
  return out;
}
