import { SlashCommand, type ChatContext } from "./base.js";
import { loadPrompt } from "../prompts.js";

export class AskCommand extends SlashCommand {
  readonly name = "ask";
  private ctx: ChatContext;
  private question: string;
  constructor(ctx: ChatContext, question: string) { super(); this.ctx = ctx; this.question = question; }

  async execute(): Promise<number> {
    if (!this.question) { this.ctx.content.addSystem("Usage: /ask <question>"); return 1; }
    this.ctx.content.addModel("", "", true);
    this.ctx.input.setBusy(true);
    try {
      const { AgentLoop } = await import("../agent/loop.js");
      const { getMaxTokens } = await import("../config.js");
      const oneShot = new AgentLoop({
        model: this.ctx.model, systemPrompt: loadPrompt("chat", "ASK"), tools: [], toolHandlers: {},
        stream: false, maxTokens: getMaxTokens(this.ctx.model.config, "chat.quick"),
        logPath: this.ctx.logPath, showSpinner: false,
      });
      const answer = await oneShot.send(this.question);
      this.ctx.content.updateLastModel(answer, "", false);
    } catch (e) { this.ctx.content.addSystem(`Ask failed: ${e}`); }
    finally { this.ctx.input.setBusy(false); }
    return 0;
  }
}
