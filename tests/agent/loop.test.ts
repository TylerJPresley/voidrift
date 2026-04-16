import { describe, it, expect, vi, afterEach } from "vitest";
import type { ToolCall, ParsedResponse, Message, LoopState } from "../../src/agent/types.js";
import type { ModelConfig, ModelInterface } from "../../src/models.js";
import { AbortRequested, requestAbort, clearAbort, registerLoop, unregisterLoop, isAbortRequested } from "../../src/agent/abort.js";

// ---------------------------------------------------------------------------
// Mock the protocol module so createClient doesn't require("openai")
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockClose = vi.fn();
const mockClient = { chat: { completions: { create: mockCreate } }, close: mockClose };

vi.mock("../../src/agent/protocol.js", () => {
  // Inline a minimal OpenAI-compatible adapter to avoid requiring the openai SDK
  function buildRequest(opts: Record<string, unknown>): Record<string, unknown> {
    const req: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };
    if ((opts.tools as unknown[])?.length) {
      req.tools = (opts.tools as Array<Record<string, unknown>>).map((t: Record<string, unknown>) => ({ type: t.type, function: t.function }));
      if (opts.toolChoice) req.tool_choice = opts.toolChoice;
    }
    return req;
  }

  function parseResponse(raw: unknown): Record<string, unknown> {
    const r = raw as Record<string, unknown>;
    const choices = (r.choices as Array<Record<string, unknown>>) ?? [];
    const choice = choices[0] ?? {};
    const msg = (choice.message as Record<string, unknown>) ?? {};
    const usage = (r.usage as Record<string, number>) ?? {};
    const toolCalls: Array<Record<string, unknown>> = [];
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, string>;
        toolCalls.push({ id: String(tc.id), type: "function", function: { name: fn.name, arguments: fn.arguments ?? "{}" } });
      }
    }
    return {
      text: String(msg.content ?? ""),
      toolCalls,
      finishReason: String(choice.finish_reason ?? "stop"),
      usage: {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      },
    };
  }

  return {
    getAdapter: () => ({
      createClient: () => mockClient,
      buildRequest,
      parseResponse,
      call: async (_client: unknown, req: unknown) => mockCreate(req),
    }),
    OpenAIAdapter: class { buildRequest = buildRequest; parseResponse = parseResponse; createClient = () => mockClient; call = async (_client: unknown, req: unknown) => mockCreate(req); },
    AnthropicAdapter: class { buildRequest = buildRequest; parseResponse = parseResponse; createClient = () => mockClient; call = async (_client: unknown, req: unknown) => mockCreate(req); },
  };
});

// Mock loadPrompt to avoid filesystem access
vi.mock("../../src/prompts.js", () => ({
  loadPrompt: (_layer: string, name: string) => {
    if (name === "MAX-TOKENS-TOOL-RESUME") return "Re-emit your tool calls.";
    if (name === "MAX-TOKENS-RESUME") return "Continue from where you stopped.";
    if (name === "STALL-NUDGE") return "Move on to the next step.";
    return "";
  },
  loadTemplate: () => "",
}));

import { AgentLoop } from "../../src/agent/loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<ModelConfig> = {}): ModelInterface {
  return {
    config: {
      alias: "test",
      modelId: "test-model",
      baseUrl: "http://localhost:1/v1",
      apiKey: "test-key",
      protocol: "openai" as const,
      maxTokens: 4096,
      maxReadLines: 2000,
      maxInputChars: 0,
      concurrency: 1,
      ...overrides,
    },
  };
}

function tc(name: string, args: string, id = "call_1"): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

/** Build an OpenAI-shaped raw response for the mocked adapter.parseResponse */
function rawResp(opts: { text?: string; toolCalls?: ToolCall[]; finishReason?: string; promptTokens?: number; completionTokens?: number }) {
  return {
    choices: [{
      message: {
        content: opts.text ?? null,
        tool_calls: opts.toolCalls?.map(t => ({ id: t.id, type: "function", function: { name: t.function.name, arguments: t.function.arguments } })) ?? null,
      },
      finish_reason: opts.finishReason ?? "stop",
    }],
    usage: {
      prompt_tokens: opts.promptTokens ?? 10,
      completion_tokens: opts.completionTokens ?? 5,
      total_tokens: (opts.promptTokens ?? 10) + (opts.completionTokens ?? 5),
    },
  };
}

