/**
 * /model — select active model.
 *
 * /model         — show model list
 * /model <alias> — switch directly
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";
import { listAliases, resolveModel } from "../models.js";
import { ConfigManager, CONFIG_SCHEMA } from "../config.js";

CONFIG_SCHEMA["current_model"] = { type: "string", description: "Currently selected model alias" };

export class ModelCommand extends SlashCommand {
  readonly name = "model";
  private ctx: ChatContext;
  private alias: string;

  constructor(ctx: ChatContext, alias: string) {
    super();
    this.ctx = ctx;
    this.alias = alias.trim();
  }

  async execute(): Promise<number> {
    const aliases = listAliases();
    const current = this.ctx.model.config.alias;

    if (!this.alias) {
      const lines = [`Models (current: ${current})`, ""];
      for (const a of aliases) {
        lines.push(a === current ? `  ${a}  ◀` : `  ${a}`);
      }
      lines.push("", "  /model <alias>  switch model");
      addSystem(this.ctx.state, lines.join("\n"));
      return 0;
    }

    if (!aliases.includes(this.alias)) {
      addSystem(this.ctx.state, `Unknown model '${this.alias}'. Available: ${aliases.join(", ")}`);
      return 1;
    }

    try {
      const newModel = resolveModel(this.alias);
      this.ctx.model = newModel;
      const agent = this.ctx.agent as unknown as Record<string, unknown>;
      agent._model = newModel;
      agent._adapter = newModel.adapter;
      agent._client = newModel.adapter.createClient(newModel.config);
      this.ctx.state.modelName = this.alias;
      this.ctx.state._notify?.();
      new ConfigManager().set("current_model", this.alias);
      addSystem(this.ctx.state, `✓ Switched to ${this.alias}`);
    } catch (e) {
      addSystem(this.ctx.state, `Failed: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
    return 0;
  }
}
