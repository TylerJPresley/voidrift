import { describe, it, expect } from "vitest";
import { OpenAIAdapter, AnthropicAdapter } from "../../src/agent/protocol.js";

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  it("includes stream_options for known providers", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", messages: [], maxTokens: 1000, stream: true, provider: "openai",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("excludes stream_options for generic providers (REQ-ARCH-20)", () => {
    const req = adapter.buildRequest({
      model: "local", messages: [], maxTokens: 1000, stream: true, provider: undefined,
    });
    expect(req.stream_options).toBeUndefined();
  });

  it("excludes stream_options when not streaming", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", messages: [], maxTokens: 1000, stream: false, provider: "openai",
    });
    expect(req.stream_options).toBeUndefined();
  });

  it("parses a standard response", () => {
    const raw = {
      choices: [{ message: { content: "Hello", tool_calls: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const parsed = adapter.parseResponse(raw);
    expect(parsed.text).toBe("Hello");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.usage.prompt_tokens).toBe(10);
  });

  it("parses tool calls", () => {
    const raw = {
      choices: [{ message: { content: "", tool_calls: [
        { id: "tc1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"x.py"}' } },
      ] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const parsed = adapter.parseResponse(raw);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("file");
  });
});

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter();

  it("extracts system messages as top-level parameter", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(req.system).toBeDefined();
    expect((req.system as Array<Record<string, unknown>>)[0].text).toBe("You are helpful.");
    // Non-system messages should not include system
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs.every(m => m.role !== "system")).toBe(true);
  });

  it("maps tool_choice required → any", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false, messages: [],
      tools: [{ type: "function", function: { name: "file", description: "", parameters: { type: "object", properties: {} } } }],
      toolChoice: "required",
    });
    expect(req.tool_choice).toEqual({ type: "any" });
  });

  it("maps finish reasons correctly", () => {
    const cases: Array<[string, string]> = [
      ["end_turn", "stop"],
      ["tool_use", "tool_calls"],
      ["max_tokens", "length"],
    ];
    for (const [input, expected] of cases) {
      const parsed = adapter.parseResponse({
        content: [{ type: "text", text: "hi" }],
        stop_reason: input,
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      expect(parsed.finishReason).toBe(expected);
    }
  });

  it("batches consecutive tool results into single user message", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "user", content: "do stuff" },
        { role: "assistant", content: null, tool_calls: [
          { id: "t1", type: "function" as const, function: { name: "file", arguments: "{}" } },
          { id: "t2", type: "function" as const, function: { name: "file", arguments: "{}" } },
        ] },
        { role: "tool", content: "result1", tool_call_id: "t1", name: "file" },
        { role: "tool", content: "result2", tool_call_id: "t2", name: "file" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    // Last message should be a user message with 2 tool_result blocks
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("user");
    expect((last.content as unknown[]).length).toBe(2);
  });
});
