/**
 * /model — select active model via collapsible panel.
 *
 * /model         — open model selection panel
 * /model <alias> — switch directly
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem, openPanel, type PanelItem } from "../tui/state.js";
import { listAliases, resolveModel } from "../models.js";
import { ConfigManager } from "../config.js";

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

    // Direct switch if alias provided
    if (this.alias) return this._switchTo(this.alias, aliases);

    // Open panel for selection
    const items: PanelItem[] = aliases.map(a => ({
      label: a,
      value: a,
      marker: a === current ? "◀" : undefined,
    }));
    const currentIdx = aliases.indexOf(current);

    openPanel(this.ctx.state, {
      type: "model",
      title: "Model",
      items,
      selectedIndex: currentIdx >= 0 ? currentIdx : 0,
      hint: "↑↓ navigate · enter select · esc cancel",
      onSelect: (item) => this._switchTo(item.value, aliases),
      onCancel: () => {},
    });
    return 0;
  }

  private _switchTo(alias: string, aliases: string[]): number {
    if (!aliases.includes(alias)) {
      addSystem(this.ctx.state, `Unknown model '${alias}'. Available: ${aliases.join(", ")}`);
      return 1;
    }
    try {
      const newModel = resolveModel(alias);
      this.ctx.model = newModel;
      (this.ctx.agent as unknown as Record<string, unknown>)._model = newModel;
      (this.ctx.agent as unknown as Record<string, unknown>)._adapter = newModel.adapter;
      (this.ctx.agent as unknown as Record<string, unknown>)._client = newModel.adapter.createClient(newModel.config);
      this.ctx.state.modelName = alias;
      this.ctx.state._notify?.();
      new ConfigManager().set("current_model", alias);
      addSystem(this.ctx.state, `✓ Switched to ${alias}`);
    } catch (e) {
      addSystem(this.ctx.state, `Failed: ${e instanceof Error ? e.message : e}`);
      return 1;
    }
    return 0;
  }
}
