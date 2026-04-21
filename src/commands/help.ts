import { SlashCommand, type ChatContext } from "./base.js";

export class HelpCommand extends SlashCommand {
  readonly name = "help";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    this.ctx.content.addSystem([
      "Mode switches:",
      "  /chat           interactive assistant (default)",
      "  /gather         requirements-focused conversation",
      "  /plan           architecture & planning conversation",
      "  /idea           guided idea refinement",
      "  /bare           raw model access (no governance)",
      "",
      "Pipelines:",
      "  /exec gather --import <path>  reverse-engineer requirements",
      "  /exec gather --idea <id>      requirements from idea",
      "  /exec plan [overwrite]        generate architecture + tasks",
      "  /exec develop                 execute tasks from manifest",
      "  /exec verify                  run acceptance tests",
      "  /exec deploy                  prepare release",
      "",
      "Session:",
      "  /compact        summarize context to free space",
      "  /ask <q>        one-shot answer (no context)",
      "  /clear          reset conversation",
      "  /settings       view/modify config",
      "  /model [alias]  switch model",
      "  /help           this list",
    ].join("\n"));
    return 0;
  }
}