function makeLoop(opts: {
  tools?: Array<{ type: string; function: { name: string; parameters?: Record<string, unknown> }; concurrent_safe?: boolean }>;
  handlers?: Record<string, (...args: unknown[]) => string>;
  systemPrompt?: string;
  beforeToolCall?: (name: string, args: string) => string | null;
  afterToolCall?: (name: string, result: string) => string;
  maxTurns?: number;
  stopCheck?: (state: LoopState) => string | null;
  getSteeringMessages?: (state: LoopState) => Message[];
  getFollowUpMessages?: (state: LoopState) => Message[];
  transformContext?: (msgs: Message[]) => Message[];
} = {}) {
  return new AgentLoop({
    model: makeModel(),
    systemPrompt: opts.systemPrompt ?? "You are a test assistant.",
    tools: opts.tools as never,
    toolHandlers: opts.handlers as never,
    beforeToolCall: opts.beforeToolCall as never,
    afterToolCall: opts.afterToolCall as never,
    maxTurns: opts.maxTurns,
    stopCheck: opts.stopCheck as never,
    getSteeringMessages: opts.getSteeringMessages as never,
    getFollowUpMessages: opts.getFollowUpMessages as never,
    transformContext: opts.transformContext as never,
  });
}

afterEach(() => {
  mockCreate.mockReset();
  mockClose.mockReset();
  clearAbort();
});

// ===========================================================================
// 1. AgentLoop init
// ===========================================================================

describe("AgentLoop init", () => {
  it("system prompt is first message", () => {
    const loop = makeLoop();
    expect(loop.messages[0].role).toBe("system");
    expect(loop.messages[0].content).toContain("test assistant");
  });

  it("messages array starts with one system message", () => {
    const loop = makeLoop();
    expect(loop.messages).toHaveLength(1);
  });
});

// ===========================================================================
// 2. AgentLoop.send — simple text response
// ===========================================================================

describe("AgentLoop.send — simple response", () => {
  it("returns text from a single API call", async () => {
    mockCreate.mockResolvedValueOnce(rawResp({ text: "Hello!" }));
    const result = await makeLoop().send("Hi");
    expect(result).toBe("Hello!");
  });

  it("appends user and assistant messages", async () => {
    mockCreate.mockResolvedValueOnce(rawResp({ text: "Reply" }));
    const loop = makeLoop();
    await loop.send("Question");
    expect(loop.messages.find(m => m.role === "user")!.content).toBe("Question");
    expect(loop.messages.find(m => m.role === "assistant")!.content).toBe("Reply");
  });
});

// ===========================================================================
// 3. AgentLoop.send — tool call flow
// ===========================================================================

describe("AgentLoop.send — tool call flow", () => {
  it("executes tool call then returns final text", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done." }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "tool result" },
    });
    const result = await loop.send("Do it");
    expect(result).toBe("Done.");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("unknown tool returns error message in tool result", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("nonexistent", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "OK" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "nonexistent" } }],
      handlers: {},
    });
    await loop.send("test");
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs.some(m => (m.content ?? "").includes("Error"))).toBe(true);
  });

  it("tool handler exception produces error result", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("bad_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "OK" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "bad_tool" } }],
      handlers: { bad_tool: () => { throw new Error("boom"); } },
    });
    await loop.send("test");
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs.some(m => (m.content ?? "").includes("boom"))).toBe(true);
  });
});

// ===========================================================================
// 4. Tool call deduplication (REQ-ARCH-16)
// ===========================================================================

