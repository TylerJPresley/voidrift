/**
 * /clear — reset conversation session.
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";

export class ClearCommand extends SlashCommand {
  readonly name = "clear";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    this.ctx.session.clear();
    this.ctx.agent.messages = [this.ctx.agent.messages[0]];
    this.ctx.state.messages = [];
    addSystem(this.ctx.state, "Session cleared.");
    return 0;
  }
}
