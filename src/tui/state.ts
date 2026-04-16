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
  _version: number;
  _notify?: () => void;
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
    _version: 0,
  };
}

function notify(state: TUIState): void {
  state._version++;
  state._notify?.();
}

export function addOperator(state: TUIState, text: string): void {
  state.messages.push({ role: "operator", text });
  notify(state);
}

export function addModel(state: TUIState, text: string, stats = "", streaming = false): void {
  state.messages.push({ role: "model", text, stats, streaming });
  notify(state);
}

export function addTool(state: TUIState, toolName: string, detail = "", action = ""): void {
  state.messages.push({ role: "tool", text: detail, toolName, toolAction: action });
  notify(state);
}

export function addSystem(state: TUIState, text: string): void {
  state.messages.push({ role: "system", text });
  notify(state);
}

export function addDiff(state: TUIState, summary: string, diffLines: string): void {
  state.messages.push({ role: "diff", text: diffLines, toolName: summary });
  notify(state);
}

export function updateLastModel(state: TUIState, text: string, stats = "", streaming = true): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "model") {
    last.text = text;
    last.stats = stats;
    last.streaming = streaming;
    notify(state);
  }
}
