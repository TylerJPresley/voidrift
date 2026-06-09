import type { ToolSchema } from "./types.js";

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "read_file",
    description: "Reads raw file text from the workspace. Supports offset and limit for incremental reading of large files.",
    actionLayer: "file-ops",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "path", type: "string", description: "Relative file path", required: true },
      { name: "offset", type: "number", description: "Line offset to start reading from (0-indexed)", required: false },
      { name: "limit", type: "number", description: "Maximum number of lines to read (default 1000)", required: false },
    ],
  },
  {
    name: "glob_files",
    description: "Scans the workspace directory using glob patterns",
    actionLayer: "file-ops",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "pattern", type: "string", description: "Glob pattern", required: true },
    ],
  },
  {
    name: "write_file",
    description: "Creates a new file or overwrites an empty target",
    actionLayer: "file-ops",
    safetyProfile: "gated",
    parameters: [
      { name: "path", type: "string", description: "Relative file path", required: true },
      { name: "content", type: "string", description: "Full file content", required: true },
    ],
  },
  {
    name: "edit_file",
    description: "Performs surgical search-and-replace block edits",
    actionLayer: "file-ops",
    safetyProfile: "gated",
    parameters: [
      { name: "path", type: "string", description: "Relative file path", required: true },
      { name: "search", type: "string", description: "Exact text block to find", required: true },
      { name: "replace", type: "string", description: "Replacement text block", required: true },
    ],
  },
  {
    name: "execute_command",
    description: "Runs terminal commands (tests, compilers, linters)",
    actionLayer: "system-exec",
    safetyProfile: "gated",
    parameters: [
      { name: "command", type: "string", description: "Shell command to execute", required: true },
      { name: "timeout", type: "number", description: "Timeout in ms (default 30000)", required: false },
    ],
  },
  {
    name: "web_search",
    description: "Queries search engines for library documentation",
    actionLayer: "web",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "query", type: "string", description: "Search query", required: true },
    ],
  },
  {
    name: "web_fetch",
    description: "Fetches a URL, stripping HTML and assets to Markdown",
    actionLayer: "web",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "url", type: "string", description: "URL to fetch", required: true },
    ],
  },
  {
    name: "lsp_definition",
    description: "Resolves definition locations using Language Server",
    actionLayer: "lsp",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "file", type: "string", description: "File path", required: true },
      { name: "line", type: "number", description: "Line number", required: true },
      { name: "character", type: "number", description: "Column position", required: true },
    ],
  },
  {
    name: "lsp_references",
    description: "Locates symbol references/occurrences across project",
    actionLayer: "lsp",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "file", type: "string", description: "File path", required: true },
      { name: "line", type: "number", description: "Line number", required: true },
      { name: "character", type: "number", description: "Column position", required: true },
    ],
  },
  {
    name: "lsp_hover",
    description: "Retrieves type signatures and hover tips",
    actionLayer: "lsp",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "file", type: "string", description: "File path", required: true },
      { name: "line", type: "number", description: "Line number", required: true },
      { name: "character", type: "number", description: "Column position", required: true },
    ],
  },
  {
    name: "spawn_subagent",
    description: "Spawns background subagents in isolated worktrees",
    actionLayer: "orchestration",
    safetyProfile: "gated",
    parameters: [
      { name: "task", type: "string", description: "Task description", required: true },
      { name: "files", type: "string[]", description: "Target file paths", required: true },
    ],
  },
  {
    name: "connect_mcp_server",
    description: "Connects dynamically to local/remote MCP servers",
    actionLayer: "external",
    safetyProfile: "gated",
    parameters: [
      { name: "uri", type: "string", description: "MCP server URI", required: true },
    ],
  },
  {
    name: "run_task_agent",
    description: "Delegate a background, isolated engineering task to a specialized task agent",
    actionLayer: "orchestration",
    safetyProfile: "gated",
    parameters: [
      { name: "agentId", type: "string", description: "The ID of the task agent to run", required: true },
      { name: "instruction", type: "string", description: "Task-specific instruction for the agent", required: true },
      { name: "files", type: "string[]", description: "Target file paths for worktree isolation", required: false },
    ],
  },
  {
    name: "read_plan",
    description: "Read the active plan. Returns all plan items grouped by priority (now/next/later) with descriptions. Use action='load' with a name to get the full body of a specific item.",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "action", type: "string", description: "Optional: 'load' to read full body of a specific item", required: false },
      { name: "name", type: "string", description: "Item name (without .md) when action=load", required: false },
    ],
  },
  {
    name: "write_plan",
    description: "Add, remove, or reprioritize plan items. Actions: add (create item), remove (delete item), prioritize (change priority).",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "action", type: "string", description: "One of: add, remove, prioritize", required: true },
      { name: "name", type: "string", description: "Item name/id (no .md extension)", required: true },
      { name: "description", type: "string", description: "Short description (for add)", required: false },
      { name: "rationale", type: "string", description: "Why this item matters (for add)", required: false },
      { name: "priority", type: "string", description: "now, next, or later (for add/prioritize)", required: false },
      { name: "body", type: "string", description: "Full detail markdown (for add)", required: false },
    ],
  },
  {
    name: "update_plan",
    description: "Edit the body of an existing plan item using search/replace.",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "name", type: "string", description: "Item name (without .md)", required: true },
      { name: "search", type: "string", description: "Exact text to find in the item body", required: true },
      { name: "replace", type: "string", description: "Replacement text", required: true },
    ],
  },
  {
    name: "save_memory",
    description: "Save a fact, directive, or preference to long-term memory for future sessions",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "title", type: "string", description: "Short title for the memory", required: true },
      { name: "content", type: "string", description: "The fact, directive, or preference to remember", required: true },
      { name: "keywords", type: "string", description: "Comma-separated keywords for retrieval", required: true },
      { name: "scope", type: "string", description: "Where to save: 'local' (this project) or 'global' (all projects)", required: false },
    ],
  },
  {
    name: "schedule",
    description: "Schedule a delayed or recurring task. Use for async waits, periodic checks, or timed automation.",
    actionLayer: "orchestration",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "instruction", type: "string", description: "The instruction to execute when the timer fires", required: true },
      { name: "delay", type: "string", description: "One-shot delay (e.g. '30s', '5m', '1h'). Mutually exclusive with cron.", required: false },
      { name: "cron", type: "string", description: "Recurring cron pattern (e.g. '*/5 * * * *'). Mutually exclusive with delay.", required: false },
    ],
  },
];

export function getToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((t) => t.name === name);
}
