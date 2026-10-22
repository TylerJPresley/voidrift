/**
 * The CLI's own built-in panel declarations (cli-blueprint.md §7.2,
 * panels-blueprint §4) and its own `slash-commands` dataset.
 *
 * Panels ship WITH the product (handoff §0.1): the CLI owns this pure-data set
 * and registers it through the SAME `core.register.panel` seam a third-party
 * plugin uses (tui.tsx, right after `createCore`). Each entry is DATA typed as
 * the core's `PanelDeclaration` — a title, an optional description, columns
 * (defaulted by the host from the dataset's `fields` when omitted), the
 * registered DATASET slug(s) its rows come from (`source`, §12.7, never a
 * dotted op path), optional tab `pages`, an optional `detail`, and keyed hotkey
 * `actions` each naming one dotted CoreAPI operation (`op`). The declaration
 * carries no rows, no getter, and no handlers; the CLI binds the datasets to a
 * synchronous snapshot and the action ops to handlers in its private
 * `BoundPanel` view-model (`core-client.ts`, panels §5). Because the CLI reads
 * `registry.panels()` as its source of truth, a plugin that registers its own
 * declaration shows up as a slash-command panel with no CLI code change.
 */
import type { DatasetDeclaration, PanelDeclaration } from "@voidrift/core";
import { mergeCommands } from "../commands-catalog.js";

/**
 * The CLI's own `slash-commands` dataset (§7.2 deviation, pin 9): the core's
 * `commands` dataset holds only core/plugin-registered command NAMES, so the
 * CLI registers its OWN dataset of its built-in slash-command catalog WITH
 * descriptions. The Help panel sources `["slash-commands", "commands"]` so it
 * lists both, each with a description. This is a client-added dataset — flagged
 * as a deviation for review.
 */
export function slashCommandsDataset(listCommands: () => Promise<string[]>): DatasetDeclaration {
  return {
    description: "The CLI's built-in slash commands — name and description.",
    fields: [
      { key: "name", label: "Command" },
      { key: "description", label: "Description" },
    ],
    rows: async () => {
      // The CLI merges its own catalog with any plugin-registered command name
      // so a plugin command folds in beside the built-ins (§7.3). The core's
      // `commands` dataset still carries the plugin names verbatim; the Help
      // panel concatenates both sources, so this one owns descriptions.
      const pluginNames = await listCommands().catch(() => []);
      return mergeCommands(pluginNames).map((c) => ({ name: `/${c.name}`, description: c.description }));
    },
  };
}

/** The canonical built-in panel set the CLI registers at startup (§7.2). Every
 * `source` is a registered dataset slug (§12.7); `columns` default from the
 * dataset `fields` when omitted. */
