/**
 * Protocol adapters: OpenAI + Anthropic (REQ-ARCH-22).
 *
 * The agent loop stores history in OpenAI format. Adapters translate
 * to/from wire format. No protocol branches in the loop.
 */

import type { Message, ToolCall, Usage, ParsedResponse } from "./types.js";
import type { ModelConfig } from "../models.js";
import type { ToolDef } from "../tools/registry.js";

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ProtocolAdapter {
  createClient(config: ModelConfig): unknown;
  buildRequest(opts: RequestOpts): Record<string, unknown>;
  parseResponse(raw: unknown): ParsedResponse;
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
    const req: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };
    if (opts.tools?.length) {
      req.tools = opts.tools.map(t => ({ type: t.type, function: t.function }));
      if (opts.toolChoice) req.tool_choice = opts.toolChoice;
    }
    // Only add stream_options for known providers (REQ-ARCH-20)
    if (opts.stream && opts.provider && STREAM_USAGE_PROVIDERS.has(opts.provider)) {
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
}

// ---------------------------------------------------------------------------
// Anthropic Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProtocolAdapter {
  createClient(config: ModelConfig): unknown {
    const Anthropic = require("@anthropic-ai/sdk").default;
    return new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getAdapter(protocol: string): ProtocolAdapter {
  if (protocol === "anthropic") return new AnthropicAdapter();
  return new OpenAIAdapter();
}
