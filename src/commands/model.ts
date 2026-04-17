import { SlashCommand, type ChatContext } from "./base.js";
import { listAliases, resolveModel } from "../models.js";
import { ConfigManager, CONFIG_SCHEMA } from "../config.js";
import { ModelPanel } from "../tui/panels/ModelPanel.js";

CONFIG_SCHEMA["current_model"] = { type: "string", description: "Currently selected model alias" };

export class ModelCommand extends SlashCommand {
  readonly name = "model";
  private ctx: ChatContext;
  private alias: string;

  constructor(ctx: ChatContext, alias: string) { super(); this.ctx = ctx; this.alias = alias.trim(); }

  async execute(): Promise<number> {
    const aliases = listAliases();
    const current = this.ctx.model.config.alias;

    if (!this.alias) {
      const panel = new ModelPanel(aliases, current, (alias) => this._switchTo(alias));
      this.ctx.footer.showPanel(panel);
      return 0;
    }

    return this._switchTo(this.alias);
  }

  private _switchTo(alias: string): number {
    const aliases = listAliases();
    if (!aliases.includes(alias)) {
      this.ctx.content.addSystem(`Unknown model '${alias}'. Available: ${aliases.join(", ")}`);
      return 1;
    }
    try {
      const newModel = resolveModel(alias);
      this.ctx.model = newModel;
      const agent = this.ctx.agent as unknown as Record<string, unknown>;
      agent._model = newModel;
      agent._adapter = newModel.adapter;
      agent._client = newModel.adapter.createClient(newModel.config);
      this.ctx.footer.setModel(alias);
      this.ctx.header.setModel(alias);
      new ConfigManager().set("current_model", alias);
      this.ctx.content.addSystem(`✓ Switched to ${alias}`);
    } catch (e) {
      this.ctx.content.addSystem(`Failed: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
    return 0;
  }
}
