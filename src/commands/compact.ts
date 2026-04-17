/**
 * /compact — summarize conversation history to free context (REQ-U-7).
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";

export class CompactCommand extends SlashCommand {
  readonly name = "compact";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    if (this.ctx.agent.messages.length <= 2) { addSystem(this.ctx.state, "Nothing to compact."); return 0; }
    this.ctx.state.busy = true;
    addSystem(this.ctx.state, "Compacting context...");
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
      const maxRestore = Math.floor((this.ctx.model.config.maxContext ?? 100000) * 0.2 * 4);
      const restoration = this.ctx.compactor.buildRestoration(this.ctx.recentFiles, [], maxRestore);
      if (restoration) this.ctx.agent.messages.push({ role: "system", content: restoration });
      addSystem(this.ctx.state, `Compacted to ${this.ctx.agent.messages.length} messages.`);
    } catch (e) { addSystem(this.ctx.state, `Compact failed: ${e}`); }
    finally { this.ctx.state.busy = false; this.ctx.state._notify?.(); }
    return 0;
  }
}
