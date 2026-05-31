import { describe, it, expect, vi } from "vitest";
import { streamModel } from "../../src/adapters/stream.js";
import type { StreamChunk } from "../../src/adapters/types.js";

function makeMockClient(chunks: any[]) {
  return {
    stream: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    }),
  } as any;
}

function makeMidStreamErrorClient(chunksBeforeError: any[], error: Error) {
  return {
    stream: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunksBeforeError) yield chunk;
        throw error;
      },
    }),
  } as any;
}

describe("Streaming Engine", () => {
  it("streams string content chunks and returns full text", async () => {
    const client = makeMockClient([
      { content: "Hello " },
      { content: "world" },
    ]);

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("Hello world");
    expect(received.filter((c) => c.type === "content")).toHaveLength(2);
    expect(received.at(-1)?.type).toBe("done");
  });

  it("handles Anthropic-style array content blocks", async () => {
    const client = makeMockClient([
      { content: [{ type: "text", text: "Hello from " }] },
      { content: [{ type: "text", text: "Anthropic" }] },
    ]);

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("Hello from Anthropic");
    expect(received.filter((c) => c.type === "content")).toHaveLength(2);
  });

  it("ignores empty content chunks", async () => {
    const client = makeMockClient([
      { content: "" },
      { content: "actual" },
      { content: null },
    ]);

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("actual");
    expect(received.filter((c) => c.type === "content")).toHaveLength(1);
  });

  it("accumulates tool call fragments into complete calls", async () => {
    const client = makeMockClient([
      { content: "", tool_call_chunks: [{ id: "tc1", index: 0, name: "read_file", args: '{"path":' }] },
      { content: "", tool_call_chunks: [{ index: 0, args: '"src/main.ts"}' }] },
    ]);

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[0].args).toBe('{"path":"src/main.ts"}');
  });

  it("handles multiple concurrent tool calls", async () => {
    const client = makeMockClient([
      { content: "", tool_call_chunks: [{ id: "tc1", index: 0, name: "read_file", args: '{"path":"a.ts"}' }] },
      { content: "", tool_call_chunks: [{ id: "tc2", index: 1, name: "glob_files", args: '{"pattern":"*.ts"}' }] },
    ]);

    const result = await streamModel(client, [], () => {});
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("glob_files");
  });

  it("updates tool name if provided in later chunk", async () => {
    const client = makeMockClient([
      { content: "", tool_call_chunks: [{ id: "tc1", index: 0, name: "", args: '{"x":' }] },
      { content: "", tool_call_chunks: [{ index: 0, name: "edit_file", args: '1}' }] },
    ]);

    const result = await streamModel(client, [], () => {});
    expect(result.toolCalls[0].name).toBe("edit_file");
  });

  it("extracts usage metadata", async () => {
    const client = makeMockClient([
      { content: "hi", usage_metadata: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
    ]);

    const result = await streamModel(client, [], () => {});
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(10);
    expect(result.usage.totalTokens).toBe(110);
  });

  it("handles pre-stream errors (failed to initiate)", async () => {
    const client = {
      stream: vi.fn().mockRejectedValue(new Error("429 rate limit exceeded")),
    } as any;

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk).toBeDefined();
    expect(errChunk.retryable).toBe(true);
    expect(result.text).toBe("");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("handles mid-stream errors (network dropout during iteration)", async () => {
    const client = makeMidStreamErrorClient(
      [{ content: "partial " }],
      new Error("ECONNRESET")
    );

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("partial ");
    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(true);
    expect(errChunk.message).toContain("ECONNRESET");
  });

  it("mid-stream error flushes accumulated tool calls", async () => {
    const client = makeMidStreamErrorClient(
      [{ content: "", tool_call_chunks: [{ id: "tc1", name: "read_file", args: '{"path":"x"}' }] }],
      new Error("connection lost")
    );

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
  });

  it("classifies non-retryable errors", async () => {
    const client = {
      stream: vi.fn().mockRejectedValue(new Error("invalid api key")),
    } as any;

    const received: StreamChunk[] = [];
    await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(false);
  });

  it("classifies ECONNREFUSED as retryable", async () => {
    const client = {
      stream: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434")),
    } as any;

    const received: StreamChunk[] = [];
    await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(true);
  });

  it("stops streaming when abort signal fires", async () => {
    const controller = new AbortController();
    let yieldCount = 0;
    const client = {
      stream: vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { content: "one " }; yieldCount++;
          controller.abort();
          yield { content: "two " }; yieldCount++;
          yield { content: "three" }; yieldCount++;
        },
      }),
    } as any;

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c), controller.signal);

    expect(result.text).toBe("one ");
    expect(received.filter((c) => c.type === "content")).toHaveLength(1);
  });
});
