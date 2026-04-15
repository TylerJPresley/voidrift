/**
 * Mock adapter for testing the agent loop without a real model.
 *
 * Usage:
 *   const mock = new MockAdapter([
 *     { text: "Hello", toolCalls: [] },                    // text response
 *     { text: "", toolCalls: [tc("file", {action:"read", path:"x.py"})], finishReason: "tool_calls" },
 *     { text: "Done reading.", toolCalls: [] },             // final response
 *   ]);
 *   const model: ModelInterface = { config: mockConfig(), adapter: mock };
 *   const agent = new AgentLoop({ model, ... });
 *   const result = await agent.send("do something");
 */

import type { ProtocolAdapter, RequestOpts } from "../agent/protocol.js";
import type { ModelConfig, ModelInterface } from "../models.js";
import type { ToolCall, ParsedResponse } from "../agent/types.js";

export interface MockResponse {
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class MockAdapter implements ProtocolAdapter {
  private _responses: MockResponse[];
  private _callIndex = 0;
  readonly calls: Array<{ messages: unknown[]; tools?: unknown[] }> = [];

  constructor(responses: MockResponse[]) {
    this._responses = responses;
  }

  createClient(): MockClient {
    return new MockClient(this);
  }

  buildRequest(opts: RequestOpts): Record<string, unknown> {
    return {
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      max_tokens: opts.maxTokens,
    };
  }

  parseResponse(raw: unknown): ParsedResponse {
    return raw as ParsedResponse;
  }

  /** Called by MockClient to get the next scripted response. */
  _nextResponse(req: Record<string, unknown>): ParsedResponse {
    this.calls.push({ messages: req.messages as unknown[], tools: req.tools as unknown[] });
    const idx = this._callIndex++;
    const r = this._responses[idx] ?? { text: "", toolCalls: [] };
    return {
      text: r.text ?? "",
      toolCalls: r.toolCalls ?? [],
      finishReason: r.finishReason ?? (r.toolCalls?.length ? "tool_calls" : "stop"),
      usage: {
        prompt_tokens: r.usage?.prompt_tokens ?? 10,
        completion_tokens: r.usage?.completion_tokens ?? 5,
        total_tokens: (r.usage?.prompt_tokens ?? 10) + (r.usage?.completion_tokens ?? 5),
      },
    };
  }

  get callCount(): number { return this._callIndex; }
}

/** Fake OpenAI-compatible client that routes through MockAdapter. */
class MockClient {
  private _adapter: MockAdapter;
  chat: { completions: { create: (req: unknown) => Promise<unknown> } };

  constructor(adapter: MockAdapter) {
    this._adapter = adapter;
    this.chat = {
      completions: {
        create: async (req: unknown) => this._adapter._nextResponse(req as Record<string, unknown>),
      },
    };
  }

  close(): void {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mockConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    alias: "test-model",
    modelId: "test-model-id",
    baseUrl: "http://localhost:9999",
    apiKey: "test-key",
    protocol: "openai",
    maxTokens: 4096,
    maxReadLines: 2000,
    maxInputChars: 0,
    concurrency: 1,
    ...overrides,
  };
}

export function mockModel(responses: MockResponse[], configOverrides?: Partial<ModelConfig>): { model: ModelInterface; adapter: MockAdapter } {
  const adapter = new MockAdapter(responses);
  const model: ModelInterface = { config: mockConfig(configOverrides) };
  // Inject adapter — the AgentLoop uses getAdapter(protocol) but we override via the model
  (model as Record<string, unknown>).adapter = adapter;
  return { model, adapter };
}

export function tc(name: string, args: Record<string, unknown>, id?: string): ToolCall {
  return {
    id: id ?? `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}
