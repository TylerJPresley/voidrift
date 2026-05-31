export interface ContentChunk {
  type: "content";
  text: string;
}

export interface ToolCallChunk {
  type: "tool_call";
  id: string;
  name: string;
  args: string; // JSON string of accumulated arguments
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

export type StreamChunk = ContentChunk | ToolCallChunk | DoneChunk | ErrorChunk | StatusChunk;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCallChunk[];
  usage: TokenUsage;
}
