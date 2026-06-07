/**
 * Model Router as RunnableBranch.
 *
 * Replaces if/else tier routing with a declarative RunnableBranch.
 * Each branch condition maps to a tier; the default is flash.
 */
import { RunnableBranch } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createTierAdapter, type Tier } from "../adapters/factory.js";
import type { VoidRiftConfig } from "../config/loader.js";

export interface RouterInput {
  inputLength: number;
  mentionedFiles: number;
  explicitTier?: Tier | "auto";
}

/**
 * Creates a RunnableBranch that routes to the appropriate model tier.
 */
export function createModelRouter(config: VoidRiftConfig): RunnableBranch<RouterInput, BaseChatModel> {
  return RunnableBranch.from([
    // Explicit tier override
    [(input: RouterInput) => input.explicitTier === "dense", () => createTierAdapter("dense", config).client as BaseChatModel],
    [(input: RouterInput) => input.explicitTier === "utility", () => createTierAdapter("utility", config).client as BaseChatModel],
    [(input: RouterInput) => input.explicitTier === "flash", () => createTierAdapter("flash", config).client as BaseChatModel],
    // Auto routing by complexity
    [(input: RouterInput) => input.inputLength >= 500 || input.mentionedFiles > 3, () => createTierAdapter("dense", config).client as BaseChatModel],
    [(input: RouterInput) => input.inputLength >= 100 || input.mentionedFiles > 1, () => createTierAdapter("utility", config).client as BaseChatModel],
    // Default: flash
    () => createTierAdapter("flash", config).client as BaseChatModel,
  ]) as unknown as RunnableBranch<RouterInput, BaseChatModel>;
}
