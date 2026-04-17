import { Region } from "./Region.js";

export interface TUIMessage {
  role: "operator" | "model" | "tool" | "system" | "diff";
  text: string;
  toolName?: string;
  toolAction?: string;
  stats?: string;
  streaming?: boolean;
}

export class ContentRegion extends Region {
  messages: TUIMessage[] = [];
  thinking = false;
  thinkingLabel = "thinking...";

  addOperator(text: string): void { this.messages.push({ role: "operator", text }); this.emit(); }
  addModel(text: string, stats = "", streaming = false): void { this.messages.push({ role: "model", text, stats, streaming }); this.emit(); }
  addTool(toolName: string, detail = "", action = ""): void { this.messages.push({ role: "tool", text: detail, toolName, toolAction: action }); this.emit(); }
  addSystem(text: string): void { this.messages.push({ role: "system", text }); this.emit(); }
  addDiff(summary: string, diffLines: string): void { this.messages.push({ role: "diff", text: diffLines, toolName: summary }); this.emit(); }

  updateLastModel(text: string, stats = "", streaming = true): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "model") { last.text = text; last.stats = stats; last.streaming = streaming; this.emit(); }
  }

  setThinking(on: boolean, label?: string): void {
    this.thinking = on;
    if (label) this.thinkingLabel = label;
    this.emit();
  }

  clear(): void { this.messages = []; this.emit(); }
}
