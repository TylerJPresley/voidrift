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
  maxOutputTokens: z.number().positive().optional(),
  preflight: z.boolean().optional().describe("Run preflight tool classifier before each turn. Default true. Set false for capable models to skip the utility call."),
  additionalHeaders: z.record(z.string()).optional(),
  // All other fields (temperature, maxOutputTokens, topP, topK, max_completion_tokens, etc.)
  // are preserved via .passthrough() and forwarded directly to the model client.
}).passthrough();

const SUPPORTED_EDITORS = ["vscode", "code", "cursor", "windsurf", "zed", "vim", "nvim", "neovim", "emacs", "nano", "subl", "kate"] as const;

const EditorSchema = z.enum(SUPPORTED_EDITORS).optional();

export const ConfigSchema = z.object({
  // ─── Model definitions (nested — dynamic content) ──────────────────────────
  models: z.record(ModelSchema),
  // ─── Nested objects (dynamic maps) ─────────────────────────────────────────
  plugins: z.array(z.string()).default([]),
  hooks: z.record(z.array(z.string())).default({}).describe("Event hooks: map of event name → shell commands to run"),
  mcp: z.record(z.object({
    transport: z.enum(["stdio", "http-sse"]).optional(),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    autoConnect: z.boolean().default(true),
    auth: z.object({
      type: z.literal("oauth2"),
      authorizeUrl: z.string(),
      tokenUrl: z.string(),
      clientId: z.string().optional(),
      clientIdEnv: z.string().optional(),
      clientSecret: z.string().optional(),
      clientSecretEnv: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      tokenEnvVar: z.string(),
      codeChallengeMethod: z.string().optional(),
    }).optional(),
  }).passthrough()).default({}).describe("MCP server configurations keyed by server name"),
  search: z.object({
    provider: z.enum(["duckduckgo", "tavily", "google"]).default("duckduckgo"),
    apiKey: z.string().optional(),
  }).default({ provider: "duckduckgo" }),
  tracing: z.object({
    enabled: z.boolean().default(false),
    apiKeyEnv: z.string().default("LANGCHAIN_API_KEY"),
    project: z.string().default("voidrift"),
    endpoint: z.string().optional(),
  }).default({ enabled: false, apiKeyEnv: "LANGCHAIN_API_KEY", project: "voidrift" }),
  // ─── Top-level ─────────────────────────────────────────────────────────────
  editor: EditorSchema,
  // ─── model* — model selection and routing ──────────────────────────────────
  modelSelected: z.string().min(1).describe("Active model for user turns. Must reference a model in the models block."),
  modelEscalation: z.string().optional().describe("Model for complex reasoning. If set, harness can escalate from selected to this model. If unset, no escalation."),
  modelUtility: z.string().optional().describe("Model for internal harness ops (preflight, summarization). If unset, those features use the selected model or are skipped."),
  modelBackground: z.string().optional().describe("Model for background tasks (/run, routines, subagents). Defaults to modelSelected."),
  modelEscalationThreshold: z.number().min(0.5).max(0.99).default(0.85).describe("Context usage % that triggers auto-escalation to dense."),
  modelEscalationFailureCount: z.number().min(1).default(2).describe("Consecutive failures that trigger auto-escalation."),
  // ─── turns* — per-turn behavior ───────────────────────────────────────────
  turnsMaxToolRounds: z.number().min(0).default(10).describe("Max tool execution rounds per turn. 0 = unlimited."),
  turnsPreflight: z.boolean().optional().describe("Override preflight per workspace. true = always run, false = never run, unset = use model config."),
  turnsTrimThresholdLines: z.number().min(10).default(80).describe("Tool output lines above which output is trimmed."),
  turnsTrimHead: z.number().min(5).default(30).describe("Lines kept from start of trimmed output."),
  turnsTrimTail: z.number().min(5).default(20).describe("Lines kept from end of trimmed output."),
  turnsContextBudgetStopPct: z.number().min(0.1).max(0.95).default(0.6).describe("Stop tools when context exceeds this % of limit."),
  turnsReminderInterval: z.number().min(0).default(25).describe("Behavioral reminder every N tool calls. 0 = disabled."),
  turnsLookbackCount: z.number().min(1).default(2).describe("Recent assistant messages for preflight context."),
  turnsMaxOutputLines: z.number().min(10).default(50).describe("Shell output truncation threshold (lines)."),
  turnsMaxReadLines: z.number().min(100).default(2000).describe("Max lines returned by read_file without offset/limit."),
  turnsSuggestionThreshold: z.number().min(1).default(3).describe("Pattern repeats before trace analyzer suggests."),
  turnsShowThinking: z.boolean().default(false).describe("Show thinking chunks in conversation."),
  turnsShowReasoning: z.boolean().default(false).describe("Show reasoning chunks in conversation."),
  // ─── tasks* — background execution ────────────────────────────────────────
  tasksMaxRunTurns: z.number().min(1).default(50).describe("Max turns in a /run autonomous loop."),
  tasksMaxConcurrent: z.number().min(1).default(1).describe("Max simultaneous background subagents."),
  tasksWorktreeTtlMinutes: z.number().min(10).default(120).describe("Stale worktree TTL before cleanup."),
  tasksPlanFeedbackLoop: z.number().min(0).max(2).default(1).describe("0=off, 1=learn from errors, 2=learn from every completion."),
  tasksShowThinking: z.boolean().default(false).describe("Show thinking in task output."),
  tasksShowReasoning: z.boolean().default(false).describe("Show reasoning in task output."),
  // ─── context* — context management ────────────────────────────────────────
  contextCompactionKeepRecent: z.number().min(2).default(10).describe("Messages kept during compaction."),
  contextDecayAfterTurns: z.number().min(0).default(20).describe("Auto-compact messages older than N turns. 0 = disabled."),
  contextKeepRecentTurns: z.number().min(1).default(10).describe("Recent messages kept verbatim during decay."),
  contextCodeMapDepth: z.number().min(1).default(5).describe("Workspace map walk depth."),
  contextSummarizeThreshold: z.number().positive().default(500).describe("Lines above which files get summarized."),
  contextReflectionBatchSize: z.number().min(1).default(3).describe("Sessions per batch during /reflection."),
  // ─── security* — permissions ──────────────────────────────────────────────
  securityApprovalTimeout: z.number().min(0).default(120).describe("Seconds to wait for tool approval. 0 = no timeout."),
  // ─── network* — connectivity ──────────────────────────────────────────────
  networkModelRetries: z.number().min(0).default(3).describe("Retries on model API failures."),
  networkModelTimeoutMs: z.number().min(5000).default(120000).describe("Model API call timeout in ms."),
  networkModelFinalTimeoutMs: z.number().min(5000).default(60000).describe("Timeout for final text response after tool execution completes."),
  networkModelRetryTimeoutMs: z.number().min(5000).default(30000).describe("Timeout for retry call when model returns empty response."),
  networkCommandTimeoutMs: z.number().min(1000).default(30000).describe("Shell command timeout in ms."),
  networkFetchTimeoutMs: z.number().min(1000).default(10000).describe("Web fetch timeout in ms."),
  networkOauthCallbackPort: z.number().min(1024).default(9876).describe("OAuth callback localhost port."),
  networkWebMaxContentLength: z.number().min(1000).default(50000).describe("Max characters from web fetch."),
  networkWebSmallFileLines: z.number().min(10).default(50).describe("Web lines below which content is inline."),
  // ─── retention* — cleanup ─────────────────────────────────────────────────
  retentionMaxCacheAgeDays: z.number().min(0).default(14).describe("Purge cache older than N days. 0 = never."),
  retentionMaxSessionCount: z.number().min(0).default(20).describe("Keep at most N sessions. 0 = unlimited."),
  retentionMaxLogAgeDays: z.number().min(0).default(14).describe("Purge logs older than N days. 0 = never."),
}).refine(
  (cfg) => {
    const modelNames = Object.keys(cfg.models);
    if (!modelNames.includes(cfg.modelSelected)) return false;
    if (cfg.modelEscalation && !modelNames.includes(cfg.modelEscalation)) return false;
    if (cfg.modelUtility && !modelNames.includes(cfg.modelUtility)) return false;
    if (cfg.modelBackground && !modelNames.includes(cfg.modelBackground)) return false;
    return true;
  },
  { message: "Model fields must reference a model defined in the models block" }
);

