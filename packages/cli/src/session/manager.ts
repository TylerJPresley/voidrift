import type { ChatMessage, StreamChunk, ToolCallMessage, OpenAITool } from "../adapters/openai.js";
import type { OpenAIAdapter } from "../adapters/openai.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface SessionEvent {
  type: "content" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: { id: string; name: string; args: string };
  toolResult?: { id: string; name: string; result: string };
  error?: string;
}

export class SessionManager {
  private history: ChatMessage[] = [];
  private adapter: OpenAIAdapter;
  private registry: ToolRegistry;
  private tools: OpenAITool[];

  constructor(adapter: OpenAIAdapter, registry: ToolRegistry) {
    this.adapter = adapter;
    this.registry = registry;
    this.tools = registry.toOpenAITools();
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
        // Add assistant message with tool calls
        this.history.push({ role: "assistant", content: content || null, tool_calls: toolCalls });

        // Execute each tool and send results back
        for (const tc of toolCalls) {
          yield { type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, args: tc.function.arguments } };

          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          const result = await this.registry.execute(tc.function.name, args);
          yield { type: "tool_result", toolResult: { id: tc.id, name: tc.function.name, result } };

          this.history.push({ role: "tool", content: result, tool_call_id: tc.id });
        }
        // Loop continues — model will respond to tool results
      } else {
        // No tool calls — model is done
        if (content) this.history.push({ role: "assistant", content });
        yield { type: "done" };
        return;
      }
    }
  }

  getHistory(): ChatMessage[] {
    return this.history;
  }
}
