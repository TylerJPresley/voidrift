export type ToolStatus = "pending" | "executing" | "success" | "error";

export interface ToolCall {
  name: string;
  args: string;
  status: ToolStatus;
  result?: string;
  elapsed?: string;
}

export interface UserMsg { id: string; type: "user"; text: string }
export interface AssistantMsg { id: string; type: "assistant"; model: string; text: string; stats?: string }
export interface ToolMsg { id: string; type: "tools"; tools: ToolCall[] }
export interface SystemMsg { id: string; type: "system"; text: string }
export interface DiffMsg { id: string; type: "diff"; summary: string; lines: string[] }

export type HistoryItem = UserMsg | AssistantMsg | ToolMsg | SystemMsg | DiffMsg;
