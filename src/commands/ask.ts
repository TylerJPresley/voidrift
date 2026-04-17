/**
 * /ask — one-shot question without affecting session context (REQ-U-15).
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem, addModel, updateLastModel } from "../tui/state.js";

export class AskCommand extends SlashCommand {
  readonly name = "ask";
  private ctx: ChatContext;
  private question: string;
  constructor(ctx: ChatContext, question: string) { super(); this.ctx = ctx; this.question = question; }

  async execute(): Promise<number> {
    if (!this.question) { addSystem(this.ctx.state, "Usage: /ask <question>"); return 1; }
    addModel(this.ctx.state, "", "", true);
    this.ctx.state.busy = true;
    try {
      const { AgentLoop } = await import("../agent/loop.js");
      const { getMaxTokens } = await import("../config.js");
      const oneShot = new AgentLoop({
        model: this.ctx.model, systemPrompt: "Answer concisely.", tools: [], toolHandlers: {},
        stream: false, maxTokens: getMaxTokens(this.ctx.model.config, "chat.quick"),
        logPath: this.ctx.logPath, showSpinner: false,
      });
      const answer = await oneShot.send(this.question);
      updateLastModel(this.ctx.state, answer, "", false);
    } catch (e) { addSystem(this.ctx.state, `Ask failed: ${e}`); }
    finally { this.ctx.state.busy = false; }
    return 0;
  }
}
