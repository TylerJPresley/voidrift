import { Region } from "./Region.js";
import { randomLabel } from "../Thinking.js";

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
  onContentAdded?: () => void;

  addOperator(text: string): void { this.messages.push({ role: "operator", text }); this.onContentAdded?.(); this.emit(); }
  addModel(text: string, stats = "", streaming = false): void { this.messages.push({ role: "model", text, stats, streaming }); this.onContentAdded?.(); this.emit(); }
  addTool(toolName: string, detail = "", action = ""): void { this.messages.push({ role: "tool", text: detail, toolName, toolAction: action }); this.onContentAdded?.(); this.emit(); }
  addSystem(text: string): void { this.messages.push({ role: "system", text }); this.onContentAdded?.(); this.emit(); }
  appendSystem(text: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "system") { last.text += "\n" + text; this.emit(); }
    else this.addSystem(text);
  }
  addDiff(summary: string, diffLines: string): void { this.messages.push({ role: "diff", text: diffLines, toolName: summary }); this.onContentAdded?.(); this.emit(); }

  updateLastModel(text: string, stats = "", streaming = true): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "model") { last.text = text; last.stats = stats; last.streaming = streaming; this.emit(); }
  }

  setThinking(on: boolean, label?: string): void {
    this.thinking = on;
    this.thinkingLabel = on ? (label ?? randomLabel()) : "thinking...";
    this.emit();
  }

  clear(): void { this.messages = []; this.emit(); }
}
