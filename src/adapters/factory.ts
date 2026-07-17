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
const DEFAULT_TIMEOUT_MS = 120_000;

function resolveApiKey(config: ModelConfig): string | undefined {
  if (!config.apiKeyEnv) return undefined;
  return process.env[config.apiKeyEnv];
}

function createClient(config: ModelConfig, maxConcurrency?: number, networkConfig?: { retries?: number; timeoutMs?: number }): BaseChatModel {
  const apiKey = resolveApiKey(config);
  const { protocol, model, baseUrl, apiKeyEnv, contextLimit, additionalHeaders, ...customParams } = config;
  const maxRetries = networkConfig?.retries ?? DEFAULT_MAX_RETRIES;
  const timeout = networkConfig?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  switch (protocol) {
    case "openai": {
      const { maxOutputTokens, ...rest } = customParams;
      return new ChatOpenAI({
        apiKey: apiKey || "not-needed",
        modelName: model,
        configuration: { baseURL: baseUrl },
        streaming: true,
        maxRetries: maxRetries,
        timeout: timeout,
        maxConcurrency,
        maxTokens: maxOutputTokens,
        ...rest,
      });
    }

    case "anthropic": {
      const headers = { ...additionalHeaders, "anthropic-beta": "prompt-caching-2024-07-31" };
      return new ChatAnthropic({
        apiKey: apiKey,
        modelName: model,
        maxTokens: (customParams as any).maxOutputTokens ?? 4096,
        clientOptions: baseUrl && !baseUrl.includes("api.anthropic.com")
          ? { baseURL: baseUrl, timeout: timeout, defaultHeaders: headers }
          : { timeout: timeout, defaultHeaders: headers },
        streaming: true,
        maxRetries: maxRetries,
        maxConcurrency,
        ...customParams,
      });
    }

    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        model,
        streaming: true,
        maxRetries: maxRetries,
        maxConcurrency,
        ...customParams,
      });

    default:
      throw new Error(`Unknown protocol: ${protocol}`);
  }
}

export function createAdapter(modelName: string, appConfig: VoidRiftConfig): ResolvedModel {
  const config = appConfig.models[modelName];
  if (!config) throw new Error(`Model "${modelName}" not found in config`);
  return { name: modelName, config, client: createClient(config, appConfig.tasksMaxConcurrent, { retries: appConfig.networkModelRetries, timeoutMs: appConfig.networkModelTimeoutMs }) };
}

export function createTierAdapter(tier: Tier, appConfig: VoidRiftConfig): ResolvedModel {
  const modelName = tier === "flash" ? appConfig.modelTierFlash : tier === "utility" ? appConfig.modelTierUtility : appConfig.modelTierDense;
  return createAdapter(modelName, appConfig);
}
