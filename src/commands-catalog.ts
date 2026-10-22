/**
 * The CLI's built-in slash-command catalog (cli-blueprint.md §7.3).
 *
 * The §7.3 commands are dispatched by the CLI itself (commands.ts) and are not
 * registered in the core's command map, so `session.listCommands()` — which
 * returns only core/plugin-registered commands — never surfaces them. This
 * module is the CLI-owned, pure-data source of those built-ins with their
 * descriptions. The help panel (§7.2) and the autocomplete index (§3.3) merge
 * this catalog with `session.listCommands()` so `/help` and completion show both
 * the CLI's own commands and any plugin command, each with a description.
 */

/** One built-in slash command: its name (no leading `/`) and a one-line description. */
export interface CommandInfo {
  name: string;
  description: string;
}

/** The canonical built-in slash commands (§7.3), ordered by workflow. */
export const BUILTIN_COMMANDS: readonly CommandInfo[] = Object.freeze([
  { name: "help", description: "Show the command list" },
  { name: "sessions", description: "Open the sessions view" },
  { name: "resume", description: "Resume a session by id, or open the sessions view" },
  { name: "new", description: "Start a fresh session" },
  { name: "clear", description: "Start a fresh session, clearing the view" },
  { name: "model", description: "Switch the model, or open the models panel" },
  { name: "agent", description: "Switch the active top-level agent, or open the agents panel" },
  { name: "mcp", description: "Open the MCP panel, or connect/disconnect a server" },
  { name: "tools", description: "Open the tools panel" },
  { name: "plugins", description: "Open the plugins panel" },
  { name: "permissions", description: "Open the permissions panel" },
  { name: "access", description: "Print the effective permissions for the current mode" },
  { name: "compliance", description: "Open the compliance panel" },
  { name: "memory", description: "Open the memory panel" },
  { name: "skills", description: "Open the skills panel" },
  { name: "prompts", description: "Open the prompts panel" },
  { name: "stats", description: "Open the stats panel" },
  { name: "export", description: "Export the current (or a named) session as a sanitized Markdown or JSON document; secrets, paths and unsafe characters are masked" },
  { name: "context", description: "Open the context panel" },
  { name: "diff", description: "Render the working-tree diff" },
  { name: "config", description: "Show the effective config and layers, or open the project config in the editor" },
  { name: "undo", description: "Step back one move — conversation and files" },
  { name: "redo", description: "Step forward one move — conversation and files" },
  { name: "goto", description: "Jump to move <id> (0 = session start), or list the move timeline" },
  { name: "compact", description: "Compact the context now" },
  { name: "plan", description: "View/author the plan: create, add-step, activate, advance, verify, show, abandon; bare /plan opens the panel" },
  { name: "routine", description: "Run a saved routine, or save <id> <prompt> / run <id>" },
  { name: "editor", description: "Compose input in the external editor" },
  { name: "cancel", description: "Cancel the active turn" },
  { name: "quit", description: "Shut down and leave" },
  { name: "exit", description: "Shut down and leave" },
]);

const BUILTIN_BY_NAME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(BUILTIN_COMMANDS.map((c) => [c.name, c.description])),
);

/**
 * Merge the built-in catalog with the plugin command names from
 * `session.listCommands()` into one sorted, de-duplicated `CommandInfo` list
 * (§3.3, §7.2). A plugin command with no known description shows an empty one;
 * a plugin that overrides a built-in name keeps the built-in description.
 */
export function mergeCommands(pluginNames: readonly string[]): CommandInfo[] {
  const names = new Set<string>([...BUILTIN_COMMANDS.map((c) => c.name), ...pluginNames]);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, description: BUILTIN_BY_NAME[name] ?? "" }));
}
