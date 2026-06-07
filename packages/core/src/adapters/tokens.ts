/**
 * Token Counting.
 *
 * Uses LangChain's .getNumTokens() for provider-accurate token counts
 * instead of rough character-based estimation.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Counts tokens for a single text string using the model's tokenizer.
 */
export async function countTokens(model: BaseChatModel, text: string): Promise<number> {
  return model.getNumTokens(text);
}

/**
 * Counts total tokens across an array of messages.
 */
export async function countMessageTokens(model: BaseChatModel, messages: BaseMessage[]): Promise<number> {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    total += await model.getNumTokens(content);
    // Overhead per message (role, formatting) — approximate 4 tokens
    total += 4;
  }
  return total;
}
