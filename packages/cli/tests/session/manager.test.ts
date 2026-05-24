import { describe, it, expect } from "vitest";
import { SessionManager } from "../../src/session/manager.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

function mockAdapter(responses: Array<{ content?: string; toolCalls?: any[] }[]>) {
  let callIndex = 0;
  return {
    async *stream() {
      const chunks = responses[callIndex++] || [];
      for (const chunk of chunks) {
        if (chunk.content) yield { type: "content" as const, content: chunk.content };
        if (chunk.toolCalls) yield { type: "tool_calls" as const, toolCalls: chunk.toolCalls };
      }
      yield { type: "done" as const };
    },
  } as any;
}

describe("SessionManager", () => {
  it("streams a simple text response", async () => {
    const adapter = mockAdapter([[{ content: "Hello " }, { content: "world" }]]);
    const registry = new ToolRegistry();
    const session = new SessionManager(adapter, registry);

    const events = [];
    for await (const e of session.send("hi")) events.push(e);

    expect(events.filter(e => e.type === "content").map(e => e.content).join("")).toBe("Hello world");
    expect(events[events.length - 1].type).toBe("done");
    expect(session.getHistory()).toHaveLength(2);
  });

  it("executes tool calls and loops back to model", async () => {
    const adapter = mockAdapter([
      // First call: model requests a tool
      [{ toolCalls: [{ id: "c1", type: "function", function: { name: "echo", arguments: '{"msg":"hi"}' } }] }],
      // Second call: model responds with text after getting tool result
      [{ content: "Got it" }],
    ]);
    const registry = new ToolRegistry();
    registry.register({ name: "echo", description: "Echo", parameters: { msg: { type: "string", description: "" } }, execute: async (args) => `echo: ${args.msg}` });
    const session = new SessionManager(adapter, registry);

    const events = [];
    for await (const e of session.send("do something")) events.push(e);

    expect(events.some(e => e.type === "tool_call")).toBe(true);
    expect(events.some(e => e.type === "tool_result")).toBe(true);
    expect(events.find(e => e.type === "tool_result")!.toolResult!.result).toBe("echo: hi");
    expect(events.some(e => e.type === "content" && e.content === "Got it")).toBe(true);
  });
});
