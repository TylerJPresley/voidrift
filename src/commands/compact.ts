import { SlashCommand, type ChatContext } from "./base.js";

export class CompactCommand extends SlashCommand {
  readonly name = "compact";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    if (this.ctx.agent.messages.length <= 2) { this.ctx.content.addSystem("Nothing to compact."); return 0; }
    this.ctx.input.setBusy(true);
    this.ctx.content.addSystem("Compacting context...");
    try {
      const { AgentLoop } = await import("../agent/loop.js");
      const compacted = await this.ctx.compactor.compact(this.ctx.agent.messages, async (msgs, maxTok) => {
        const oneShot = new AgentLoop({
          model: this.ctx.model, systemPrompt: msgs[0].content ?? "", tools: [], toolHandlers: {},
          stream: false, maxTokens: maxTok, logPath: this.ctx.logPath, showSpinner: false,
        });
        return oneShot.send(msgs[1].content ?? "");
      });
      this.ctx.agent.messages = compacted;
      this.ctx.session.appendCompaction(compacted[1]?.content ?? "");
      const wb = this.ctx.compactor.workBudget || (this.ctx.model.config.maxContext ?? 100000);
      const maxRestore = Math.floor(wb * 0.2 * 4);
      const restoration = this.ctx.compactor.buildRestoration(this.ctx.recentFiles, this.ctx.loadedSkills, maxRestore);
      if (restoration) this.ctx.agent.messages.push({ role: "system", content: restoration });
      this.ctx.content.addSystem(`Compacted to ${this.ctx.agent.messages.length} messages.`);
    } catch (e) { this.ctx.content.addSystem(`Compact failed: ${e}`); }
    finally { this.ctx.input.setBusy(false); }
    return 0;
  }
}
