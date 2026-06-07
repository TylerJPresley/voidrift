/**
 * LangChain Callback Handler.
 *
 * Bridges LangChain's callback system into VoidRift's onChunk pipeline.
 * Enables LangSmith tracing when LANGCHAIN_TRACING_V2=true is set.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { OnChunk } from "./stream.js";

export class VoidRiftCallbackHandler extends BaseCallbackHandler {
  name = "VoidRiftCallbackHandler";

  constructor(
    private onChunk: OnChunk,
    private onTokenCount?: (input: number, output: number) => void
  ) {
    super();
  }

  handleLLMStart(_llm: Serialized, _prompts: string[]): void {
    this.onChunk({ type: "status", message: "Thinking..." });
  }

  handleLLMNewToken(token: string): void {
    if (token) {
      this.onChunk({ type: "content", text: token });
    }
  }

  handleLLMEnd(output: any): void {
    const usage = output?.llmOutput?.tokenUsage;
    if (usage && this.onTokenCount) {
      this.onTokenCount(usage.promptTokens ?? 0, usage.completionTokens ?? 0);
    }
  }

  handleLLMError(err: Error): void {
    this.onChunk({ type: "error", message: err.message, retryable: isRetryableError(err) });
  }

  handleToolStart(_tool: Serialized, input: string, _runId: string, _parentRunId?: string, tags?: string[]): void {
    const name = tags?.[0] ?? "tool";
    this.onChunk({ type: "status", message: `Running ${name}...` });
  }

  handleToolError(err: Error): void {
    this.onChunk({ type: "error", message: `Tool error: ${err.message}`, retryable: false });
  }
}

function isRetryableError(err: Error): boolean {
  const msg = err.message;
  return /rate.?limit|429|503|timeout|ECONNRESET/i.test(msg);
}
