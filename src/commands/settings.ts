import { SlashCommand, type ChatContext } from "./base.js";
import { ConfigManager, CONFIG_SCHEMA } from "../config.js";

export class SettingsCommand extends SlashCommand {
  readonly name = "settings";
  private ctx: ChatContext;
  private args: string;

  constructor(ctx: ChatContext, args: string) { super(); this.ctx = ctx; this.args = args.trim(); }

  async execute(): Promise<number> {
    const cm = new ConfigManager();
    const parts = this.args.split(/\s+/);
    const action = parts[0] || "list";

    if (action === "list" || !this.args) {
      const entries = cm.list();
      const lines = ["Settings:", ""];
      for (const [key, val] of entries) {
        const schema = CONFIG_SCHEMA[key];
        const display = typeof val === "string" && val.includes("KEY") ? "***" : JSON.stringify(val);
        const desc = schema ? ` — ${schema.description}` : "";
        lines.push(`  ${key} = ${display}${desc}`);
      }
      lines.push("", "  /settings set <key> <value>  change a value");
      this.ctx.content.addSystem(lines.join("\n"));
      return 0;
    }

    if (action === "set") {
      const key = parts[1];
      const rawVal = parts.slice(2).join(" ");
      if (!key || !rawVal) { this.ctx.content.addSystem("Usage: /settings set <key> <value>"); return 1; }
      let val: unknown = rawVal;
      if (rawVal === "true") val = true;
      else if (rawVal === "false") val = false;
      else if (/^\d+$/.test(rawVal)) val = parseInt(rawVal, 10);
      else if (rawVal.startsWith("[")) { try { val = JSON.parse(rawVal); } catch { /* */ } }
      const err = cm.validate(key, val);
      if (err) { this.ctx.content.addSystem(`✗ ${err}`); return 1; }
      cm.set(key, val);
      this.ctx.content.addSystem(`✓ ${key} = ${JSON.stringify(val)}`);
      return 0;
    }

    this.ctx.content.addSystem("Usage: /settings [set <key> <value>]");
    return 1;
  }
}
