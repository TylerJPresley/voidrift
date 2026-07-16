/**
 * Model Streaming.
 *
 * Uses .stream() as the primary streaming method (works universally on all
 * BaseChatModel, RunnableBinding, and bound-tool models).
 *
 * AIMessageChunk.concat() handles fragment accumulation for tool calls.
 * Usage metadata extracted from final chunk.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { StreamChunk, ToolCallChunk, ModelResponse, TokenUsage } from "./types.js";

export type OnChunk = (chunk: StreamChunk) => void;

/**
 * Streams a model invocation using .stream() for universal compatibility.
 * Accumulates AIMessageChunks via .concat() for tool call assembly.
 */
export async function streamModel(
  client: BaseChatModel,
  messages: BaseMessage[],
  onChunk: OnChunk,
  signal?: AbortSignal
): Promise<ModelResponse> {
  let text = "";
  let accumulated: AIMessageChunk | null = null;
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const requestStart = Date.now();
  let firstTokenAt: number | null = null;

  if (signal?.aborted) {
    return { text: "", toolCalls: [], usage, timing: { requestStart, firstTokenAt: null, endAt: Date.now() } };
  }

  // Enforce: system messages must be at the beginning (OpenAI-compatible requirement)
  validateMessageOrder(messages);

  try {
    const stream = await client.stream(messages, { signal });

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;

        // Extract text content
        const content = extractContent(chunk.content);
        if (content) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          text += content;
          onChunk({ type: "content", text: content });
        }

        // Extract reasoning_content from additional_kwargs (OpenAI-compatible reasoning models)
        const reasoning = (chunk as any).additional_kwargs?.reasoning_content;
        if (reasoning && typeof reasoning === "string") {
          if (!firstTokenAt) firstTokenAt = Date.now();
          onChunk({ type: "reasoning", text: reasoning });
        }

        // Extract thinking/reasoning from content blocks (Anthropic extended thinking)
        if (Array.isArray(chunk.content)) {
          for (const block of chunk.content as any[]) {
            if ((block.type === "thinking" || block.type === "reasoning") && (block.thinking || block.reasoning || block.text)) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              onChunk({ type: "reasoning", text: block.thinking || block.reasoning || block.text });
            }
          }
        }

        // Accumulate chunks via LangChain's .concat() for tool call assembly
        if (accumulated && typeof accumulated.concat === "function") {
          accumulated = accumulated.concat(chunk);
        } else if (!accumulated) {
          accumulated = chunk;
        } else {
          // Fallback: manually merge tool_call_chunks for non-AIMessageChunk objects
          const prevChunks = (accumulated as any).tool_call_chunks || [];
          const newChunks = chunk.tool_call_chunks || [];
          const prevCalls = (accumulated as any).tool_calls || [];
          const newCalls = chunk.tool_calls || [];
          accumulated = {
            ...accumulated,
            content: (accumulated.content || "") + (extractContent(chunk.content) || ""),
            tool_call_chunks: [...prevChunks, ...newChunks],
            tool_calls: [...prevCalls, ...newCalls],
          } as any;
        }

        // Usage metadata (usually on final chunk)
        if (chunk.usage_metadata) {
          usage = {
            promptTokens: chunk.usage_metadata.input_tokens ?? 0,
            completionTokens: chunk.usage_metadata.output_tokens ?? 0,
            totalTokens: chunk.usage_metadata.total_tokens ?? 0,
            cacheReadTokens: (chunk.usage_metadata as any).cache_read_input_tokens
              ?? (chunk.usage_metadata as any).input_token_details?.cache_read
              ?? undefined,
            cacheCreationTokens: (chunk.usage_metadata as any).cache_creation_input_tokens ?? undefined,
          };
        }
      }
    } catch (err: unknown) {
      // Mid-stream error
      if (signal?.aborted) {
        return { text, toolCalls: extractToolCalls(accumulated), usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
      }
      const message = err instanceof Error ? err.message : String(err);
      onChunk({ type: "error", message, retryable: isRetryable(message) });
      return { text, toolCalls: extractToolCalls(accumulated), usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
    }
  } catch (err: unknown) {
    // Pre-stream error (failed to initiate)
    if (signal?.aborted) {
      return { text, toolCalls: [], usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
    }
    const message = err instanceof Error ? err.message : String(err);
    onChunk({ type: "error", message, retryable: isRetryable(message) });
    return { text, toolCalls: [], usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
  }

  // Extract tool calls from the accumulated AIMessageChunk
  const toolCalls = extractToolCalls(accumulated);

  // Detect partial/failed tool calls: chunks exist but nothing assembled
  if (toolCalls.length === 0 && accumulated?.tool_call_chunks?.length) {
    onChunk({ type: "error", message: "Model attempted a tool call but it was malformed or truncated.", retryable: true });
  }

  onChunk({ type: "done", usage });
  return { text, toolCalls, usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
}

/**
 * Extracts tool calls from the fully accumulated AIMessageChunk.
 * LangChain's .concat() assembles partial tool_call_chunks into complete tool_calls.
 */
function extractToolCalls(accumulated: AIMessageChunk | null): ToolCallChunk[] {
  if (!accumulated) return [];

  // Prefer fully-assembled tool_calls (from .concat() accumulation)
  if (accumulated.tool_calls?.length) {
    return accumulated.tool_calls.map((tc) => ({
      type: "tool_call" as const,
      id: tc.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
      name: tc.name,
      args: JSON.stringify(tc.args),
    }));
  }

  // Fallback: assemble from tool_call_chunks if tool_calls is empty
  if (accumulated.tool_call_chunks?.length) {
    const map = new Map<number, { id: string; name: string; args: string }>();
    for (const chunk of accumulated.tool_call_chunks) {
      const idx = chunk.index ?? map.size;
      const existing = map.get(idx);
      if (existing) {
        if (chunk.id) existing.id = chunk.id;
        if (chunk.name) existing.name = chunk.name;
        existing.args += chunk.args || "";
      } else {
        map.set(idx, { id: chunk.id || "", name: chunk.name || "", args: chunk.args || "" });
      }
    }
    return [...map.values()].map((tc) => ({
      type: "tool_call" as const,
      id: tc.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
      name: tc.name,
      args: tc.args,
    }));
  }

  return [];
}

/**
 * Extracts text from LangChain chunk content (string or content blocks).
 */
function extractContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text" || (block.text && block.type !== "thinking" && block.type !== "reasoning"))
      .map((block: any) => block.text || "")
      .join("");
  }
  return "";
}

function isRetryable(message: string): boolean {
  const retryPatterns = [/rate.?limit/i, /429/, /503/, /timeout/i, /ECONNRESET/, /ECONNREFUSED/];
  return retryPatterns.some((p) => p.test(message));
}

/**
 * Validates message ordering before sending to the model.
 * Throws if system messages appear after non-system messages (violates OpenAI-compatible spec).
 */
function validateMessageOrder(messages: BaseMessage[]): void {
  let seenNonSystem = false;
  for (const msg of messages) {
    const type = msg._getType();
    if (type !== "system") {
      seenNonSystem = true;
    } else if (seenNonSystem) {
      throw new Error(
        `Invalid message order: SystemMessage found after conversation start. ` +
        `System messages must be at the beginning. Got: ${messages.map(m => m._getType()).join(", ")}`
      );
    }
  }
}
