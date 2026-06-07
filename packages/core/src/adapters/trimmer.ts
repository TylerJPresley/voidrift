/**
 * Message Trimming.
 *
 * Uses LangChain's trimMessages for smart context window management.
 * Preserves system messages and recent turns, trims from the middle.
 */
import { trimMessages } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface TrimOptions {
  /** Max tokens for the message history (not including system prompt) */
  maxTokens: number;
  /** Keep the system message untouched */
  includeSystem?: boolean;
  /** Strategy: keep last N messages or trim from start */
  strategy?: "last" | "first";
}

/**
 * Trims messages to fit within a token budget using LangChain's native trimmer.
 * Defaults to keeping the most recent messages (strategy: "last").
 */
export async function trimContextMessages(
  model: BaseChatModel,
  messages: BaseMessage[],
  options: TrimOptions
): Promise<BaseMessage[]> {
  return trimMessages(messages, {
    maxTokens: options.maxTokens,
    tokenCounter: (msgs) => countTokensForTrim(model, msgs),
    strategy: options.strategy ?? "last",
    includeSystem: options.includeSystem ?? true,
    allowPartial: false,
  });
}

async function countTokensForTrim(model: BaseChatModel, messages: BaseMessage[]): Promise<number> {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    total += await model.getNumTokens(content) + 4;
  }
  return total;
}