export const BUILTIN_PANELS: Readonly<Record<string, PanelDeclaration>> = Object.freeze({
  sessions: {
    title: "Sessions",
    description: "Stored sessions — open one to see its details.",
    source: "sessions",
    columns: [
      { key: "name", label: "Name", width: 18 },
      { key: "id", label: "Id", width: 10 },
      { key: "lastActiveAt", label: "Active", width: 10, format: "relative-time" },
      { key: "summary", label: "Summary" },
    ],
    detail: { title: "Session" },
  },
  model: {
    title: "Models",
    description: "Configured model endpoints.",
    source: "models",
    columns: [
      { key: "name", label: "Name", width: 18 },
      { key: "model", label: "Model", width: 24 },
      { key: "protocol", label: "Protocol", width: 10 },
      { key: "active", label: "Active", width: 8 },
    ],
  },
  agent: {
    title: "Agents",
    description: "Registered agents.",
    source: "agents",
    columns: [
      { key: "name", label: "Name", width: 18 },
      { key: "description", label: "Description" },
    ],
  },
  tools: {
    title: "Tools",
    description: "The active agent's effective tools.",
    source: "tools",
    columns: [
      { key: "name", label: "Name", width: 24 },
      { key: "origin", label: "Origin", width: 9 },
      { key: "status", label: "Access", width: 12 },
      { key: "description", label: "Description" },
    ],
  },
  mcp: {
    title: "MCP",
    description: "MCP servers and their tools.",
    source: "mcp",
    columns: [
      { key: "name", label: "Server", width: 20 },
      { key: "status", label: "Status", width: 14 },
      { key: "toolCount", label: "Tools", width: 7, format: "count" },
      { key: "detail", label: "Detail" },
    ],
    // §7.2 — approve the selected server's pending/quarantined tools through the
    // gated `mcp.approve` CoreAPI op. Every row carries `server`, so either a
    // server or a tool selection approves the server.
    actions: {
      a: { label: "approve", op: "mcp.approve" },
    },
  },
  plugins: {
    title: "Plugins",
    description: "Loaded plugins.",
    source: "plugins",
    columns: [
      { key: "id", label: "Plugin", width: 24 },
      { key: "enabled", label: "Enabled", width: 10 },
      { key: "scope", label: "Scope", width: 12 },
    ],
  },
  permissions: {
    title: "Permissions",
    description: "The permission allow-list rules.",
    source: "permissions",
    columns: [
      { key: "pattern", label: "Pattern", width: 28 },
      { key: "decision", label: "Decision", width: 12 },
      { key: "scope", label: "Scope", width: 12 },
    ],
  },
  compliance: {
    title: "Compliance",
    description: "Warden status, policies, and recent decisions.",
    source: "compliance",
    // One list with the `_section` field as the first column — no pages (pin 8).
    columns: [
      { key: "_section", label: "Section", width: 12 },
      { key: "label", label: "Item", width: 28 },
      { key: "detail", label: "Detail" },
    ],
  },
  memory: {
    title: "Memory",
    description: "Durable memory and pending suggestions.",
    // The panel source is the Stored page's default; each page names its own.
    source: "memory",
    pages: [
      {
        key: "stored",
        label: "Stored",
        source: "memory",
        columns: [
          { key: "kind", label: "Kind", width: 12 },
          { key: "title", label: "Title", width: 28 },
          { key: "detail", label: "Detail" },
        ],
        actions: {
          d: { label: "delete", op: "memory.delete", confirm: "Delete this memory entry?" },
        },
      },
      {
        key: "suggestions",
        label: "Suggestions",
        source: "memory-suggestions",
        columns: [
          { key: "kind", label: "Kind", width: 12 },
          { key: "title", label: "Title", width: 28 },
          { key: "detail", label: "Detail" },
        ],
        actions: {
          a: { label: "approve", op: "memory.suggestions.approve" },
          r: { label: "reject", op: "memory.suggestions.reject" },
        },
      },
    ],
  },
  skills: {
    title: "Skills",
    description: "Loaded skills.",
    source: "skills",
    columns: [
      { key: "name", label: "Name", width: 24 },
      { key: "scope", label: "Scope", width: 10 },
      { key: "description", label: "Description" },
    ],
  },
  prompts: {
    title: "Prompts",
    description: "Registered prompts.",
    source: "prompts",
    columns: [
      { key: "key", label: "Key", width: 24 },
      { key: "label", label: "Label" },
    ],
  },
  stats: {
    title: "Stats",
    description: "The live session's token, turn, tool and time stats.",
    source: "stats",
    columns: [
      { key: "label", label: "Metric", width: 24 },
      { key: "value", label: "Value" },
    ],
  },
  context: {
    title: "Context",
    description: "The live session's context-window breakdown.",
    source: "context",
    columns: [
      { key: "label", label: "Segment", width: 24 },
      { key: "value", label: "Value" },
    ],
  },
  diff: {
    title: "Diff",
    source: "diff",
    columns: [{ key: "line", label: "Working-tree diff" }],
  },
  help: {
    title: "Help",
    description: "The command list.",
    // §7.2 deviation (pin 9): the CLI's own `slash-commands` dataset (its
    // catalog with descriptions) plus the core's `commands` dataset (plugin
    // names). The host concatenates both, each row tagged with its `_source`.
    source: ["slash-commands", "commands"],
    columns: [
      { key: "name", label: "Command", width: 18 },
      { key: "description", label: "Description" },
    ],
  },
});

/** Register the CLI's built-in declarations through the core seam (§7.2). The
 * core validates each against its `PanelDeclaration` schema and stores it under
 * the reserved `panels.{name}` key the CLI then reads via `registry.panels()`. */
export function registerBuiltinPanels(register: (name: string, def: PanelDeclaration) => unknown): void {
  for (const [name, declaration] of Object.entries(BUILTIN_PANELS)) {
    register(name, declaration);
  }
}
