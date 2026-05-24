import type { ChatMessage, StreamChunk, ToolCallMessage, OpenAITool } from "../adapters/openai.js";
import type { OpenAIAdapter } from "../adapters/openai.js";
import type { ToolRegistry, ConfirmResult } from "../tools/registry.js";
import { log } from "../debug.js";

export interface SessionEvent {
  type: "content" | "tool_call" | "tool_result" | "tool_denied" | "confirm" | "done" | "error";
  content?: string;
  toolCall?: { id: string; name: string; args: string; parsedArgs: Record<string, unknown>; keyArg: string };
  toolResult?: { id: string; name: string; result: string };
  error?: string;
}

export type ConfirmFn = (toolName: string, args: Record<string, unknown>) => Promise<ConfirmResult>;

function extractKeyArg(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash": return String(args.command || "");
    case "read": return String(args.path || "");
    case "write": return String(args.path || "");
    case "edit": return String(args.path || "");
    case "glob": return String(args.pattern || "");
    default: return Object.values(args)[0] ? String(Object.values(args)[0]) : "";
  }
}

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
    log("session", "send", { text: text.slice(0, 100) });

    while (true) {
      let content = "";
      let toolCalls: ToolCallMessage[] | null = null;
      log("session", "calling model", { historyLen: this.history.length });

      for await (const chunk of this.adapter.stream(this.history, this.tools)) {
        if (chunk.type === "content" && chunk.content) {
          content += chunk.content;
          yield { type: "content", content: chunk.content };
        }
        if (chunk.type === "tool_calls" && chunk.toolCalls) {
          toolCalls = chunk.toolCalls;
          log("session", "tool_calls received", toolCalls.map(t => t.function.name));
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        this.history.push({ role: "assistant", content: content || null, tool_calls: toolCalls });

        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          const keyArg = extractKeyArg(tc.function.name, args);
          yield { type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, args: tc.function.arguments, parsedArgs: args, keyArg } };

          // Check confirmation
          if (this.registry.needsConfirmation(tc.function.name)) {
            const decision = await this.confirmFn(tc.function.name, args);
            if (decision === "deny") {
              const denied = `Tool "${tc.function.name}" was denied by the user.`;
              yield { type: "tool_denied", toolCall: { id: tc.id, name: tc.function.name, args: tc.function.arguments, parsedArgs: args, keyArg } };
              this.history.push({ role: "tool", content: denied, tool_call_id: tc.id });
              continue;
            }
            if (decision === "always") {
              this.registry.approveAlways(tc.function.name);
            }
          }

          const result = await this.registry.execute(tc.function.name, args);
          log("session", "tool_result", { name: tc.function.name, resultLen: result.length });
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
