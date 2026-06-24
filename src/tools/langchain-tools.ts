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
    description: "Search for files by glob pattern. Returns matching file paths. Prefer narrow patterns to reduce noise.",
    schema: z.object({
      pattern: z.string().describe("Glob pattern (e.g. '**/*.ts', 'src/**/*.test.*')"),
    }),
  }),
  tool(noop, {
    name: "workspace_map",
    description: "Explore workspace directory structure and file symbols. Use to orient yourself, locate files, and inspect public APIs before reading. Call with no args for root overview.",
    schema: z.object({
      path: z.string().optional().describe("Relative path to explore (default: workspace root)"),
      depth: z.number().optional().describe("Directory traversal depth (default: 1)"),
    }),
  }),
  tool(noop, {
    name: "search_contents",
    description: "Search file contents by regex pattern within the workspace. Returns matching lines with file paths and line numbers. Use this instead of grep via shell.",
    schema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z.string().optional().describe("Subdirectory to search within (default: workspace root)"),
      include: z.string().optional().describe("File glob filter (e.g. '*.ts', '*.md')"),
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
    description: "Run a shell command (build, test, lint, git). Do not use grep/find/cat/head/tail/sed for file search or reading — use glob_files, search_contents, and read_file instead. Commands timeout after 30s by default.",
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
    name: "spawn_subagent",
    description: "Spawn a background subagent in an isolated Git worktree. For complex tasks, include a structured plan in the task description so the subagent has clear steps to follow.",
    schema: z.object({
      task: z.string().describe("Task description"),
      files: z.array(z.string()).describe("Target file paths"),
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
      type: z.enum(["directive", "reference"]).optional().describe("directive = always loaded (rules, preferences), reference = loaded on demand (default)"),
    }),
  }),
  tool(noop, {
    name: "delete_memory",
    description: "Delete a memory by ID. Use when the user says to forget something or a memory is outdated/wrong.",
    schema: z.object({
      id: z.string().describe("Memory ID (e.g. 'mem-abc123')"),
    }),
  }),
  tool(noop, {
    name: "list_memory",
    description: "Browse all saved memories — shows titles, summaries, and keywords. Use to find specific memories or check what's been remembered.",
    schema: z.object({}),
  }),
  tool(noop, {
    name: "list_skills",
    description: "Browse all available skills — shows names, descriptions, and triggers. Skills load automatically but this lets you see what's available.",
    schema: z.object({}),
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
    name: "background_exec",
    description: "Run a shell command in the background without blocking. Returns a task ID immediately. Use check_task to get the result later.",
    schema: z.object({
      command: z.string().describe("Shell command to run in background"),
    }),
  }),
  tool(noop, {
    name: "check_task",
    description: "Check the status and output of a background task by ID.",
    schema: z.object({
      id: z.string().describe("Task ID returned by background_exec"),
    }),
  }),
  tool(noop, {
    name: "read_plan",
    description: "List all plan items grouped by priority (now/next/later), or load the full body of a specific item. Call with NO arguments to see all items. Call with name to read one item's details.",
    schema: z.object({
      name: z.string().optional().describe("Item name (without .md). Omit to list all items."),
    }),
  }),
  tool(noop, {
    name: "add_plan",
    description: "Create a new plan item. Each item is a persistent task with a priority lane, description, and optional detailed body.",
    schema: z.object({
      name: z.string().describe("Short slug for the item (lowercase, hyphens). Used as filename."),
      description: z.string().describe("1-2 sentence summary of what this item is"),
      rationale: z.string().optional().describe("Why this item matters — context for prioritization"),
      priority: z.enum(["now", "next", "later"]).optional().describe("now = active work, next = up next, later = backlog (default: now)"),
      body: z.string().optional().describe("Plan body using template sections: ## Why, ## Overview, ## Constraints, ## Tasks (checklist), ## Done When"),
    }),
  }),
  tool(noop, {
    name: "remove_plan",
    description: "Delete a plan item permanently.",
    schema: z.object({
      name: z.string().describe("Item name (without .md)"),
    }),
  }),
  tool(noop, {
    name: "prioritize_plan",
    description: "Move a plan item to a different priority lane.",
    schema: z.object({
      name: z.string().describe("Item name (without .md)"),
      priority: z.enum(["now", "next", "later"]).describe("Target priority lane"),
    }),
  }),
  tool(noop, {
    name: "update_plan",
    description: "Edit the body of an existing plan item using search/replace. Read the item first with read_plan action='load' to see its current body. To remove an item, use remove_plan instead.",
    schema: z.object({
      name: z.string().describe("Item name (without .md)"),
      search: z.string().describe("Exact text to find in the item body"),
      replace: z.string().describe("Replacement text"),
    }),
  }),
  tool(noop, {
    name: "escalate",
    description: "Request escalation to the dense (architect) model. Use when you're stuck, failing repeatedly, or the task exceeds your reasoning capacity.",
    schema: z.object({
      reason: z.string().describe("Why escalation is needed"),
    }),
  }),
  tool(noop, {
    name: "deescalate",
    description: "Return to the standard utility model. Call when the complex reasoning is done and remaining work is straightforward.",
    schema: z.object({}),
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