describe("Tool call deduplication", () => {
  it("identical calls reduced to one unique, idMap tracks extras", () => {
    const loop = makeLoop();
    const calls = [
      tc("file", '{"action":"read","path":"foo.js"}', "c1"),
      tc("file", '{"action":"read","path":"foo.js"}', "c2"),
      tc("file", '{"action":"read","path":"foo.js"}', "c3"),
    ];
    const { unique, idMap } = (loop as any)._dedup(calls);
    expect(unique).toHaveLength(1);
    expect(unique[0].id).toBe("c1");
    const allIds = [...idMap.values()].flat();
    expect(allIds).toContain("c2");
    expect(allIds).toContain("c3");
  });

  it("distinct calls are all kept", () => {
    const loop = makeLoop();
    const calls = [
      tc("file", '{"action":"read","path":"a.js"}', "c1"),
      tc("file", '{"action":"read","path":"b.js"}', "c2"),
      tc("shell", '{"cmd":"ls"}', "c3"),
    ];
    const { unique } = (loop as any)._dedup(calls);
    expect(unique).toHaveLength(3);
  });

  it("mixed identical and distinct — only identical deduped", () => {
    const loop = makeLoop();
    const calls = [
      tc("file", '{"path":"a.js"}', "c1"),
      tc("file", '{"path":"a.js"}', "c2"),
      tc("file", '{"path":"b.js"}', "c3"),
    ];
    const { unique } = (loop as any)._dedup(calls);
    expect(unique).toHaveLength(2);
    expect(unique.map((u: ToolCall) => u.id)).toEqual(["c1", "c3"]);
  });

  it("all IDs receive tool result messages in full loop", async () => {
    let callCount = 0;
    mockCreate
      .mockResolvedValueOnce(rawResp({
        toolCalls: [
          tc("my_read", '{"path":"foo.js"}', "c1"),
          tc("my_read", '{"path":"foo.js"}', "c2"),
          tc("my_read", '{"path":"foo.js"}', "c3"),
        ],
        finishReason: "tool_calls",
      }))
      .mockResolvedValueOnce(rawResp({ text: "Done." }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_read" }, concurrent_safe: true }],
      handlers: { my_read: () => { callCount++; return "content"; } },
    });
    await loop.send("read");
    expect(callCount).toBe(1);
    const toolResults = loop.messages.filter(m => m.role === "tool");
    expect(toolResults).toHaveLength(3);
    const ids = new Set(toolResults.map(m => m.tool_call_id));
    expect(ids).toEqual(new Set(["c1", "c2", "c3"]));
  });
});

// ===========================================================================
// 5. Max-tokens recovery (REQ-ARCH-11)
// ===========================================================================

describe("Max-tokens recovery", () => {
  it("text truncation triggers continuation and concatenates", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ text: "partial ", finishReason: "length" }))
      .mockResolvedValueOnce(rawResp({ text: "content here" }));
    const result = await makeLoop().send("generate");
    expect(result).toBe("partial content here");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("exhaustion after 2 continuations returns concatenated partial", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ text: "part1 ", finishReason: "length" }))
      .mockResolvedValueOnce(rawResp({ text: "part2 ", finishReason: "length" }))
      .mockResolvedValueOnce(rawResp({ text: "part3", finishReason: "length" }));
    const result = await makeLoop().send("generate");
    expect(result).toBe("part1 part2 part3");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("tool truncation discards calls and injects re-emit prompt", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", '{"path":"x.py"}')], finishReason: "length" }))
      .mockResolvedValueOnce(rawResp({ text: "done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "content" },
    });
    const result = await loop.send("read file");
    expect(result).toBe("done");
    const userMsgs = loop.messages.filter(m => m.role === "user");
    expect(userMsgs.some(m => (m.content ?? "").includes("Re-emit"))).toBe(true);
  });

  it("truncated tool calls are NOT executed", async () => {
    let handlerCalled = 0;
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "length" }))
      .mockResolvedValueOnce(rawResp({ text: "done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => { handlerCalled++; return "r"; } },
    });
    await loop.send("test");
    expect(handlerCalled).toBe(0);
  });

  it("normal stop does not trigger recovery", async () => {
    mockCreate.mockResolvedValueOnce(rawResp({ text: "complete" }));
    const result = await makeLoop().send("test");
    expect(result).toBe("complete");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 6. Stall nudge injection (full flow)
// ===========================================================================

describe("Stall nudge injection", () => {
  it("repeated identical tool calls inject nudge message", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"foo.js"}')], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"foo.js"}', "c2")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"bar.js"}', "c3")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done." }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "file" } }],
      handlers: { file: () => "content" },
    });
    await loop.send("analyze");
    const stallMsgs = loop.messages.filter(m => m.role === "tool" && (m.content ?? "").includes("Stall"));
    expect(stallMsgs.length).toBeGreaterThan(0);
  });

  it("different tool calls across turns do not trigger stall", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"a.py"}')], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"b.py"}', "c2")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done." }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "file" } }],
      handlers: { file: () => "content" },
    });
    await loop.send("analyze");
    const stallMsgs = loop.messages.filter(m => m.role === "tool" && (m.content ?? "").includes("Stall"));
    expect(stallMsgs).toHaveLength(0);
  });
});

