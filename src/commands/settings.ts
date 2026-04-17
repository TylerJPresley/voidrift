/**
 * /settings — view and modify config from within chat.
 *
 * Usage:
 *   /settings                 — list all settings
 *   /settings get <key>       — show a specific value
 *   /settings set <key> <val> — change a value
 *   /settings delete <key>    — remove a value
 */

import { SlashCommand, type ChatContext } from "./base.js";
import { addSystem } from "../tui/state.js";
import { ConfigManager } from "../config.js";

export class SettingsCommand extends SlashCommand {
  readonly name = "settings";
  private ctx: ChatContext;
  private args: string;

  constructor(ctx: ChatContext, args: string) {
    super();
    this.ctx = ctx;
    this.args = args.trim();
  }

  async execute(): Promise<number> {
    const cm = new ConfigManager();
    const parts = this.args.split(/\s+/);
    const action = parts[0] || "list";

    if (action === "list" || !this.args) {
      const entries = cm.list();
      if (!entries.length) { addSystem(this.ctx.state, "No settings configured."); return 0; }
      const lines = ["Settings:", ""];
      for (const [key, val] of entries) {
        const display = typeof val === "string" && val.includes("KEY") ? "***" : JSON.stringify(val);
        lines.push(`  ${key} = ${display}`);
      }
      lines.push("", "  /settings get <key>          read a value");
      lines.push("  /settings set <key> <value>  change a value");
      lines.push("  /settings delete <key>       remove a value");
      addSystem(this.ctx.state, lines.join("\n"));
      return 0;
    }

    if (action === "get") {
      const key = parts[1];
      if (!key) { addSystem(this.ctx.state, "Usage: /settings get <key>"); return 1; }
      const val = cm.get(key);
      if (val === undefined) { addSystem(this.ctx.state, `${key} is not set.`); return 0; }
      addSystem(this.ctx.state, `${key} = ${JSON.stringify(val)}`);
      return 0;
    }

    if (action === "set") {
      const key = parts[1];
      const rawVal = parts.slice(2).join(" ");
      if (!key || !rawVal) { addSystem(this.ctx.state, "Usage: /settings set <key> <value>"); return 1; }
      // Parse value: try number, boolean, then string
      let val: unknown = rawVal;
      if (rawVal === "true") val = true;
      else if (rawVal === "false") val = false;
      else if (/^\d+$/.test(rawVal)) val = parseInt(rawVal, 10);
      else if (rawVal.startsWith("[")) { try { val = JSON.parse(rawVal); } catch { /* keep as string */ } }
      cm.set(key, val);
      addSystem(this.ctx.state, `✓ ${key} = ${JSON.stringify(val)}`);
      return 0;
    }

    if (action === "delete") {
      const key = parts[1];
      if (!key) { addSystem(this.ctx.state, "Usage: /settings delete <key>"); return 1; }
      cm.delete(key);
      addSystem(this.ctx.state, `✓ ${key} deleted.`);
      return 0;
    }

    addSystem(this.ctx.state, "Usage: /settings [list|get|set|delete] [key] [value]");
    return 1;
  }
}
