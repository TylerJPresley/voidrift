import type { ChatMessage, StreamChunk, ToolCallMessage, OpenAITool } from "../adapters/openai.js";
import type { OpenAIAdapter } from "../adapters/openai.js";
import type { ToolRegistry, ConfirmResult } from "../tools/registry.js";

export interface SessionEvent {
  type: "content" | "tool_call" | "tool_result" | "tool_denied" | "confirm" | "done" | "error";
  content?: string;
  toolCall?: { id: string; name: string; args: string };
  toolResult?: { id: string; name: string; result: string };
  error?: string;
}

export type ConfirmFn = (toolName: string, args: Record<string, unknown>) => Promise<ConfirmResult>;

export class SessionManager {
  private history: ChatMessage[] = [];
  private adapter: OpenAIAdapter;
  private registry: ToolRegistry;
  private tools: OpenAITool[];
  private confirmFn: ConfirmFn;

  constructor(adapter: OpenAIAdapter, registry: ToolRegistry, confirmFn: ConfirmFn) {
    this.adapter = adapter;
    this.registry = registry;
    this.tools = registry.toOpenAITools();
    this.confirmFn = confirmFn;
  }

  async *send(text: string): AsyncGenerator<SessionEvent> {
    this.history.push({ role: "user", content: text });

    while (true) {
      let content = "";
      let toolCalls: ToolCallMessage[] | null = null;

      for await (const chunk of this.adapter.stream(this.history, this.tools)) {
        if (chunk.type === "content" && chunk.content) {
          content += chunk.content;
          yield { type: "content", content: chunk.content };
        }
        if (chunk.type === "tool_calls" && chunk.toolCalls) {
          toolCalls = chunk.toolCalls;
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        this.history.push({ role: "assistant", content: content || null, tool_calls: toolCalls });

        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          yield { type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, args: tc.function.arguments } };

          // Check confirmation
          if (this.registry.needsConfirmation(tc.function.name)) {
            const decision = await this.confirmFn(tc.function.name, args);
            if (decision === "deny") {
              const denied = `Tool "${tc.function.name}" was denied by the user.`;
              yield { type: "tool_denied", toolCall: { id: tc.id, name: tc.function.name, args: tc.function.arguments } };
              this.history.push({ role: "tool", content: denied, tool_call_id: tc.id });
              continue;
            }
            if (decision === "always") {
              this.registry.approveAlways(tc.function.name);
            }
          }

          const result = await this.registry.execute(tc.function.name, args);
          yield { type: "tool_result", toolResult: { id: tc.id, name: tc.function.name, result } };
          this.history.push({ role: "tool", content: result, tool_call_id: tc.id });
        }
        // Loop — model continues
        content = "";
      } else {
        if (content) this.history.push({ role: "assistant", content });
        yield { type: "done" };
        return;
      }
    }
  }

  getHistory(): ChatMessage[] {
    return this.history;
  }

  restoreHistory(messages: ChatMessage[]) {
    this.history = messages;
  }
}
