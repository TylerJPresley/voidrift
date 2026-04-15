/**
 * TUI state: observable state for the Ink TUI.
 */

export interface TUIMessage {
  role: "operator" | "model" | "tool" | "system" | "diff";
  text: string;
  toolName?: string;
  toolAction?: string;
  stats?: string;
  streaming?: boolean;
}

export interface TUIState {
  messages: TUIMessage[];
  modelName: string;
  contextPct: number;
  mode: string;           // empty = default, "/gather" etc during commands
  cwd: string;
  branch: string;
  thinking: boolean;
  thinkingLabel: string;
  busy: boolean;
  pendingMessage: string | null;
  inputHistory: string[];
}

export function createState(modelName: string, cwd: string, branch: string): TUIState {
  return {
    messages: [],
    modelName,
    contextPct: 0,
    mode: "",
    cwd,
    branch,
    thinking: false,
    thinkingLabel: "thinking...",
    busy: false,
    pendingMessage: null,
    inputHistory: [],
  };
}

export function addOperator(state: TUIState, text: string): void {
  state.messages.push({ role: "operator", text });
}

export function addModel(state: TUIState, text: string, stats = "", streaming = false): void {
  state.messages.push({ role: "model", text, stats, streaming });
}

export function addTool(state: TUIState, toolName: string, detail = "", action = ""): void {
  state.messages.push({ role: "tool", text: detail, toolName, toolAction: action });
}

export function addSystem(state: TUIState, text: string): void {
  state.messages.push({ role: "system", text });
}

export function addDiff(state: TUIState, summary: string, diffLines: string): void {
  state.messages.push({ role: "diff", text: diffLines, toolName: summary });
}

export function updateLastModel(state: TUIState, text: string, stats = "", streaming = true): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "model") {
    last.text = text;
    last.stats = stats;
    last.streaming = streaming;
  }
}
