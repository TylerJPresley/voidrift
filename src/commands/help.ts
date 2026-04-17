/**
 * /help — display available commands.
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";

export class HelpCommand extends SlashCommand {
  readonly name = "help";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    addSystem(this.ctx.state, "Commands:");
    addSystem(this.ctx.state, "  /gather [path]  reverse-engineer requirements");
    addSystem(this.ctx.state, "  /plan           generate architecture + tasks");
    addSystem(this.ctx.state, "  /develop        execute tasks from manifest");
    addSystem(this.ctx.state, "  /deploy         prepare release (version, tag)");
    addSystem(this.ctx.state, "  /verify         run acceptance tests");
    addSystem(this.ctx.state, "  /idea           guided idea refinement");
    addSystem(this.ctx.state, "  /compact        summarize context to free space");
    addSystem(this.ctx.state, "  /ask <q>        one-shot answer (no context)");
    addSystem(this.ctx.state, "  /clear          reset conversation");
    addSystem(this.ctx.state, "  /help           this list");
    addSystem(this.ctx.state, "  /quit           exit");
    return 0;
  }
}
