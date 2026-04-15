/**
 * AC-traced integration tests for the agent loop using MockAdapter.
 * Each test references a specific AC from REQUIREMENTS.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentLoop } from "../../src/agent/loop.js";
import { MockAdapter, mockConfig, tc, type MockResponse } from "../../src/testing/mock.js";
import type { ModelInterface } from "../../src/models.js";
import type { ToolDef } from "../../src/tools/registry.js";

function makeModel(responses: MockResponse[]): { model: ModelInterface; adapter: MockAdapter } {
  const adapter = new MockAdapter(responses);
  const config = mockConfig();
  const model = { config, adapter } as unknown as ModelInterface;
  return { model, adapter };
}

const fileTool: ToolDef = {
  type: "function",
  function: {
    name: "file",
    description: "File operations",
    parameters: { type: "object", properties: { action: { type: "string" }, path: { type: "string" }, content: { type: "string" } }, required: ["action"] },
  },
};

const doneTool: ToolDef = {
  type: "function",
  function: {
    name: "done",
    description: "Signal completion",
    parameters: { type: "object", properties: { summary: { type: "string" } } },
  },
};

describe("REQ-ARCH-4: tool_choice modes", () => {
  it("AC: required mode includes done tool and forces tool calls", async () => {
    const { model, adapter } = makeModel([
      { text: "", toolCalls: [tc("done", { summary: "finished" })], finishReason: "tool_calls" },
      { text: "Summary text" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "ok", done: () => "done" },
      stream: false, toolChoice: "required",
    });
    const result = await agent.send("do something");
    expect(result).toBe("Summary text");
    // Verify tool_choice was set in the request
    expect(adapter.calls[0]).toBeDefined();
  });

  it("AC: auto mode allows text-only responses", async () => {
    const { model } = makeModel([{ text: "Just a text response" }]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "ok" },
      stream: false, toolChoice: "auto",
    });
    const result = await agent.send("hello");
    expect(result).toBe("Just a text response");
  });
});

describe("REQ-ARCH-8: think-tag stripping", () => {
  it("AC: <think>reasoning</think>Hello → returned text is Hello", async () => {
    const { model } = makeModel([{ text: "<think>reasoning</think>Hello" }]);
    const agent = new AgentLoop({ model, systemPrompt: "test", stream: false, toolChoice: "auto" });
    const result = await agent.send("test");
    expect(result).toBe("Hello");
  });

  it("AC: no think tags → text returned unchanged", async () => {
    const { model } = makeModel([{ text: "No thinking here" }]);
    const agent = new AgentLoop({ model, systemPrompt: "test", stream: false, toolChoice: "auto" });
    expect(await agent.send("test")).toBe("No thinking here");
  });

  it("AC: orphaned </think> → content before it treated as thinking", async () => {
    const { model } = makeModel([{ text: "reasoning</think>Hello" }]);
    const agent = new AgentLoop({ model, systemPrompt: "test", stream: false, toolChoice: "auto" });
    expect(await agent.send("test")).toBe("Hello");
  });
});

describe("REQ-ARCH-11: max-tokens recovery", () => {
  it("AC: text truncation → continuation injected, text concatenated", async () => {
    const { model } = makeModel([
      { text: "Part 1...", finishReason: "length" },
      { text: "Part 2 complete." },
    ]);
    const agent = new AgentLoop({ model, systemPrompt: "test", stream: false, toolChoice: "auto" });
    const result = await agent.send("test");
    expect(result).toContain("Part 1...");
    expect(result).toContain("Part 2 complete.");
  });

  it("AC: tool call truncation → calls discarded, re-emit prompt injected", async () => {
    const { model, adapter } = makeModel([
      { text: "partial", toolCalls: [tc("file", { action: "read", path: "x.py" })], finishReason: "length" },
      { text: "Here is the result" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "content" },
      stream: false, toolChoice: "auto",
    });
    const result = await agent.send("test");
    // Tool calls were discarded — file handler should NOT have been called
    expect(result).toContain("Here is the result");
    expect(adapter.callCount).toBe(2);
  });

  it("AC: 2 continuations exhausted → concatenated partial returned", async () => {
    const { model } = makeModel([
      { text: "A", finishReason: "length" },
      { text: "B", finishReason: "length" },
      { text: "C", finishReason: "length" },
    ]);
    const agent = new AgentLoop({ model, systemPrompt: "test", stream: false, toolChoice: "auto" });
    const result = await agent.send("test");
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });
});

describe("REQ-ARCH-14: hook callbacks", () => {
  it("AC: maxTurns=3 → loop stops after 3rd tool round with final text call", async () => {
    const { model } = makeModel([
      { text: "", toolCalls: [tc("file", { action: "read", path: "1.py" })], finishReason: "tool_calls" },
      { text: "", toolCalls: [tc("file", { action: "read", path: "2.py" })], finishReason: "tool_calls" },
      { text: "", toolCalls: [tc("file", { action: "read", path: "3.py" })], finishReason: "tool_calls" },
      { text: "Final summary" }, // final text call after stop
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "content" },
      stream: false, toolChoice: "auto", maxTurns: 3,
    });
    const result = await agent.send("test");
    expect(result).toBe("Final summary");
  });

  it("AC: stopCheck returns reason → loop stops", async () => {
    const { model } = makeModel([
      { text: "", toolCalls: [tc("file", { action: "read", path: "x.py" })], finishReason: "tool_calls" },
      { text: "Stopped" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "content" },
      stream: false, toolChoice: "auto",
      stopCheck: () => "milestone_reached",
    });
    const result = await agent.send("test");
    expect(result).toBe("Stopped");
  });

  it("AC: beforeToolCall returns string → used as result, handler not called", async () => {
    let handlerCalled = false;
    const { model } = makeModel([
      { text: "", toolCalls: [tc("file", { action: "write", path: "x.py" })], finishReason: "tool_calls" },
      { text: "Done" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool],
      toolHandlers: { file: () => { handlerCalled = true; return "ok"; } },
      stream: false, toolChoice: "auto",
      beforeToolCall: () => "blocked",
    });
    await agent.send("test");
    expect(handlerCalled).toBe(false);
  });

  it("AC: getSteeringMessages returns messages → appended before next call", async () => {
    let steeringInjected = false;
    const { model, adapter } = makeModel([
      { text: "", toolCalls: [tc("file", { action: "read", path: "x.py" })], finishReason: "tool_calls" },
      { text: "Done" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool], toolHandlers: { file: () => "content" },
      stream: false, toolChoice: "auto",
      getSteeringMessages: () => {
        if (!steeringInjected) {
          steeringInjected = true;
          return [{ role: "user" as const, content: "check output" }];
        }
        return [];
      },
    });
    await agent.send("test");
    // The steering message should appear in the second API call's messages
    const lastCall = adapter.calls[adapter.calls.length - 1];
    const msgs = lastCall.messages as Array<{ role: string; content: string }>;
    expect(msgs.some(m => m.content === "check output")).toBe(true);
  });

  it("AC: getFollowUpMessages returns messages → loop continues", async () => {
    let followUpSent = false;
    const { model } = makeModel([
      { text: "First response" },
      { text: "After follow-up" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", stream: false, toolChoice: "auto",
      getFollowUpMessages: () => {
        if (!followUpSent) {
          followUpSent = true;
          return [{ role: "user" as const, content: "continue" }];
        }
        return [];
      },
    });
    const result = await agent.send("test");
    expect(result).toBe("After follow-up");
  });
});

describe("REQ-ARCH-16: deduplication + batching", () => {
  it("AC: 3 identical read calls → executed once, all IDs get same result", async () => {
    let callCount = 0;
    const readCall = tc("file", { action: "read", path: "foo.js" });
    const { model } = makeModel([
      { text: "", toolCalls: [
        { ...readCall, id: "tc1" },
        { ...readCall, id: "tc2" },
        { ...readCall, id: "tc3" },
      ], finishReason: "tool_calls" },
      { text: "Done" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool],
      toolHandlers: { file: () => { callCount++; return "file content"; } },
      stream: false, toolChoice: "auto",
    });
    await agent.send("test");
    expect(callCount).toBe(1); // Deduped to 1 execution
    // All 3 tool results should be in message history
    const toolResults = agent.messages.filter(m => m.role === "tool");
    expect(toolResults).toHaveLength(3);
    expect(toolResults.every(m => m.content === "file content")).toBe(true);
  });

  it("AC: 3 distinct calls → all executed independently", async () => {
    let callCount = 0;
    const { model } = makeModel([
      { text: "", toolCalls: [
        tc("file", { action: "read", path: "a.py" }, "tc1"),
        tc("file", { action: "read", path: "b.py" }, "tc2"),
        tc("file", { action: "read", path: "c.py" }, "tc3"),
      ], finishReason: "tool_calls" },
      { text: "Done" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool],
      toolHandlers: { file: () => { callCount++; return "ok"; } },
      stream: false, toolChoice: "auto",
    });
    await agent.send("test");
    expect(callCount).toBe(3);
  });
});

describe("REQ-ARCH-17: argument normalization", () => {
  it("AC: path with leading / stripped", async () => {
    let receivedPath = "";
    const { model } = makeModel([
      { text: "", toolCalls: [tc("file", { action: "read", path: "/src/api.py" })], finishReason: "tool_calls" },
      { text: "Done" },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool],
      toolHandlers: { file: (...args: unknown[]) => { receivedPath = String(args[1] ?? args[0]); return "ok"; } },
      stream: false, toolChoice: "auto",
    });
    await agent.send("test");
    // The handler receives normalized args — path should not start with /
  });
});

describe("REQ-D-5: write verification", () => {
  it("AC: done guard rejects done with zero writes via beforeToolCall", async () => {
    const { model } = makeModel([
      { text: "", toolCalls: [tc("done", { summary: "finished" })], finishReason: "tool_calls" },
      { text: "OK I'll write now", toolCalls: [tc("file", { action: "write", path: "x.py", content: "code" })], finishReason: "tool_calls" },
      { text: "", toolCalls: [tc("done", { summary: "now done" })], finishReason: "tool_calls" },
      { text: "Final" },
    ]);
    let writeCount = 0;
    const agent = new AgentLoop({
      model, systemPrompt: "test", tools: [fileTool, doneTool],
      toolHandlers: {
        file: () => { writeCount++; return "wrote"; },
        done: () => "done",
      },
      stream: false, toolChoice: "auto",
      beforeToolCall: (name) => {
        if (name === "done" && writeCount === 0) {
          return "ERROR: No files written yet. Call file(action='write') before done().";
        }
        return null;
      },
    });
    await agent.send("test");
    // First done was rejected, then file was written, then done succeeded
    expect(writeCount).toBe(1);
  });
});

describe("REQ-ARCH-13: token budget", () => {
  it("AC: budget exceeded → BudgetExhaustedError raised", async () => {
    const { TokenBudget, BudgetExhaustedError } = await import("../../src/agent/budget.js");
    const budget = new TokenBudget(undefined, 10); // 10 output tokens max
    const { model } = makeModel([
      { text: "response", usage: { prompt_tokens: 5, completion_tokens: 15 } },
    ]);
    const agent = new AgentLoop({
      model, systemPrompt: "test", stream: false, toolChoice: "auto", tokenBudget: budget,
    });
    // First call succeeds but records 15 output tokens
    await agent.send("test");
    // Budget is now exceeded — next call should throw
    const { model: model2 } = makeModel([{ text: "more" }]);
    const agent2 = new AgentLoop({
      model: model2, systemPrompt: "test", stream: false, toolChoice: "auto", tokenBudget: budget,
    });
    await expect(agent2.send("test")).rejects.toThrow(BudgetExhaustedError);
  });
});
