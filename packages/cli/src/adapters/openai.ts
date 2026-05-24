import type { ModelConfig } from "../config/loader.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallMessage[];
  tool_call_id?: string;
}

export interface ToolCallMessage {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamChunk {
  type: "content" | "tool_calls" | "done";
  content?: string;
  toolCalls?: ToolCallMessage[];
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

export class OpenAIAdapter {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  async *stream(messages: ChatMessage[], tools?: OpenAITool[]): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this.config.model_id,
      messages,
      stream: true,
      max_tokens: this.config.max_tokens,
    };
    if (tools && tools.length > 0) body.tools = tools;

    const response = await fetch(`${this.config.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.api_key ? { Authorization: `Bearer ${this.config.api_key}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API error: ${response.status} ${response.statusText}\n${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          if (toolCalls.size > 0) {
            yield {
              type: "tool_calls",
              toolCalls: Array.from(toolCalls.values()).map(tc => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              })),
            };
          }
          yield { type: "done" };
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: "content", content: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, { id: tc.id || `call_${idx}`, name: "", args: "" });
              }
              const entry = toolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    if (toolCalls.size > 0) {
      yield {
        type: "tool_calls",
        toolCalls: Array.from(toolCalls.values()).map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    yield { type: "done" };
  }
}
