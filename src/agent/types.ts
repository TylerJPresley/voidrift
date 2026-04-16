/**
 * Shared types for the agent loop.
 */

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface LoopState {
  messages: Message[];
  turnCount: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  toolsCalledThisTurn: string[];
}

export interface ProgressData {
  prompt_tokens?: number;
  completion_tokens?: number;
  ctx_pct?: number;
  elapsed?: number;
  turn?: number;
  last_tool?: string;
}

export interface ParsedResponse {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: Usage;
}

/** Events yielded by adapter.iterStream(). */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "thinking"; text: string }
  | { type: "finish"; finishReason: string; usage: Usage };
