import { describe, it, expect } from "vitest";
import { snipOldToolResults, trimMessages } from "../../src/agent/context.js";
import type { Message } from "../../src/agent/types.js";

describe("snipOldToolResults", () => {
  it("snips old file read results", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"big.py"}' } }] },
      { role: "tool", content: "x".repeat(600), tool_call_id: "1", name: "file" },
      { role: "assistant", content: "ok" },
      { role: "assistant", content: "done" },
      { role: "assistant", content: "final" },
    ];
    const result = snipOldToolResults(messages, 2);
    expect(result[2].content).toContain("[snipped");
  });

  it("does not snip recent results", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"x.py"}' } }] },
      { role: "tool", content: "x".repeat(600), tool_call_id: "1", name: "file" },
      { role: "assistant", content: "ok" },
    ];
    const result = snipOldToolResults(messages, 2);
    expect(result[2].content).not.toContain("[snipped");
  });

  it("does not snip write results", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "file", arguments: '{"action":"write","path":"x.py"}' } }] },
      { role: "tool", content: "x".repeat(600), tool_call_id: "1", name: "file" },
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ];
    const result = snipOldToolResults(messages, 2);
    expect(result[2].content).not.toContain("[snipped");
  });

  it("does not mutate original", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"x.py"}' } }] },
      { role: "tool", content: "x".repeat(600), tool_call_id: "1", name: "file" },
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ];
    const original = messages[2].content;
    snipOldToolResults(messages, 2);
    expect(messages[2].content).toBe(original);
  });

  it("maxAgeTurns=0 disables snipping", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"x.py"}' } }] },
      { role: "tool", content: "x".repeat(600), tool_call_id: "1", name: "file" },
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ];
    const result = snipOldToolResults(messages, 0);
    expect(result[2].content).not.toContain("[snipped");
  });
});

describe("trimMessages", () => {
  it("removes empty content messages", () => {
    const messages: Message[] = [
      { role: "assistant", content: "" },
      { role: "user", content: "hello" },
    ];
    expect(trimMessages(messages)).toHaveLength(1);
  });

  it("keeps tool messages with content", () => {
    const messages: Message[] = [
      { role: "tool", content: "result", tool_call_id: "1" },
    ];
    expect(trimMessages(messages)).toHaveLength(1);
  });
});
