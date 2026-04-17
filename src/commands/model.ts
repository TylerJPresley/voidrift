/**
 * /model — select active model from configured models.
 *
 * Usage:
 *   /model           — list available models, show current
 *   /model <alias>   — switch to a different model
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";
import { listAliases, resolveModel } from "../models.js";
import { ConfigManager, CONFIG_SCHEMA } from "../config.js";

// Register current_model in schema
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

    if (!this.alias) {
      const current = this.ctx.model.config.alias;
      const lines = [`Models (current: ${current})`, ""];
      for (const a of aliases) {
        const marker = a === current ? " ◀" : "";
        lines.push(`  ${a}${marker}`);
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
      // Update the live model reference
      this.ctx.model = newModel;
      // Recreate the agent's adapter/client for the new model
      (this.ctx.agent as unknown as Record<string, unknown>)._model = newModel;
      (this.ctx.agent as unknown as Record<string, unknown>)._adapter = newModel.adapter;
      (this.ctx.agent as unknown as Record<string, unknown>)._client = newModel.adapter.createClient(newModel.config);
      // Update TUI
      this.ctx.state.modelName = this.alias;
      this.ctx.state._notify?.();
      // Save to config
      const cm = new ConfigManager();
      cm.set("current_model", this.alias);
      addSystem(this.ctx.state, `✓ Switched to ${this.alias}`);
    } catch (e) {
      addSystem(this.ctx.state, `Failed to switch: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
    return 0;
  }
}
