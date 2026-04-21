/**
 * Protocol adapters: OpenAI + Anthropic (REQ-ARCH-22).
 *
 * The agent loop stores history in OpenAI format. Adapters translate
 * to/from wire format. No protocol branches in the loop.
 */

import type { Message, ToolCall, Usage, ParsedResponse, StreamEvent } from "./types.js";
import type { ModelConfig } from "../models.js";
import type { ToolDef } from "../tools/registry.js";

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ProtocolAdapter {
  createClient(config: ModelConfig): unknown;
  buildRequest(opts: RequestOpts): Record<string, unknown>;
  parseResponse(raw: unknown): ParsedResponse;
  call(client: unknown, wireReq: Record<string, unknown>): Promise<unknown>;
  iterStream(client: unknown, wireReq: Record<string, unknown>): AsyncIterable<StreamEvent>;
}

export interface RequestOpts {
  model: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: string | Record<string, unknown>;
  maxTokens: number;
  stream: boolean;
  provider?: string;
}

// Known providers that support stream_options
const STREAM_USAGE_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);

// Providers that support cache_control in OpenAI-compatible format (REQ-ARCH-16)
const CACHE_CONTROL_PROVIDERS = new Set(["openai", "deepseek", "gemini"]);

// ---------------------------------------------------------------------------
// OpenAI Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements ProtocolAdapter {
  createClient(config: ModelConfig): unknown {
    // Lazy import — OpenAI SDK loaded only when needed
    const { default: OpenAI } = require("openai");
    return new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      timeout: 600_000,
      maxRetries: 0, // We handle retries ourselves
    });
  }

  buildRequest(opts: RequestOpts): Record<string, unknown> {
    // Add cache_control to system messages for providers that support it (REQ-ARCH-16)
    const messages = opts.provider && CACHE_CONTROL_PROVIDERS.has(opts.provider)
      ? opts.messages.map(m => m.role === "system"
        ? { role: m.role, content: [{ type: "text", text: m.content ?? "", cache_control: { type: "ephemeral" } }] }
        : m)
      : opts.messages;

    const req: Record<string, unknown> = {
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };
    if (opts.tools?.length) {
      req.tools = opts.tools.map(t => ({ type: t.type, function: t.function }));
      if (opts.toolChoice) req.tool_choice = opts.toolChoice;
    }
    // Include usage in streaming responses (OpenAI API spec)
    if (opts.stream) {
      req.stream_options = { include_usage: true };
    }
    return req;
  }

  parseResponse(raw: unknown): ParsedResponse {
    const r = raw as Record<string, unknown>;
    const choices = (r.choices as Array<Record<string, unknown>>) ?? [];
    const choice = choices[0] ?? {};
    const msg = (choice.message as Record<string, unknown>) ?? {};
    const usage = (r.usage as Record<string, number>) ?? {};

    const toolCalls: ToolCall[] = [];
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, string>;
        toolCalls.push({
          id: String(tc.id),
          type: "function",
          function: { name: fn.name, arguments: fn.arguments ?? "{}" },
        });
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
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
    };
  }

  async call(client: unknown, wireReq: Record<string, unknown>): Promise<unknown> {
    const c = client as { chat: { completions: { create: (req: unknown) => Promise<unknown> } } };
    return c.chat.completions.create(wireReq);
  }

  async *iterStream(client: unknown, wireReq: Record<string, unknown>): AsyncIterable<StreamEvent> {
    const c = client as { chat: { completions: { create: (req: unknown) => Promise<unknown> } } };
    const stream = await c.chat.completions.create({ ...wireReq, stream: true }) as AsyncIterable<Record<string, unknown>>;
    let finishReason = "stop";
    let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for await (const chunk of stream) {
      // Usage chunk (final chunk with stream_options)
      if (chunk.usage) {
        const u = chunk.usage as Record<string, number>;
        usage = { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? 0 };
      }
      const choices = (chunk.choices as Array<Record<string, unknown>>) ?? [];
      if (!choices.length) continue;
      const delta = (choices[0].delta as Record<string, unknown>) ?? {};
      if (choices[0].finish_reason) finishReason = String(choices[0].finish_reason);

      // Text delta
      if (delta.content) yield { type: "text", text: String(delta.content) };

      // Tool call deltas
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
          const fn = (tc.function as Record<string, string>) ?? {};
          yield {
            type: "tool_call",
            index: Number(tc.index ?? 0),
            id: tc.id ? String(tc.id) : undefined,
            name: fn.name ?? undefined,
            arguments: fn.arguments ?? undefined,
          };
        }
      }
    }

    yield { type: "finish", finishReason, usage };
  }
}// ---------------------------------------------------------------------------
// Anthropic Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProtocolAdapter {
  createClient(config: ModelConfig): unknown {
    const Anthropic = require("@anthropic-ai/sdk").default;
    // Anthropic SDK adds /v1/messages itself — strip trailing /v1 if present
    let baseURL = config.baseUrl;
    if (baseURL.endsWith("/v1")) baseURL = baseURL.slice(0, -3);
    return new Anthropic({
      apiKey: config.apiKey,
      baseURL,
      timeout: 600_000,
      maxRetries: 0,
    });
  }

  buildRequest(opts: RequestOpts): Record<string, unknown> {
    // Extract system messages
    const systemMsgs = opts.messages.filter(m => m.role === "system");
    const nonSystem = opts.messages.filter(m => m.role !== "system");

    // Build system parameter with cache control (REQ-ARCH-19)
    const systemContent = systemMsgs.map(m => ({
      type: "text",
      text: m.content ?? "",
      cache_control: { type: "ephemeral" },
    }));

    // Batch consecutive tool results into single user message
    const messages = this._batchToolResults(nonSystem);

    const req: Record<string, unknown> = {
      model: opts.model,
      system: systemContent,
      messages,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };

    if (opts.tools?.length) {
      req.tools = opts.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (opts.toolChoice === "required") {
        req.tool_choice = { type: "any" };
      } else if (opts.toolChoice === "auto") {
        req.tool_choice = { type: "auto" };
      }
    }

    return req;
  }

  parseResponse(raw: unknown): ParsedResponse {
    const r = raw as Record<string, unknown>;
    const content = (r.content as Array<Record<string, unknown>>) ?? [];
    const usage = (r.usage as Record<string, number>) ?? {};

    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === "text") {
        text += String(block.text ?? "");
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: String(block.id),
          type: "function",
          function: {
            name: String(block.name),
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      } else if (block.type === "thinking") {
        // Logged by caller, excluded from text
      }
    }

    // Map stop_reason
    const stopReason = String(r.stop_reason ?? "end_turn");
    const finishReason = stopReason === "end_turn" ? "stop"
      : stopReason === "tool_use" ? "tool_calls"
      : stopReason === "max_tokens" ? "length"
      : stopReason;

    return {
      text,
      toolCalls,
      finishReason,
      usage: {
        prompt_tokens: usage.input_tokens ?? 0,
        completion_tokens: usage.output_tokens ?? 0,
        total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
    };
  }

  private _batchToolResults(messages: Message[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    let toolBatch: Message[] = [];

    const flushBatch = () => {
      if (!toolBatch.length) return;
      result.push({
        role: "user",
        content: toolBatch.map(m => ({
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content ?? "",
        })),
      });
      toolBatch = [];
    };

    for (const m of messages) {
      if (m.role === "tool") {
        toolBatch.push(m);
      } else {
        flushBatch();
        if (m.role === "assistant" && m.tool_calls?.length) {
          result.push({
            role: "assistant",
            content: m.tool_calls.map(tc => ({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || "{}"),
            })),
          });
        } else {
          result.push({ role: m.role, content: m.content ?? "" });
        }
      }
    }
    flushBatch();
    return result;
  }

  async call(client: unknown, wireReq: Record<string, unknown>): Promise<unknown> {
    const c = client as { messages: { create: (req: unknown) => Promise<unknown> } };
    return c.messages.create(wireReq);
  }

  async *iterStream(client: unknown, wireReq: Record<string, unknown>): AsyncIterable<StreamEvent> {
    const c = client as { messages: { create: (req: unknown) => Promise<unknown> } };
    const stream = await c.messages.create({ ...wireReq, stream: true }) as AsyncIterable<Record<string, unknown>>;
    let finishReason = "stop";
    let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let thinkBuf = "";

    for await (const event of stream) {
      const t = String(event.type ?? "");

      if (t === "message_start") {
        const msg = (event.message as Record<string, unknown>) ?? {};
        const u = (msg.usage as Record<string, number>) ?? {};
        usage.prompt_tokens = u.input_tokens ?? 0;
      } else if (t === "message_delta") {
        const delta = (event.delta as Record<string, unknown>) ?? {};
        if (delta.stop_reason) {
          const sr = String(delta.stop_reason);
          finishReason = sr === "end_turn" ? "stop" : sr === "tool_use" ? "tool_calls" : sr === "max_tokens" ? "length" : sr;
        }
        const u = (event.usage as Record<string, number>) ?? {};
        if (u.output_tokens) usage.completion_tokens = u.output_tokens;
      } else if (t === "content_block_start") {
        const block = (event.content_block as Record<string, unknown>) ?? {};
        if (block.type === "tool_use") {
          yield { type: "tool_call", index: Number(event.index ?? 0), id: String(block.id ?? ""), name: String(block.name ?? "") };
        } else if (block.type === "thinking") {
          thinkBuf = "";
        }
      } else if (t === "content_block_delta") {
        const delta = (event.delta as Record<string, unknown>) ?? {};
        if (delta.type === "text_delta") {
          yield { type: "text", text: String(delta.text ?? "") };
        } else if (delta.type === "input_json_delta") {
          yield { type: "tool_call", index: Number(event.index ?? 0), arguments: String(delta.partial_json ?? "") };
        } else if (delta.type === "thinking_delta") {
          thinkBuf += String(delta.thinking ?? "");
        }
      } else if (t === "content_block_stop") {
        if (thinkBuf) { yield { type: "thinking", text: thinkBuf }; thinkBuf = ""; }
      }
    }

    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    yield { type: "finish", finishReason, usage };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getAdapter(protocol: string): ProtocolAdapter {
  if (protocol === "anthropic") return new AnthropicAdapter();
  return new OpenAIAdapter();
}
