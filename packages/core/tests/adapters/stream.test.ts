import { describe, it, expect, vi } from "vitest";
import { streamModel } from "../../src/adapters/stream.js";
import type { StreamChunk } from "../../src/adapters/types.js";

/** Creates a mock client that yields streamEvents-style event objects */
function makeMockClient(events: Array<{ event: string; data: any }>) {
  return {
    streamEvents: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e;
      },
    }),
  } as any;
}

/** Helper: wraps content chunks into on_llm_stream events */
function contentEvents(chunks: any[]): Array<{ event: string; data: any }> {
  return chunks.map(c => ({ event: "on_llm_stream", data: { chunk: c } }));
}

/** Helper: creates an on_llm_end event with usage */
function endEvent(usage?: any): { event: string; data: any } {
  return { event: "on_llm_end", data: { output: { usage_metadata: usage } } };
}

function makeMidStreamErrorClient(events: Array<{ event: string; data: any }>, error: Error) {
  return {
    streamEvents: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e;
        throw error;
      },
    }),
  } as any;
}

describe("Streaming Engine (streamEvents)", () => {
  it("streams string content chunks and returns full text", async () => {
    const client = makeMockClient(contentEvents([
      { content: "Hello " },
      { content: "world" },
    ]));

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("Hello world");
    expect(received.filter((c) => c.type === "content")).toHaveLength(2);
    expect(received.at(-1)?.type).toBe("done");
  });

  it("handles Anthropic-style array content blocks", async () => {
    const client = makeMockClient(contentEvents([
      { content: [{ type: "text", text: "Hello from " }] },
      { content: [{ type: "text", text: "Anthropic" }] },
    ]));

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("Hello from Anthropic");
    expect(received.filter((c) => c.type === "content")).toHaveLength(2);
  });

  it("ignores empty content chunks", async () => {
    const client = makeMockClient(contentEvents([
      { content: "" },
      { content: "actual" },
      { content: null },
    ]));

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("actual");
    expect(received.filter((c) => c.type === "content")).toHaveLength(1);
  });

  it("extracts tool calls from accumulated AIMessageChunk", async () => {
    // LangChain's concat accumulates tool_calls on the final chunk
    const client = makeMockClient(contentEvents([
      { content: "", tool_calls: [{ id: "tc1", name: "read_file", args: { path: "src/main.ts" } }] },
    ]));

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(JSON.parse(result.toolCalls[0].args)).toEqual({ path: "src/main.ts" });
  });

  it("handles multiple tool calls", async () => {
    const client = makeMockClient(contentEvents([
      { content: "", tool_calls: [
        { id: "tc1", name: "read_file", args: { path: "a.ts" } },
        { id: "tc2", name: "glob_files", args: { pattern: "*.ts" } },
      ]},
    ]));

    const result = await streamModel(client, [], () => {});
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("glob_files");
  });

  it("extracts usage metadata from on_llm_end", async () => {
    const client = makeMockClient([
      ...contentEvents([{ content: "hi" }]),
      endEvent({ input_tokens: 100, output_tokens: 10, total_tokens: 110 }),
    ]);

    const result = await streamModel(client, [], () => {});
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(10);
    expect(result.usage.totalTokens).toBe(110);
  });

  it("handles pre-stream errors (streamEvents throws)", async () => {
    const client = {
      streamEvents: vi.fn().mockImplementation(() => { throw new Error("429 rate limit exceeded"); }),
    } as any;

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk).toBeDefined();
    expect(errChunk.retryable).toBe(true);
    expect(result.text).toBe("");
  });

  it("handles mid-stream errors", async () => {
    const client = makeMidStreamErrorClient(
      contentEvents([{ content: "partial " }]),
      new Error("ECONNRESET")
    );

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c));

    expect(result.text).toBe("partial ");
    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(true);
  });

  it("classifies non-retryable errors", async () => {
    const client = {
      streamEvents: vi.fn().mockImplementation(() => { throw new Error("invalid api key"); }),
    } as any;

    const received: StreamChunk[] = [];
    await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(false);
  });

  it("classifies ECONNREFUSED as retryable", async () => {
    const client = {
      streamEvents: vi.fn().mockImplementation(() => { throw new Error("connect ECONNREFUSED 127.0.0.1:11434"); }),
    } as any;

    const received: StreamChunk[] = [];
    await streamModel(client, [], (c) => received.push(c));

    const errChunk = received.find((c) => c.type === "error") as any;
    expect(errChunk.retryable).toBe(true);
  });

  it("stops streaming when abort signal fires", async () => {
    const controller = new AbortController();
    const client = {
      streamEvents: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { event: "on_llm_stream", data: { chunk: { content: "one " } } };
          controller.abort();
          yield { event: "on_llm_stream", data: { chunk: { content: "two " } } };
        },
      }),
    } as any;

    const received: StreamChunk[] = [];
    const result = await streamModel(client, [], (c) => received.push(c), controller.signal);

    expect(result.text).toBe("one ");
    expect(received.filter((c) => c.type === "content")).toHaveLength(1);
  });

  it("emits retry status on on_retry event", async () => {
    const client = makeMockClient([
      { event: "on_retry", data: "timeout" },
      ...contentEvents([{ content: "recovered" }]),
    ]);

    const received: StreamChunk[] = [];
    await streamModel(client, [], (c) => received.push(c));

    const status = received.find((c) => c.type === "status") as any;
    expect(status).toBeDefined();
    expect(status.message).toContain("Retrying");
  });
});
