import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";
import { VERSION } from "../../version.js";

export function HelpPanel({ core, sessionId, workspace, onClose }: { core: CoreAPI; sessionId: string; workspace: string; onClose: () => void }) {
  const schema: PanelSchema = {
    id: "help",
    title: "Help",
    pages: ["general", "commands", "shortcuts", "context"],
    layout: {
      type: "text",
      getContent: (page) => {
        switch (page) {
          case "general":
            return [
              "VoidRift — Local-first, model-agnostic AI harness",
              "Connects to any model. Gives you complete control over what it can do.",
              "",
              `Version:      ${VERSION}`,
              `Workspace:    ${workspace}`,
              `Session:      ${sessionId}`,
              `Author:       Tyler J Presley`,
              `Repository:   https://github.com/TylerJPresley/voidrift`,
              `npm:          https://www.npmjs.com/package/voidrift`,
              "",
              "Type / to see available commands",
              "Shift+Tab to cycle agents (Chat → Plan → Vibe)",
            ].join("\n");

          case "commands": {
            const hooks = core.session.listCommands();
            const coreHooks = hooks.filter(c => !c.source || c.source === "core");
            const plugins = new Map<string, typeof hooks>();
            hooks.filter(c => c.source && c.source !== "core").forEach(c => {
              const group = plugins.get(c.source!) || [];
              group.push(c);
              plugins.set(c.source!, group);
            });
            const lines = ["Core"];
            for (const c of coreHooks) lines.push(`  /${c.name.padEnd(14)} ${c.description}`);
            for (const [source, cmds] of plugins) {
              lines.push("", `Plugin: ${source}`);
              for (const c of cmds) lines.push(`  /${c.name.padEnd(14)} ${c.description}`);
            }
            return lines.join("\n");
          }

          case "shortcuts":
            return [
              "Input",
              `  ${"TAB".padEnd(16)}Autocomplete command/path`,
              `  ${"SHIFT+TAB".padEnd(16)}Cycle mode (plan → chat → vibe)`,
              `  ${"Enter".padEnd(16)}Submit input`,
              "",
              "Session",
              `  ${"ESC".padEnd(16)}Cancel generation / close panel`,
              `  ${"Ctrl+C ×2".padEnd(16)}Exit VoidRift`,
            ].join("\n");

          case "context":
            return [
              "Context is assembled in four layers ordered by ascending volatility.",
              "Stable layers are cached by the provider. Volatile layers are discarded.",
              "",
              "Agent — Locked to the active agent. Rebuilds when you switch agents.",
              "  • Persona: instructions that define the agent's personality and behavior",
              "  • Tool Schemas: descriptions of every action the agent can perform",
              "  • Bound Skills: technical guidelines permanently attached to this agent",
              "  • Skill Discovery Index: lightweight directory of all available skills",
              "  • Memory Index: lightweight directory of all saved lessons",
              "",
              "Orbit — Stable project landscape. Changes rarely (~5% of turns).",
              "  • Plan: the step-by-step roadmap the agent is following",
              "  • Active Skills: guidelines loaded because current work triggered them",
              "  • Active Memory: full lessons pulled into working memory",
              "",
              "Drift — Active working set. Changes on tool use (~30-40% of turns).",
              "  • File Map: structural overview of every file in the workspace",
              "  • Active Files: detailed summaries of files currently being worked on",
              "  • Workspace Changes: files modified, added, or deleted since last save",
              "",
              "Void — Transient conversation. Changes every turn.",
              "  • Messages: the back-and-forth conversation",
              "  • Diagnostics: errors or warnings from the last build/test/lint",
            ].join("\n");

          default:
            return "";
        }
      },
    },
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
