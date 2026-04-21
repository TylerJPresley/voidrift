import { describe, it, expect } from "vitest";
import { OpenAIAdapter, AnthropicAdapter, getAdapter } from "../../src/agent/protocol.js";

// ---------------------------------------------------------------------------
// getAdapter factory
// ---------------------------------------------------------------------------

describe("getAdapter", () => {
  it("returns OpenAIAdapter for 'openai'", () => {
    expect(getAdapter("openai")).toBeInstanceOf(OpenAIAdapter);
  });
  it("returns AnthropicAdapter for 'anthropic'", () => {
    expect(getAdapter("anthropic")).toBeInstanceOf(AnthropicAdapter);
  });
  it("defaults to OpenAIAdapter for unknown protocol", () => {
    expect(getAdapter("unknown")).toBeInstanceOf(OpenAIAdapter);
  });
});

// ---------------------------------------------------------------------------
// OpenAIAdapter
// ---------------------------------------------------------------------------

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  // --- buildRequest ---

  it("includes stream_options for known providers", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", messages: [], maxTokens: 1000, stream: true, provider: "openai",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("includes stream_options for all streaming requests", () => {
    const req = adapter.buildRequest({
      model: "local", messages: [], maxTokens: 1000, stream: true, provider: undefined,
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("excludes stream_options when not streaming", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", messages: [], maxTokens: 1000, stream: false, provider: "openai",
    });
    expect(req.stream_options).toBeUndefined();
  });

  it("includes stream_options for gemini provider", () => {
    const req = adapter.buildRequest({
      model: "gemini-2.5-pro", messages: [], maxTokens: 1000, stream: true, provider: "gemini",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("includes stream_options for z.ai provider", () => {
    const req = adapter.buildRequest({
      model: "glm-4", messages: [], maxTokens: 1000, stream: true, provider: "z.ai",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("includes stream_options for empty string provider", () => {
    const req = adapter.buildRequest({
      model: "local-model", messages: [], maxTokens: 1000, stream: true, provider: "",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("includes stream_options for vllm provider", () => {
    const req = adapter.buildRequest({
      model: "qwen3", messages: [], maxTokens: 1000, stream: true, provider: "vllm",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  it("includes stream_options regardless of provider", () => {
    const req = adapter.buildRequest({
      model: "m", messages: [], maxTokens: 1000, stream: true, provider: "",
    });
    expect(req.stream_options).toEqual({ include_usage: true });
  });

  // --- buildRequest: cache_control (REQ-ARCH-16) ---

  it("adds cache_control to system messages for openai provider", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", maxTokens: 1000, stream: false, provider: "openai",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("system");
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("You are helpful.");
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    // User message unchanged
    expect(msgs[1].content).toBe("Hi");
  });

  it("adds cache_control to system messages for deepseek provider", () => {
    const req = adapter.buildRequest({
      model: "deepseek-chat", maxTokens: 1000, stream: false, provider: "deepseek",
      messages: [
        { role: "system", content: "System prompt." },
        { role: "user", content: "Hello" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds cache_control to system messages for gemini provider", () => {
    const req = adapter.buildRequest({
      model: "gemini-2.5-pro", maxTokens: 1000, stream: false, provider: "gemini",
      messages: [
        { role: "system", content: "System prompt." },
        { role: "user", content: "Hello" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does NOT add cache_control for unknown providers", () => {
    const req = adapter.buildRequest({
      model: "local", maxTokens: 1000, stream: false, provider: "vllm",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    // System message should be plain string content, not array
    expect(msgs[0].content).toBe("You are helpful.");
  });

  it("does NOT add cache_control when provider is undefined", () => {
    const req = adapter.buildRequest({
      model: "local", maxTokens: 1000, stream: false,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].content).toBe("You are helpful.");
  });

  it("does NOT add cache_control when provider is empty string", () => {
    const req = adapter.buildRequest({
      model: "local", maxTokens: 1000, stream: false, provider: "",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs[0].content).toBe("You are helpful.");
  });

  it("passes through model and max_tokens", () => {
    const req = adapter.buildRequest({
      model: "gpt-4", messages: [], maxTokens: 512, stream: false,
    });
    expect(req.model).toBe("gpt-4");
    expect(req.max_tokens).toBe(512);
  });

  // --- parseResponse ---

  it("parses a standard text response", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "Hello", tool_calls: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(parsed.text).toBe("Hello");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.usage.prompt_tokens).toBe(10);
  });

  it("parses a single tool call", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "", tool_calls: [
        { id: "tc1", type: "function", function: { name: "file", arguments: '{"action":"read","path":"x.py"}' } },
      ] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("file");
    expect(parsed.toolCalls[0].id).toBe("tc1");
    expect(parsed.finishReason).toBe("tool_calls");
  });

  it("parses multiple tool calls in one response", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: null, tool_calls: [
        { id: "tc1", type: "function", function: { name: "file", arguments: '{"action":"read"}' } },
        { id: "tc2", type: "function", function: { name: "shell", arguments: '{"cmd":"ls"}' } },
        { id: "tc3", type: "function", function: { name: "http", arguments: '{"url":"http://x"}' } },
      ] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });
    expect(parsed.toolCalls).toHaveLength(3);
    expect(parsed.toolCalls[0].function.name).toBe("file");
    expect(parsed.toolCalls[1].function.name).toBe("shell");
    expect(parsed.toolCalls[2].function.name).toBe("http");
    expect(parsed.toolCalls[2].id).toBe("tc3");
  });

  it("parses finish_reason 'length'", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "Partial..." }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(parsed.finishReason).toBe("length");
  });

  it("parses finish_reason 'content_filter'", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "" }, finish_reason: "content_filter" }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    });
    expect(parsed.finishReason).toBe("content_filter");
  });

  it("defaults finish_reason to 'stop' when missing", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "ok" } }],
      usage: {},
    });
    expect(parsed.finishReason).toBe("stop");
  });

  it("handles empty choices array", () => {
    const parsed = adapter.parseResponse({ choices: [], usage: {} });
    expect(parsed.text).toBe("");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.finishReason).toBe("stop");
  });

  it("handles missing tool_calls gracefully", () => {
    const parsed = adapter.parseResponse({
      choices: [{ message: { content: "hi", tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    expect(parsed.toolCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AnthropicAdapter
// ---------------------------------------------------------------------------

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter();

  // --- buildRequest: system extraction ---

  it("extracts system messages as top-level parameter with cache_control", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(req.system).toBeDefined();
    const sys = req.system as Array<Record<string, unknown>>;
    expect(sys[0].text).toBe("You are helpful.");
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs.every(m => m.role !== "system")).toBe(true);
  });

  it("handles multiple system messages", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "system", content: "First system." },
        { role: "system", content: "Second system." },
        { role: "user", content: "Hi" },
      ],
    });
    const sys = req.system as Array<Record<string, unknown>>;
    expect(sys).toHaveLength(2);
    expect(sys[0].text).toBe("First system.");
    expect(sys[1].text).toBe("Second system.");
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sys[1].cache_control).toEqual({ type: "ephemeral" });
  });

  // --- buildRequest: tool schema conversion ---

  it("converts tools from OpenAI format (parameters → input_schema)", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false, messages: [],
      tools: [{
        type: "function",
        function: {
          name: "my_tool",
          description: "Does something",
          parameters: { type: "object", properties: { x: { type: "string" } } },
        },
      }],
    });
    const tools = req.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("my_tool");
    expect(tools[0].description).toBe("Does something");
    expect(tools[0].input_schema).toEqual({ type: "object", properties: { x: { type: "string" } } });
    // Should NOT have OpenAI-style keys
    expect(tools[0]).not.toHaveProperty("function");
    expect(tools[0]).not.toHaveProperty("parameters");
  });

  it("converts multiple tools preserving all schemas", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false, messages: [],
      tools: [
        { type: "function", function: { name: "read", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
        { type: "function", function: { name: "write", description: "Write file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
      ],
    });
    const tools = req.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("read");
    expect(tools[1].name).toBe("write");
    expect((tools[0].input_schema as Record<string, unknown>).required).toEqual(["path"]);
    expect((tools[1].input_schema as Record<string, unknown>).required).toEqual(["path", "content"]);
  });

  // --- buildRequest: tool_choice mapping ---

  it("maps tool_choice required → any", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false, messages: [],
      tools: [{ type: "function", function: { name: "t", description: "", parameters: { type: "object", properties: {} } } }],
      toolChoice: "required",
    });
    expect(req.tool_choice).toEqual({ type: "any" });
  });

  it("maps tool_choice auto → auto", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false, messages: [],
      tools: [{ type: "function", function: { name: "t", description: "", parameters: { type: "object", properties: {} } } }],
      toolChoice: "auto",
    });
    expect(req.tool_choice).toEqual({ type: "auto" });
  });

  // --- buildRequest: stream key stripped ---

  it("includes stream in request", () => {
    const req = adapter.buildRequest({
      model: "m", maxTokens: 100, stream: true, messages: [],
    });
    // stream is passed through (Anthropic SDK uses it)
    expect(req.stream).toBe(true);
  });

  // --- buildRequest: tool_result batching ---

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
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("user");
    const content = last.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("tool_result");
    expect(content[0].tool_use_id).toBe("t1");
    expect(content[1].type).toBe("tool_result");
    expect(content[1].tool_use_id).toBe("t2");
  });

  it("batches three consecutive tool results", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [
          { id: "tc1", type: "function" as const, function: { name: "a", arguments: "{}" } },
          { id: "tc2", type: "function" as const, function: { name: "b", arguments: "{}" } },
          { id: "tc3", type: "function" as const, function: { name: "c", arguments: "{}" } },
        ] },
        { role: "tool", content: "r1", tool_call_id: "tc1" },
        { role: "tool", content: "r2", tool_call_id: "tc2" },
        { role: "tool", content: "r3", tool_call_id: "tc3" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("user");
    expect((last.content as unknown[]).length).toBe(3);
  });

  it("converts assistant tool_calls to Anthropic tool_use content blocks", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [
          { id: "tc1", type: "function" as const, function: { name: "file", arguments: '{"action":"read"}' } },
        ] },
        { role: "tool", content: "file content", tool_call_id: "tc1" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    const assistantMsg = msgs[1];
    expect(assistantMsg.role).toBe("assistant");
    const content = assistantMsg.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("tool_use");
    expect(content[0].name).toBe("file");
    expect(content[0].id).toBe("tc1");
    expect(content[0].input).toEqual({ action: "read" });
  });

  it("handles mixed user-text and tool-result messages in sequence", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: null, tool_calls: [
          { id: "tc1", type: "function" as const, function: { name: "read", arguments: "{}" } },
          { id: "tc2", type: "function" as const, function: { name: "write", arguments: "{}" } },
        ] },
        { role: "tool", content: "result1", tool_call_id: "tc1" },
        { role: "tool", content: "result2", tool_call_id: "tc2" },
        { role: "user", content: "thanks" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    // user, assistant, user(batched tools), user
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user"); // batched tool results
    expect(msgs[3].role).toBe("user"); // "thanks"
    expect((msgs[2].content as unknown[]).length).toBe(2);
  });

  it("skips system messages in message conversion", () => {
    const req = adapter.buildRequest({
      model: "claude", maxTokens: 1000, stream: false,
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "hi" },
      ],
    });
    const msgs = req.messages as Array<Record<string, unknown>>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });

  // --- parseResponse ---

  it("parses text-only response", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "text", text: "Hello from Claude!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parsed.text).toBe("Hello from Claude!");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.finishReason).toBe("stop");
  });

  it("parses tool_use response", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "tool_use", id: "tu1", name: "my_tool", input: { x: 1 } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    expect(parsed.finishReason).toBe("tool_calls");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("my_tool");
    expect(JSON.parse(parsed.toolCalls[0].function.arguments)).toEqual({ x: 1 });
    expect(parsed.toolCalls[0].id).toBe("tu1");
  });

  it("parses multiple tool_use blocks in one response", () => {
    const parsed = adapter.parseResponse({
      content: [
        { type: "tool_use", id: "tu1", name: "file", input: { action: "read" } },
        { type: "tool_use", id: "tu2", name: "shell", input: { cmd: "ls" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 30, output_tokens: 15 },
    });
    expect(parsed.toolCalls).toHaveLength(2);
    expect(parsed.toolCalls[0].function.name).toBe("file");
    expect(parsed.toolCalls[1].function.name).toBe("shell");
  });

  it("parses mixed text + tool_use response", () => {
    const parsed = adapter.parseResponse({
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tu1", name: "lookup", input: { q: "test" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 25, output_tokens: 12 },
    });
    expect(parsed.text).toBe("Let me check.");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.finishReason).toBe("tool_calls");
  });

  it("maps max_tokens stop_reason to 'length'", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "text", text: "Partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parsed.finishReason).toBe("length");
  });

  it("maps all finish reasons correctly", () => {
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

  it("parses usage fields including cache tokens", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    });
    expect(parsed.usage.prompt_tokens).toBe(100);
    expect(parsed.usage.completion_tokens).toBe(50);
    expect(parsed.usage.total_tokens).toBe(150);
    expect(parsed.usage.cache_creation_input_tokens).toBe(10);
    expect(parsed.usage.cache_read_input_tokens).toBe(5);
  });

  it("computes total_tokens as input + output", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 42, output_tokens: 18 },
    });
    expect(parsed.usage.total_tokens).toBe(60);
  });

  // --- parseResponse: thinking blocks ---

  it("skips thinking blocks in text output", () => {
    const parsed = adapter.parseResponse({
      content: [
        { type: "thinking", thinking: "Let me reason about this..." },
        { type: "text", text: "The answer is 42." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 15 },
    });
    expect(parsed.text).toBe("The answer is 42.");
    expect(parsed.text).not.toContain("reason");
    expect(parsed.toolCalls).toHaveLength(0);
  });

  it("returns empty text when response has only thinking block", () => {
    const parsed = adapter.parseResponse({
      content: [{ type: "thinking", thinking: "deep thoughts" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parsed.text).toBe("");
  });

  it("handles thinking + tool_use blocks", () => {
    const parsed = adapter.parseResponse({
      content: [
        { type: "thinking", thinking: "I should use a tool" },
        { type: "tool_use", id: "tu1", name: "file", input: { action: "read" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 15, output_tokens: 10 },
    });
    expect(parsed.text).toBe("");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.finishReason).toBe("tool_calls");
  });

  it("handles empty content array", () => {
    const parsed = adapter.parseResponse({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    expect(parsed.text).toBe("");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.finishReason).toBe("stop");
  });
});