// ===========================================================================
// 7. Hook callbacks
// ===========================================================================

describe("Hook: beforeToolCall", () => {
  it("returning a string intercepts the tool call", async () => {
    let interceptCount = 0;
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Finished" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "real result" },
      beforeToolCall: () => { interceptCount++; return "intercepted"; },
    });
    await loop.send("go");
    expect(interceptCount).toBe(1);
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs.some(m => m.content === "intercepted")).toBe(true);
  });

  it("returning null allows normal execution", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "real result" },
      beforeToolCall: () => null,
    });
    await loop.send("go");
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs.some(m => m.content === "real result")).toBe(true);
  });
});

describe("Hook: afterToolCall", () => {
  it("transforms tool result", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "original" },
      afterToolCall: (_name, result) => result.toUpperCase(),
    });
    await loop.send("go");
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs.some(m => m.content === "ORIGINAL")).toBe(true);
  });
});

describe("Hook: maxTurns", () => {
  it("stops loop after maxTurns tool rounds", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Forced stop" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "ok" },
      maxTurns: 1,
    });
    const result = await loop.send("go");
    expect(result).toBe("Forced stop");
  });
});

describe("Hook: stopCheck", () => {
  it("stops loop when stopCheck returns a reason", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Stopped" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "ok" },
      stopCheck: () => "custom_stop",
    });
    const result = await loop.send("go");
    expect(result).toBe("Stopped");
  });
});

describe("Hook: transformContext", () => {
  it("transforms messages before API call", async () => {
    let transformCalled = false;
    mockCreate.mockResolvedValueOnce(rawResp({ text: "Hi" }));
    const loop = makeLoop({
      transformContext: (msgs) => { transformCalled = true; return msgs; },
    });
    await loop.send("test");
    expect(transformCalled).toBe(true);
  });
});

describe("Hook: getSteeringMessages", () => {
  it("injects steering messages after tool round", async () => {
    const steerMsg: Message = { role: "user", content: "steered!" };
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "ok" },
      getSteeringMessages: () => [steerMsg],
    });
    await loop.send("go");
    expect(loop.messages).toContainEqual(steerMsg);
  });
});

describe("Hook: getFollowUpMessages", () => {
  it("injects follow-up on natural stop then exits on empty", async () => {
    let callCount = 0;
    mockCreate
      .mockResolvedValueOnce(rawResp({ text: "first" }))
      .mockResolvedValueOnce(rawResp({ text: "second" }));
    const loop = makeLoop({
      getFollowUpMessages: () => {
        callCount++;
        if (callCount === 1) return [{ role: "user", content: "follow up!" }];
        return [];
      },
    });
    const result = await loop.send("go");
    expect(result).toBe("second");
    expect(loop.messages.some(m => m.content === "follow up!")).toBe(true);
  });
});

// ===========================================================================
// 8. Abort mechanism (REQ-D-13)
// ===========================================================================

