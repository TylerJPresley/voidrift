/**
 * LangChain Tool Bindings.
 *
 * Converts VoidRift tool definitions into proper LangChain tool objects
 * with Zod schemas. LangChain handles provider-specific translation
 * (OpenAI, Anthropic, Google) automatically.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// We define dummy implementations — execution is handled by our own tool loop,
// not by LangChain's agent executor. These are only used for schema binding.
const noop = async () => "";

export const langchainTools = [
  tool(noop, {
    name: "read_file",
    description: "Read file content from the workspace. Returns up to 1000 lines by default. For small files (< 1000 lines), omit offset/limit to read the entire file. For large files, use offset/limit for targeted reads of specific sections. If the file is too large, the harness returns a guidance message with available sections. Always read a file before editing it.",
    schema: z.object({
      path: z.string().describe("Relative file path"),
      offset: z.number().optional().describe("Line offset to start reading from (0-indexed)"),
      limit: z.number().optional().describe("Maximum number of lines to read (capped at config max)"),
    }),
  }),
  tool(noop, {
    name: "glob_files",
    description: "Search for files by glob pattern. Use this instead of execute_command with 'find' or 'ls'. Prefer narrow patterns to reduce noise.",
    schema: z.object({
      pattern: z.string().describe("Glob pattern (e.g. '**/*.ts', 'src/**/*.test.*')"),
    }),
  }),
  tool(noop, {
    name: "write_file",
    description: "Create a new file or overwrite an existing one entirely. Prefer edit_file for modifying existing files. Never use placeholders like '// rest of code' — provide complete content.",
    schema: z.object({
      path: z.string().describe("Relative file path"),
      content: z.string().describe("Full file content to write"),
    }),
  }),
  tool(noop, {
    name: "edit_file",
    description: "Perform a surgical search-and-replace edit. The search string must be an exact match of existing content (including whitespace/indentation). If search is ambiguous (matches multiple locations), the edit will fail — provide more surrounding context to make it unique. You must read_file before editing.",
    schema: z.object({
      path: z.string().describe("Relative file path"),
      search: z.string().describe("Exact text block to find (must be unique in the file)"),
      replace: z.string().describe("Replacement text"),
    }),
  }),
  tool(noop, {
    name: "execute_command",
    description: "Run a shell command (build, test, lint, git). Use dedicated tools for file operations. Do not use cat/head/tail/sed/find when read_file/edit_file/glob_files exist. Commands timeout after 30s by default.",
    schema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe("Timeout in milliseconds (max 120000)"),
    }),
  }),
  tool(noop, {
    name: "web_search",
    description: "Search the web for documentation or library information",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  }),
  tool(noop, {
    name: "web_fetch",
    description: "Fetch a URL and convert HTML to markdown",
    schema: z.object({
      url: z.string().describe("URL to fetch"),
    }),
  }),
  tool(noop, {
    name: "lsp_definition",
    description: "Resolve definition location using Language Server",
    schema: z.object({
      path: z.string().describe("File path"),
      line: z.number().describe("Line number"),
      character: z.number().describe("Character position"),
    }),
  }),
  tool(noop, {
    name: "lsp_references",
    description: "Find all references to a symbol",
    schema: z.object({
      path: z.string().describe("File path"),
      line: z.number().describe("Line number"),
      character: z.number().describe("Character position"),
    }),
  }),
  tool(noop, {
    name: "lsp_hover",
    description: "Get type information and hover tips for a symbol",
    schema: z.object({
      path: z.string().describe("File path"),
      line: z.number().describe("Line number"),
      character: z.number().describe("Character position"),
    }),
  }),
  tool(noop, {
    name: "spawn_subagent",
    description: "Spawn a background subagent in an isolated Git worktree",
    schema: z.object({
      task: z.string().describe("Task description"),
      files: z.array(z.string()).describe("Target file paths"),
    }),
  }),
  tool(noop, {
    name: "connect_mcp_server",
    description: "Connect to a Model Context Protocol server",
    schema: z.object({
      name: z.string().describe("Server name"),
      command: z.string().describe("Command to spawn the server"),
    }),
  }),
  tool(noop, {
    name: "run_task_agent",
    description: "Delegate a task to a specialized background agent",
    schema: z.object({
      agentId: z.string().describe("ID of the task agent to run"),
      instruction: z.string().describe("Task instruction for the agent"),
    }),
  }),
  tool(noop, {
    name: "save_memory",
    description: "Save a fact, directive, or preference to long-term memory",
    schema: z.object({
      title: z.string().describe("Short title for the memory"),
      content: z.string().describe("The fact or preference to remember"),
      keywords: z.string().describe("Comma-separated keywords for retrieval"),
      scope: z.enum(["local", "global"]).optional().describe("Where to save: local (this project) or global (all projects)"),
    }),
  }),
  tool(noop, {
    name: "schedule",
    description: "Schedule a delayed or recurring task",
    schema: z.object({
      instruction: z.string().describe("Instruction to execute when the timer fires"),
      delay: z.string().optional().describe("One-shot delay (e.g. '30s', '5m', '1h')"),
      cron: z.string().optional().describe("Recurring cron pattern (e.g. '*/5 * * * *')"),
    }),
  }),
  tool(noop, {
    name: "read_plan",
    description: "Read the active plan. Returns all plan items grouped by priority (now/next/later). Use action='load' with a name to get the full body of a specific item.",
    schema: z.object({
      action: z.string().optional().describe("Optional: 'load' to read full body of a specific item"),
      name: z.string().optional().describe("Item name (without .md) when action=load"),
    }),
  }),
  tool(noop, {
    name: "write_plan",
    description: "Add, remove, or reprioritize plan items. Actions: add (create item), remove (delete item), prioritize (change priority).",
    schema: z.object({
      action: z.enum(["add", "remove", "prioritize"]).describe("Action to perform"),
      name: z.string().describe("Item name/id (no .md extension)"),
      description: z.string().optional().describe("Short description (for add)"),
      rationale: z.string().optional().describe("Why this item matters (for add)"),
      priority: z.enum(["now", "next", "later"]).optional().describe("Priority level"),
      body: z.string().optional().describe("Full detail markdown (for add)"),
    }),
  }),
  tool(noop, {
    name: "update_plan",
    description: "Edit the body of an existing plan item using search/replace.",
    schema: z.object({
      name: z.string().describe("Item name (without .md)"),
      search: z.string().describe("Exact text to find in the item body"),
      replace: z.string().describe("Replacement text"),
    }),
  }),
];