export type VoidRiftConfig = z.infer<typeof ConfigSchema>;
export type ModelConfig = z.infer<typeof ModelSchema>;
export type EditorType = typeof SUPPORTED_EDITORS[number];

/** Helper: look up which model is assigned to a tier role */
export function getTierModel(config: VoidRiftConfig, tier: "selected" | "utility" | "escalation"): string {
  if (tier === "selected") return config.modelSelected;
  if (tier === "utility") return config.modelUtility || config.modelSelected;
  return config.modelEscalation || config.modelSelected;
}

export interface LoadConfigOptions {
  globalConfigPath?: string;
  workspaceRoot?: string;
}

const DEFAULT_CONFIG = {
  models: {
    "default-local": {
      protocol: "openai",
      model: "qwen2.5-coder-7b-instruct",
      baseUrl: "http://localhost:11434/v1",
      contextLimit: 32768,
      temperature: 0.2,
    },
  },
  modelSelected: "default-local",
  plugins: [],
  hooks: {},
  mcp: {},
  search: { provider: "duckduckgo" as const },
  tracing: { enabled: false, apiKeyEnv: "LANGCHAIN_API_KEY", project: "voidrift" },
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

  // Ensure global subdirectories exist (every boot)
  const globalDir = dirname(globalPath);
  for (const sub of ["agents", "skills", "memory", "templates", "prompts", "logs"]) {
    mkdirSync(join(globalDir, sub), { recursive: true });
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

  // Migration: map old tier fields to new schema
  const m = merged as Record<string, unknown>;
  if (m.modelTierFlash && !m.modelSelected) m.modelSelected = m.modelTierFlash;
  if (m.modelTierDense && !m.modelEscalation && m.modelTierDense !== m.modelTierFlash) m.modelEscalation = m.modelTierDense;
  if (m.modelTierUtility && !m.modelUtility && m.modelTierUtility !== m.modelTierFlash) m.modelUtility = m.modelTierUtility;
  if (m.modelSelected === "auto" && m.modelTierFlash) m.modelSelected = m.modelTierFlash as string;
  delete m.modelTierFlash; delete m.modelTierUtility; delete m.modelTierDense;

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

  // Apply tracing config — LangChain reads these env vars internally
  if (config.tracing.enabled) {
    process.env.LANGCHAIN_TRACING_V2 = "true";
    process.env.LANGCHAIN_PROJECT = config.tracing.project;
    if (config.tracing.endpoint) {
      process.env.LANGCHAIN_ENDPOINT = config.tracing.endpoint;
    }
    const tracingKey = process.env[config.tracing.apiKeyEnv];
    if (tracingKey) {
      process.env.LANGCHAIN_API_KEY = tracingKey;
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
