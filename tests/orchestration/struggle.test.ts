import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/bus.js";
import { directChat } from "../../src/orchestration/graph.js";
import type { StreamChunk } from "../../src/adapters/types.js";

function makeMockClient(text: string) {
  const client: any = {
    stream: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { content: text };
      },
    }),
    bindTools: vi.fn(),
  };
  client.bindTools.mockReturnValue(client);
  return client;
}

describe("Struggle Signal", () => {
  it("emits ERROR_OCCURRED when model expresses write intent without tool call", async () => {
    const bus = new EventBus();
    const errors: any[] = [];
    bus.subscribe("STRUGGLE_DETECTED", (e) => { errors.push(e.payload); });

    const client = makeMockClient("Let me update the config file with the new settings.");
    const chunks: StreamChunk[] = [];

    await directChat({
      userMessage: "update the config",
      client,
      systemPrompt: "You are helpful.",
      history: [],
      onChunk: (c) => chunks.push(c),
    }, bus);

    await new Promise((r) => setTimeout(r, 10));

    expect(errors.length).toBe(1);
    
    
    expect(errors[0].expectedAction).toBe("tool_call");
  });

  it("does not emit when model produces normal conversational text", async () => {
    const bus = new EventBus();
    const errors: any[] = [];
    bus.subscribe("STRUGGLE_DETECTED", (e) => { errors.push(e.payload); });

    const client = makeMockClient("The config file is located at src/config.ts and contains the database settings.");
    const chunks: StreamChunk[] = [];

    await directChat({
      userMessage: "where is the config?",
      client,
      systemPrompt: "You are helpful.",
      history: [],
      onChunk: (c) => chunks.push(c),
    }, bus);

    await new Promise((r) => setTimeout(r, 10));

    expect(errors).toHaveLength(0);
  });

  it("detects various intent patterns", async () => {
    const patterns = [
      "Let me edit the file now.",
      "I'll create a new component for this.",
      "Let me fix the import statement.",
      "I will modify the configuration.",
      "Let me write the test file.",
      "I'll delete the unused function.",
      "Let me add the missing export.",
    ];

    for (const text of patterns) {
      const bus = new EventBus();
      const errors: any[] = [];
      bus.subscribe("STRUGGLE_DETECTED", (e) => { errors.push(e.payload); });

      const client = makeMockClient(text);
      await directChat({
        userMessage: "do it",
        client,
        systemPrompt: "You are helpful.",
        history: [],
        onChunk: () => {},
      }, bus);

      await new Promise((r) => setTimeout(r, 10));
      expect(errors.length).toBe(1);
    }
  });

  it("does not trigger when model actually calls tools", async () => {
    const bus = new EventBus();
    const errors: any[] = [];
    bus.subscribe("STRUGGLE_DETECTED", (e) => { errors.push(e.payload); });

    // Mock a client that returns a tool call
    const client: any = {
      stream: vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            content: "",
            tool_calls: [{ id: "tc1", name: "edit_file", args: { path: "config.ts", search: "old", replace: "new" } }],
            tool_call_chunks: [{ index: 0, id: "tc1", name: "edit_file", args: '{"path":"config.ts"}' }],
          };
        },
      }),
      bindTools: vi.fn(),
      invoke: vi.fn().mockResolvedValue({ content: "done" }),
    };
    client.bindTools.mockReturnValue(client);

    await directChat({
      userMessage: "fix it",
      client,
      systemPrompt: "You are helpful.",
      history: [],
      onChunk: () => {},
    }, bus);

    await new Promise((r) => setTimeout(r, 10));

    // No struggle signal — model called a tool
    expect(errors).toHaveLength(0);
  });
});
