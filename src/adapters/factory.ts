import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelConfig, VoidRiftConfig } from "../config/loader.js";

export type Tier = "flash" | "utility" | "dense";

export interface ResolvedModel {
  name: string;
  config: ModelConfig;
  client: BaseChatModel;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

function resolveApiKey(config: ModelConfig): string | undefined {
  if (!config.apiKeyEnv) return undefined;
  return process.env[config.apiKeyEnv];
}

function createClient(config: ModelConfig, maxConcurrency?: number): BaseChatModel {
  const apiKey = resolveApiKey(config);

  switch (config.protocol) {
    case "openai":
      return new ChatOpenAI({
        apiKey: apiKey || "not-needed",
        modelName: config.model,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
        topP: config.topP,
        configuration: { baseURL: config.baseUrl },
        streaming: true,
        maxRetries: DEFAULT_MAX_RETRIES,
        timeout: DEFAULT_TIMEOUT_MS,
        maxConcurrency,
      });

    case "anthropic": {
      const headers = { ...config.additionalHeaders, "anthropic-beta": "prompt-caching-2024-07-31" };
      return new ChatAnthropic({
        apiKey: apiKey,
        modelName: config.model,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens ?? 4096,
        topP: config.topP,
        topK: config.topK,
        clientOptions: config.baseUrl && !config.baseUrl.includes("api.anthropic.com")
          ? { baseURL: config.baseUrl, timeout: DEFAULT_TIMEOUT_MS, defaultHeaders: headers }
          : { timeout: DEFAULT_TIMEOUT_MS, defaultHeaders: headers },
        streaming: true,
        maxRetries: DEFAULT_MAX_RETRIES,
        maxConcurrency,
      });
    }

    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        model: config.model,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        topP: config.topP,
        topK: config.topK,
        streaming: true,
        maxRetries: DEFAULT_MAX_RETRIES,
        maxConcurrency,
      });

    default:
      throw new Error(`Unknown protocol: ${(config as ModelConfig).protocol}`);
  }
}

export function createAdapter(modelName: string, appConfig: VoidRiftConfig): ResolvedModel {
  const config = appConfig.models[modelName];
  if (!config) throw new Error(`Model "${modelName}" not found in config`);
  return { name: modelName, config, client: createClient(config, appConfig.maxConcurrentAgents) };
}

export function createTierAdapter(tier: Tier, appConfig: VoidRiftConfig): ResolvedModel {
  const modelName = appConfig.tiers[tier];
  return createAdapter(modelName, appConfig);
}
