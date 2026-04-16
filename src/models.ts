/**
 * Model alias resolution (REQ-MC-1, REQ-MC-3, REQ-MC-5).
 *
 * Resolves aliases to (baseUrl, apiKey, modelId) from a single models file.
 * Each entry carries its own operational limits; a defaults section provides fallbacks.
 */

import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { expandConfigRefs, getModelsFile } from "./config.js";
import { getAdapter, type ProtocolAdapter } from "./agent/protocol.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelConfig {
  alias: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  protocol: "openai" | "anthropic";
  provider?: string;
  modelType?: string;
  maxTokens: number;
  maxContext?: number;
  maxReadLines: number;
  maxInputChars: number;
  concurrency: number;
  fallback?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelInterface {
  config: ModelConfig;
  adapter: ProtocolAdapter;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PROTOCOLS = new Set(["openai", "anthropic"]);

const DEFAULTS: Record<string, unknown> = {
  max_tokens: 16384,
  max_read_lines: 2000,
  max_input_chars: 0,
  concurrency: 1,
};

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function loadModelsFile(): Record<string, unknown> {
  const p = getModelsFile();
  if (!existsSync(p)) return {};
  return parseYaml(readFileSync(p, "utf-8")) ?? {};
}

function loadModels(): Record<string, Record<string, unknown>> {
  const data = loadModelsFile();
  const defaults = { ...DEFAULTS, ...(data.defaults as Record<string, unknown> ?? {}) };
  const models = (data.models as Record<string, Record<string, unknown>>) ?? {};
  const merged: Record<string, Record<string, unknown>> = {};
  for (const [alias, entry] of Object.entries(models)) {
    merged[alias] = { ...defaults, ...entry };
  }
  return merged;
}

function validateEntry(alias: string, m: Record<string, unknown>): void {
  for (const field of ["base_url", "api_key", "model_id"]) {
    if (!(field in m)) {
      throw new Error(
        `Model '${alias}' is missing required field '${field}'. ` +
        "Run 'voidrift doctor' to diagnose your model configuration."
      );
    }
  }
  const protocol = String(m.protocol ?? "openai");
  if (!VALID_PROTOCOLS.has(protocol)) {
    throw new Error(
      `Model '${alias}' has invalid protocol '${protocol}'. ` +
      `Valid values: ${[...VALID_PROTOCOLS].sort().join(", ")}. ` +
      "Run 'voidrift doctor' to diagnose your model configuration."
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveModel(alias: string): ModelInterface {
  const models = loadModels();
  if (!(alias in models)) {
    const available = Object.keys(models).sort().join(", ");
    throw new Error(`Unknown model: ${alias}. Available: ${available}`);
  }
  const m = models[alias];
  validateEntry(alias, m);

  const config: ModelConfig = {
    alias,
    modelId: String(m.model_id),
    baseUrl: expandConfigRefs(String(m.base_url)),
    apiKey: expandConfigRefs(String(m.api_key)),
    protocol: (m.protocol as "openai" | "anthropic") ?? "openai",
    provider: m.provider ? String(m.provider) : undefined,
    modelType: m.type ? String(m.type) : undefined,
    maxTokens: Number(m.max_tokens ?? 16384),
    maxContext: m.max_context != null ? Number(m.max_context) : undefined,
    maxReadLines: Number(m.max_read_lines ?? 2000),
    maxInputChars: Number(m.max_input_chars ?? 0),
    concurrency: Number(m.concurrency ?? 1),
    fallback: m.fallback ? String(m.fallback) : undefined,
    maxInputTokens: m.max_input_tokens != null ? Number(m.max_input_tokens) : undefined,
    maxOutputTokens: m.max_output_tokens != null ? Number(m.max_output_tokens) : undefined,
  };

  return { config, adapter: getAdapter(config.protocol) };
}

export function listAliases(): string[] {
  return Object.keys(loadModels()).sort();
}
