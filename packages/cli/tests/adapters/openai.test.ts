import { describe, it, expect } from "vitest";
import { OpenAIAdapter } from "../../src/adapters/openai.ts";

// Mock fetch for testing SSE parsing
function mockFetch(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
  globalThis.fetch = async () => ({ ok: true, body: stream, status: 200, statusText: "OK" }) as any;
}

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter({ model_id: "test", base_url: "http://localhost", api_key: "", protocol: "openai", max_tokens: 100, max_context: 4096 });

  it("parses streaming text content", async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const chunks = [];
    for await (const chunk of adapter.stream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }
    expect(chunks.filter(c => c.type === "content").map(c => c.content).join("")).toBe("Hello world");
    expect(chunks[chunks.length - 1].type).toBe("done");
  });

  it("parses tool calls from streaming", async () => {
    mockFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"bash","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const chunks = [];
    for await (const chunk of adapter.stream([{ role: "user", content: "list files" }])) {
      chunks.push(chunk);
    }
    const toolChunk = chunks.find(c => c.type === "tool_calls");
    expect(toolChunk).toBeDefined();
    expect(toolChunk!.toolCalls![0].function.name).toBe("bash");
    expect(JSON.parse(toolChunk!.toolCalls![0].function.arguments)).toEqual({ command: "ls" });
  });

  it("throws on API error", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, statusText: "Internal Server Error", text: async () => "oops" }) as any;
    const gen = adapter.stream([{ role: "user", content: "hi" }]);
    await expect(gen.next()).rejects.toThrow("API error: 500");
  });
});
