export interface ContentChunk {
  type: "content";
  text: string;
}

export interface ReasoningChunk {
  type: "reasoning";
  text: string;
}

export interface ToolCallChunk {
  type: "tool_call";
  id: string;
  name: string;
  args: string; // JSON string of accumulated arguments
  status?: "executing" | "complete" | "error"; // lifecycle state for live UI updates
  result?: string; // tool output (populated on complete/error)
}

export interface DoneChunk {
  type: "done";
  usage?: TokenUsage;
}

export interface ErrorChunk {
  type: "error";
  message: string;
  retryable: boolean;
}

export interface StatusChunk {
  type: "status";
  message: string;
}

export type StreamChunk = ContentChunk | ReasoningChunk | ToolCallChunk | DoneChunk | ErrorChunk | StatusChunk;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface StreamTiming {
  requestStart: number;
  firstTokenAt: number | null;
  endAt: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCallChunk[];
  usage: TokenUsage;
  timing?: StreamTiming;
}