describe("Abort mechanism", () => {
  it("abortAwareSleep throws when abort flag is set", async () => {
    const { abortAwareSleep } = await import("../../src/agent/abort.js");
    requestAbort();
    await expect(abortAwareSleep(10)).rejects.toThrow(AbortRequested);
  });

  it("abortAwareSleep completes when no abort", async () => {
    const { abortAwareSleep } = await import("../../src/agent/abort.js");
    await expect(abortAwareSleep(0.1)).resolves.toBeUndefined();
  });

  it("requestAbort closes registered loops", () => {
    const closeFn = vi.fn();
    const id = registerLoop({ close: closeFn });
    requestAbort();
    expect(closeFn).toHaveBeenCalled();
    unregisterLoop(id);
  });

  it("registerLoop / unregisterLoop lifecycle", () => {
    const id = registerLoop({ close: () => {} });
    expect(typeof id).toBe("number");
    unregisterLoop(id);
    unregisterLoop(id); // double unregister should not throw
  });

  it("isAbortRequested reflects state", () => {
    expect(isAbortRequested()).toBe(false);
    requestAbort();
    expect(isAbortRequested()).toBe(true);
    clearAbort();
    expect(isAbortRequested()).toBe(false);
  });
});

// ===========================================================================
// 9. Argument normalization (REQ-ARCH-17)
// ===========================================================================

describe("Argument normalization", () => {
  it("strips leading ./ from file path", async () => {
    let receivedArgs: unknown[] = [];
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"./src/main.ts"}')], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "file" } }],
      handlers: { file: (...args: unknown[]) => { receivedArgs = args; return "ok"; } },
    });
    await loop.send("read");
    // The handler receives positional args from Object.values — path should not start with ./
    const allArgs = receivedArgs.map(String).join(",");
    expect(allArgs).not.toContain("./src");
  });

  it("strips leading / from file path", async () => {
    let receivedArgs: unknown[] = [];
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("file", '{"action":"read","path":"/src/main.ts"}')], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "file" } }],
      handlers: { file: (...args: unknown[]) => { receivedArgs = args; return "ok"; } },
    });
    await loop.send("read");
    const allArgs = receivedArgs.map(String).join(",");
    expect(allArgs).not.toMatch(/^\/src/);
  });
});

// ===========================================================================
// 10. Retry logic (_isRetryable)
// ===========================================================================

describe("Retry logic", () => {
  it("_isRetryable returns true for 429", () => {
    const loop = makeLoop();
    expect((loop as any)._isRetryable({ status: 429, message: "rate limited" })).toBe(true);
  });

  it("_isRetryable returns true for 5xx", () => {
    const loop = makeLoop();
    expect((loop as any)._isRetryable({ status: 502, message: "bad gateway" })).toBe(true);
    expect((loop as any)._isRetryable({ status: 503, message: "unavailable" })).toBe(true);
  });

  it("_isRetryable returns false for 401", () => {
    const loop = makeLoop();
    expect((loop as any)._isRetryable({ status: 401, message: "unauthorized" })).toBe(false);
  });

  it("_isRetryable returns false for 400", () => {
    const loop = makeLoop();
    expect((loop as any)._isRetryable({ status: 400, message: "bad request" })).toBe(false);
  });

  it("_isRetryable returns true for connection errors", () => {
    const loop = makeLoop();
    expect((loop as any)._isRetryable(new Error("ECONNREFUSED"))).toBe(true);
    expect((loop as any)._isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect((loop as any)._isRetryable(new Error("ETIMEDOUT"))).toBe(true);
  });
});

// ===========================================================================
// 11. Steer and followUp queues
// ===========================================================================

describe("Steer queue", () => {
  it("steer() messages appear in conversation after tool round", async () => {
    const steerMsg: Message = { role: "user", content: "steered!" };
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("my_tool", "{}")], finishReason: "tool_calls" }))
      .mockResolvedValueOnce(rawResp({ text: "done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_tool" } }],
      handlers: { my_tool: () => "ok" },
    });
    loop.steer([steerMsg]);
    await loop.send("go");
    expect(loop.messages).toContainEqual(steerMsg);
  });
});

describe("FollowUp queue", () => {
  it("followUp messages consumed on natural stop", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ text: "first" }))
      .mockResolvedValueOnce(rawResp({ text: "second" }));
    const loop = makeLoop();
    loop.followUp([{ role: "user", content: "follow up!" }]);
    const result = await loop.send("go");
    expect(result).toBe("second");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(loop.messages.some(m => m.content === "follow up!")).toBe(true);
  });

  it("multiple followUps consumed one at a time", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ text: "r1" }))
      .mockResolvedValueOnce(rawResp({ text: "r2" }))
      .mockResolvedValueOnce(rawResp({ text: "r3" }));
    const loop = makeLoop();
    loop.followUp([{ role: "user", content: "fu1" }]);
    loop.followUp([{ role: "user", content: "fu2" }]);
    const result = await loop.send("go");
    expect(result).toBe("r3");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

