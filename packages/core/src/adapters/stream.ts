/**
 * LangChain streamEvents-based model streaming.
 *
 * Uses streamEvents() v2 for full lifecycle visibility:
 * - on_llm_stream: token-by-token content
 * - on_llm_end: usage metadata, complete response
 * - on_retry: fallback/retry visibility
 * - Automatic LangSmith tracing integration
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { StreamChunk, ToolCallChunk, ModelResponse, TokenUsage } from "./types.js";

export type OnChunk = (chunk: StreamChunk) => void;

/**
 * Streams a model invocation using streamEvents() for full lifecycle visibility.
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

  try {
    const stream = client.streamEvents(messages, { version: "v2", signal });

    for await (const event of stream) {
      if (signal?.aborted) break;

      switch (event.event) {
        case "on_llm_stream": {
          const chunk = event.data.chunk;

          // Extract text content from this chunk
          const content = extractContent(chunk?.content);
          if (content) {
            if (!firstTokenAt) firstTokenAt = Date.now();
            text += content;
            onChunk({ type: "content", text: content });
          }

          // Accumulate for tool calls — use .concat() if available (real AIMessageChunk)
          if (chunk) {
            if (accumulated && typeof accumulated.concat === "function") {
              accumulated = accumulated.concat(chunk);
            } else if (!accumulated) {
              accumulated = chunk;
            } else {
              // Fallback: merge tool_calls arrays manually for plain objects
              const existing = (accumulated as any).tool_calls || [];
              const incoming = chunk.tool_calls || [];
              accumulated = { ...accumulated, tool_calls: [...existing, ...incoming] } as any;
            }
          }
          break;
        }

        case "on_llm_end": {
          // Extract usage from the final output
          const output = event.data.output as AIMessageChunk;
          if (output?.usage_metadata) {
            usage = {
              promptTokens: output.usage_metadata.input_tokens ?? 0,
              completionTokens: output.usage_metadata.output_tokens ?? 0,
              totalTokens: output.usage_metadata.total_tokens ?? 0,
            };
          }
          break;
        }

        case "on_retry": {
          const errMsg = typeof event.data === "string" ? event.data : (event.data as any)?.error?.message ?? "unknown error";
          onChunk({ type: "status", message: `Retrying (${errMsg})...` });
          break;
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return { text, toolCalls: extractToolCalls(accumulated), usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
    }
    const message = err instanceof Error ? err.message : String(err);
    onChunk({ type: "error", message, retryable: isRetryable(message) });
    return { text, toolCalls: extractToolCalls(accumulated), usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
  }

  // Extract tool calls from the accumulated message
  const toolCalls = extractToolCalls(accumulated);
  onChunk({ type: "done", usage });
  return { text, toolCalls, usage, timing: { requestStart, firstTokenAt, endAt: Date.now() } };
}

/**
 * Extracts tool calls from the fully accumulated AIMessageChunk.
 * LangChain handles fragment accumulation via concat() — no manual assembly needed.
 */
function extractToolCalls(accumulated: AIMessageChunk | null): ToolCallChunk[] {
  if (!accumulated?.tool_calls?.length) return [];
  return accumulated.tool_calls.map((tc) => ({
    type: "tool_call" as const,
    id: tc.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
    name: tc.name,
    args: JSON.stringify(tc.args),
  }));
}

/**
 * Extracts text from LangChain chunk content (string or content blocks).
 */
function extractContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text" || block.text)
      .map((block: any) => block.text || "")
      .join("");
  }
  return "";
}

function isRetryable(message: string): boolean {
  const retryPatterns = [/rate.?limit/i, /429/, /503/, /timeout/i, /ECONNRESET/, /ECONNREFUSED/];
  return retryPatterns.some((p) => p.test(message));
}
