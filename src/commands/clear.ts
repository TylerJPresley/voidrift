import { SlashCommand, type ChatContext } from "./base.js";

export class ClearCommand extends SlashCommand {
  readonly name = "clear";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    this.ctx.session.clear();
    this.ctx.agent.messages = [this.ctx.agent.messages[0]];
    this.ctx.content.clear();
    this.ctx.content.addSystem("Session cleared.");
    return 0;
  }
}