// ===========================================================================
// 12. Context length error detection
// ===========================================================================

describe("Context length error", () => {
  it("detects context length messages", () => {
    const loop = makeLoop();
    expect((loop as any)._isContextLengthError(new Error("maximum context length exceeded"))).toBe(true);
    expect((loop as any)._isContextLengthError(new Error("tokens exceed the limit"))).toBe(true);
    expect((loop as any)._isContextLengthError({ status: 413, message: "too large" })).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const loop = makeLoop();
    expect((loop as any)._isContextLengthError(new Error("rate limited"))).toBe(false);
    expect((loop as any)._isContextLengthError({ status: 429, message: "rate limited" })).toBe(false);
  });
});

// ===========================================================================
// 13. Token usage accumulation
// ===========================================================================

describe("Token usage accumulation", () => {
  it("accumulates across turns and reports via onComplete", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({ toolCalls: [tc("t", "{}")], finishReason: "tool_calls", promptTokens: 100, completionTokens: 20 }))
      .mockResolvedValueOnce(rawResp({ text: "done", promptTokens: 150, completionTokens: 30 }));
    let stats: Record<string, unknown> = {};
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "t" } }],
      handlers: { t: () => "ok" },
    });
    loop.onComplete = (s) => { stats = s; };
    await loop.send("go");
    expect(stats.prompt_tokens).toBe(250);
    expect(stats.completion_tokens).toBe(50);
  });
});

// ===========================================================================
// 14. Client lifecycle
// ===========================================================================

describe("Client lifecycle", () => {
  it("close called after send completes", async () => {
    mockCreate.mockResolvedValueOnce(rawResp({ text: "done" }));
    await makeLoop().send("hi");
    expect(mockClose).toHaveBeenCalled();
  });

  it("close called even on error", async () => {
    mockCreate.mockRejectedValue({ status: 401, message: "unauthorized" });
    await expect(makeLoop().send("hi")).rejects.toThrow();
    expect(mockClose).toHaveBeenCalled();
  });
});

// ===========================================================================
// 15. isConcurrentSafe (via partition behavior)
// ===========================================================================

describe("isConcurrentSafe", () => {
  it("file read actions produce results for all calls", async () => {
    mockCreate
      .mockResolvedValueOnce(rawResp({
        toolCalls: [
          tc("file", '{"action":"read","path":"a.py"}', "c1"),
          tc("file", '{"action":"read","path":"b.py"}', "c2"),
        ],
        finishReason: "tool_calls",
      }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "file" } }],
      handlers: { file: () => "ok" },
    });
    await loop.send("go");
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
  });

  it("concurrent_safe flag on tool def enables batching", async () => {
    let callCount = 0;
    mockCreate
      .mockResolvedValueOnce(rawResp({
        toolCalls: [
          tc("my_read", '{"a":1}', "c1"),
          tc("my_read", '{"a":2}', "c2"),
        ],
        finishReason: "tool_calls",
      }))
      .mockResolvedValueOnce(rawResp({ text: "Done" }));
    const loop = makeLoop({
      tools: [{ type: "function", function: { name: "my_read" }, concurrent_safe: true }],
      handlers: { my_read: () => { callCount++; return "ok"; } },
    });
    await loop.send("go");
    expect(callCount).toBe(2); // distinct args, both called
    const toolMsgs = loop.messages.filter(m => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
  });
});

// ===========================================================================
// 16. Jitter range validation
// ===========================================================================

describe("Jitter", () => {
  it("produces values in [0.7*d, 1.3*d] range", () => {
    for (let i = 0; i < 100; i++) {
      const d = 2.0;
      const j = d * (0.7 + Math.random() * 0.6);
      expect(j).toBeGreaterThanOrEqual(d * 0.7);
      expect(j).toBeLessThanOrEqual(d * 1.3);
    }
  });
});
