import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { StreamChunk, ToolCallChunk, ModelResponse, TokenUsage } from "./types.js";

export type OnChunk = (chunk: StreamChunk) => void;

/**
 * Streams a model invocation, translating LangChain chunks into unified StreamChunks.
 *
 * Handles:
 * - String content (OpenAI style)
 * - Array content blocks (Anthropic style: [{type: "text", text: "..."}])
 * - Partial tool_call_chunks accumulation into complete tool calls
 * - Mid-stream errors (thrown during async iteration)
 * - Pre-stream errors (thrown on .stream() call)
 * - Usage metadata extraction
 */
export async function streamModel(
  client: BaseChatModel,
  messages: BaseMessage[],
  onChunk: OnChunk,
  signal?: AbortSignal
): Promise<ModelResponse> {
  let text = "";
  const toolAccumulator = new Map<string, { id: string; name: string; args: string }>();
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const stream = await client.stream(messages);

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        // Extract text content from chunk
        const content = extractContent(chunk.content);
        if (content) {
          text += content;
          onChunk({ type: "content", text: content });
        }

        // Accumulate tool call fragments
        if (chunk.tool_call_chunks?.length) {
          for (const tc of chunk.tool_call_chunks) {
            const key = String(tc.index ?? toolAccumulator.size);
            const existing = toolAccumulator.get(key);
            if (existing) {
              if (tc.id) existing.id = tc.id;
              if (tc.name) existing.name = tc.name;
              existing.args += tc.args || "";
            } else {
              toolAccumulator.set(key, { id: tc.id || "", name: tc.name || "", args: tc.args || "" });
            }
          }
        }

        // Usage info (usually on final chunk)
        if (chunk.usage_metadata) {
          usage = {
            promptTokens: chunk.usage_metadata.input_tokens ?? 0,
            completionTokens: chunk.usage_metadata.output_tokens ?? 0,
            totalTokens: chunk.usage_metadata.total_tokens ?? 0,
          };
        }
      }
    } catch (err: unknown) {
      // Mid-stream error (network dropout, connection reset during iteration)
      const message = err instanceof Error ? err.message : String(err);
      onChunk({ type: "error", message, retryable: isRetryable(message) });
      return { text, toolCalls: flushToolCalls(toolAccumulator, onChunk), usage };
    }
  } catch (err: unknown) {
    // Pre-stream error (failed to initiate stream)
    const message = err instanceof Error ? err.message : String(err);
    onChunk({ type: "error", message, retryable: isRetryable(message) });
    return { text, toolCalls: [], usage };
  }

  // Yield accumulated tool calls
  const toolCalls = flushToolCalls(toolAccumulator, onChunk);
  onChunk({ type: "done", usage });
  return { text, toolCalls, usage };
}

/**
 * Extracts text from LangChain chunk content which can be:
 * - string (OpenAI)
 * - Array<{type: "text", text: string}> (Anthropic)
 * - empty/null
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

function flushToolCalls(
  accumulator: Map<string, { id: string; name: string; args: string }>,
  onChunk: OnChunk
): ToolCallChunk[] {
  const toolCalls: ToolCallChunk[] = [];
  for (const [index, { id, name, args }] of accumulator) {
    const tc: ToolCallChunk = { type: "tool_call", id: id || `tool_${index}`, name, args };
    toolCalls.push(tc);
    onChunk(tc);
  }
  return toolCalls;
}

function isRetryable(message: string): boolean {
  const retryPatterns = [/rate.?limit/i, /429/, /503/, /timeout/i, /ECONNRESET/, /ECONNREFUSED/];
  return retryPatterns.some((p) => p.test(message));
}
