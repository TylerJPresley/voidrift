import { SlashCommand, type ChatContext } from "./base.js";

export class HelpCommand extends SlashCommand {
  readonly name = "help";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    this.ctx.content.addSystem([
      "Commands:",
      "  /gather [path]  reverse-engineer requirements",
      "  /plan           generate architecture + tasks",
      "  /develop        execute tasks from manifest",
      "  /deploy         prepare release (version, tag)",
      "  /verify         run acceptance tests",
      "  /idea           guided idea refinement",
      "  /compact        summarize context to free space",
      "  /ask <q>        one-shot answer (no context)",
      "  /clear          reset conversation",
      "  /settings       view/modify config",
      "  /model [alias]  switch model",
      "  /help           this list",
      "  /quit           exit",
    ].join("\n"));
    return 0;
  }
}