/** Get LangChain tool objects filtered by tool names from an agent manifest */
export function getLangchainTools(toolNames: string[]) {
  return langchainTools.filter(t => toolNames.includes(t.name));
}

/**
 * Get Anthropic-native tools that replace generic equivalents.
 * When provider is Anthropic, these are higher-accuracy purpose-built tools.
 * They replace: edit_file → textEditor, execute_command → bash.
 */
export async function getAnthropicNativeTools(toolNames: string[], workspaceRoot: string) {
  const { tools } = await import("@langchain/anthropic");
  const { readFile, editFile, writeFile, executeCommand } = await import("./executors.js");
  const { readFileSync, readdirSync } = await import("fs");
  const { join } = await import("path");

  const native: any[] = [];

  if (toolNames.includes("edit_file") || toolNames.includes("write_file") || toolNames.includes("read_file")) {
    native.push(tools.textEditor_20250728({
      execute: async (args) => {
        switch (args.command) {
          case "view": return readFile(workspaceRoot, args.path, 0, 1000).output || "";
          case "str_replace": return editFile(workspaceRoot, args.path, args.old_str!, args.new_str ?? "").output;
          case "create": return writeFile(workspaceRoot, args.path, args.file_text ?? "").output;
          case "insert": {
            const content = readFileSync(join(workspaceRoot, args.path), "utf-8");
            const lines = content.split("\n");
            lines.splice(args.insert_line ?? lines.length, 0, args.new_str ?? "");
            return writeFile(workspaceRoot, args.path, lines.join("\n")).output;
          }
          default: return `Unknown command: ${args.command}`;
        }
      },
    }));
  }

  if (toolNames.includes("execute_command")) {
    native.push(tools.bash_20250124({
      execute: async (args) => {
        if ("restart" in args) return "Bash session restarted.";
        return executeCommand(workspaceRoot, args.command, 30000).output;
      },
    }));
  }

  // Return native tools + remaining generic tools (excluding the ones replaced)
  const replaced = native.length > 0 ? ["edit_file", "write_file", "read_file", "execute_command"] : [];
  const generic = langchainTools.filter(t => toolNames.includes(t.name) && !replaced.includes(t.name));
  return [...native, ...generic];
}
