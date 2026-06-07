/**
 * LangChain Fallback Chains.
 *
 * Wraps tier-based models with .withFallbacks() so that
 * flash → utility → dense happens automatically on failure.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { VoidRiftConfig } from "../config/loader.js";
import { createTierAdapter, type Tier } from "./factory.js";

const TIER_ORDER: Tier[] = ["flash", "utility", "dense"];

/**
 * Creates a model with automatic fallback chain.
 * If the primary tier fails, it escalates through the chain.
 */
export function createFallbackChain(primaryTier: Tier, config: VoidRiftConfig): BaseChatModel {
  const primaryIdx = TIER_ORDER.indexOf(primaryTier);
  const primary = createTierAdapter(primaryTier, config).client;

  const fallbacks = TIER_ORDER
    .slice(primaryIdx + 1)
    .map(tier => createTierAdapter(tier, config).client);

  if (fallbacks.length === 0) return primary;

  return primary.withFallbacks({ fallbacks }) as unknown as BaseChatModel;
}
