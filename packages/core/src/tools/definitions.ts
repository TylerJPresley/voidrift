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
      { name: "limit", type: "number", description: "Maximum number of lines to read (default 200)", required: false },
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
    description: "Read the current active plan from the workspace",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [],
  },
  {
    name: "write_plan",
    description: "Write or overwrite the active plan",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "content", type: "string", description: "The full plan content (markdown)", required: true },
    ],
  },
  {
    name: "update_plan",
    description: "Update a specific section of the active plan",
    actionLayer: "partition",
    safetyProfile: "auto-approved",
    parameters: [
      { name: "search", type: "string", description: "Exact text to find in the current plan", required: true },
      { name: "replace", type: "string", description: "Replacement text", required: true },
    ],
  },
];

export function getToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((t) => t.name === name);
}
