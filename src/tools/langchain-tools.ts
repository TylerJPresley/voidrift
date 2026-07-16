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
    description: "Read file content from the workspace. Returns the file with line numbers for reference. For files under 1000 lines, omit offset/limit to get everything. For larger files, the response includes a note with the total line count and instructs you to use offset/limit for specific sections. IMPORTANT: Always read a file before editing it — you need the exact text for search-and-replace. If you get a 'file too large' note, read the specific section you need with offset/limit rather than retrying without params.",
    schema: z.object({
      path: z.string().describe("Relative file path from workspace root (e.g. 'src/main.ts', 'package.json')"),
      offset: z.number().optional().describe("Line offset to start reading from (0-indexed). Use when targeting a specific section of a large file."),
      limit: z.number().optional().describe("Maximum number of lines to return. Combine with offset for pagination. Default: 1000."),
      format: z.enum(["full", "concise"]).optional().describe("'concise' returns structural outline (symbols, headings, line ranges) without full content — use for scouting before reading in detail. Default: 'full'."),
    }),
  }),
  tool(noop, {
    name: "glob_files",
    description: "Find files matching a glob pattern. Returns a list of relative paths. Use NARROW patterns — '**/*.ts' returns hundreds of files while 'src/utils/*.ts' returns just what you need. When looking for a specific file, prefer this over workspace_map. When exploring structure, prefer workspace_map over this.",
    schema: z.object({
      pattern: z.string().describe("Glob pattern. Examples: '**/*.test.ts' (all tests), 'src/session/*.ts' (specific dir), '**/config*.json' (config files anywhere)"),
    }),
  }),
  tool(noop, {
    name: "workspace_map",
    description: "Browse the workspace directory tree with file symbols (exported functions, classes, interfaces). Use this to orient yourself in an unfamiliar codebase — it shows structure without reading file contents. Call with no arguments for a root-level overview. Drill into subdirectories with path + depth for targeted exploration. Symbols show public APIs so you know what a file exports before reading it.",
    schema: z.object({
      path: z.string().optional().describe("Subdirectory to explore (e.g. 'src/session'). Omit for workspace root."),
      depth: z.number().optional().describe("How many directory levels deep to traverse. Default: 1. Use 2-3 for deeper exploration."),
    }),
  }),
  tool(noop, {
    name: "search_contents",
    description: "Search inside files using regex patterns. Returns matching lines with file paths and line numbers — use those line numbers with read_file's offset to jump directly to relevant code. Supports PCRE regex. Narrow your search with the 'include' filter to avoid noise from node_modules/dist/etc. Use this instead of grep via execute_command — it's faster, permission-free, and workspace-scoped.",
    schema: z.object({
      pattern: z.string().describe("PCRE regex pattern. Examples: 'export.*function', 'TODO|FIXME', 'class\\s+\\w+Manager'"),
      path: z.string().optional().describe("Subdirectory to search within (e.g. 'src/'). Default: entire workspace."),
      include: z.string().optional().describe("File glob filter to narrow scope. Examples: '*.ts', '*.test.*', '*.md'"),
    }),
  }),
  tool(noop, {
    name: "write_file",
    description: "Create a new file or completely overwrite an existing one. Use this for NEW files. For modifying existing files, use edit_file instead — it's safer (surgical replacement vs full overwrite). You must provide the COMPLETE file content — never use placeholders like '// rest of code' or '...' — the file will contain exactly what you provide and nothing else. Parent directories are created automatically.",
    schema: z.object({
      path: z.string().describe("Relative file path. Parent directories are auto-created."),
      content: z.string().describe("The complete file content. Must be the full file — no placeholders or abbreviations."),
    }),
  }),
  tool(noop, {
    name: "edit_file",
    description: "Surgically replace a block of text in an existing file. The 'search' param must be an EXACT match of existing content including all whitespace, indentation, and newlines. If the search text appears more than once in the file, the edit is rejected — include more surrounding lines to make it unique. WORKFLOW: 1) read_file to see current content, 2) copy the exact block you want to change into 'search', 3) provide the modified version in 'replace'. Common failure: wrong indentation or missing a trailing newline in the search block.",
    schema: z.object({
      path: z.string().describe("Relative file path (must already exist)"),
      search: z.string().describe("Exact text block to find. Copy-paste from read_file output. Must be unique in the file."),
      replace: z.string().describe("The new text that replaces the search block"),
    }),
  }),
  tool(noop, {
    name: "execute_command",
    description: "Run a shell command in the workspace. Use for: build (npm run build), test (bun run test), lint, git operations, package management. Do NOT use for file reading (use read_file), file searching (use search_contents/glob_files), or web requests (use web_fetch). Commands that need those capabilities are auto-denied with guidance. Timeout default: 30s. The workspace root is the working directory. Output is truncated if too long.",
    schema: z.object({
      command: z.string().describe("Shell command to execute. Runs in workspace root. Examples: 'bun run test', 'git status', 'npm install express'"),
      timeout: z.number().optional().describe("Timeout in milliseconds. Default: 30000. Max: 120000. Use higher values for builds/tests."),
    }),
  }),
  tool(noop, {
    name: "web_search",
    description: "Search the web and return top results with titles, URLs, and snippets. Use when you need: documentation for an unfamiliar library, solutions to error messages, API references, or current information not in your training data. Returns up to 8 results. For deeper reading, take a URL from the results and pass it to web_fetch.",
    schema: z.object({
      query: z.string().describe("Search query. Be specific — 'vitest mock module ESM' works better than 'testing'"),
    }),
  }),
  tool(noop, {
    name: "web_fetch",
    description: "Fetch a URL and return its content as clean text (HTML is stripped to markdown). Use for: reading documentation pages, API references, GitHub READMEs, blog posts. Large pages are cached to .voidrift/cache/web/ and you get a preview + file path — use read_file on the cached path for specific sections. Localhost/private URLs require permission approval.",
    schema: z.object({
      url: z.string().describe("Full URL including https://. GitHub blob URLs are auto-converted to raw."),
      format: z.enum(["full", "concise"]).optional().describe("'concise' returns first 20 lines as a preview. 'full' (default) returns everything. Use concise when scouting multiple URLs before deciding which to read fully."),
    }),
  }),
  tool(noop, {
    name: "spawn_subagent",
    description: "Delegate work to an isolated background agent running in its own git worktree. The subagent has its own context window and runs on the utility model tier. Use when: processing many files in parallel, long-running tasks you don't want to block on, or work that can be done independently. The subagent's changes merge back on completion. Include a clear structured plan in the task description — subagents can't ask questions.",
    schema: z.object({
      task: z.string().describe("Clear task description with steps. The agent works autonomously — be explicit about what 'done' looks like."),
      files: z.array(z.string()).describe("File paths the subagent will work on. Used for path-mutex locking to prevent conflicts."),
      mode: z.enum(["singlePass", "iterativeLoop"]).optional().describe("'singlePass' (default) = single execution pass. 'iterativeLoop' = iterative execution until complete, fresh context each turn."),
    }),
  }),
  tool(noop, {
    name: "run_task_agent",
    description: "Run a registered task agent (indexer, summarizer, or custom) with a specific instruction. Task agents have constrained tool sets and focused personas. Use 'indexer' for codebase analysis, 'summarizer' for content reduction. Custom task agents are defined in .voidrift/agents/ with type: 'task'.",
    schema: z.object({
      agentId: z.string().describe("Agent ID: 'indexer', 'summarizer', or a custom task agent ID"),
      instruction: z.string().describe("What you want the agent to do. Be specific — it runs autonomously."),
    }),
  }),
  tool(noop, {
    name: "save_memory",
    description: "Store a fact for future sessions. Memories persist permanently and are surfaced automatically when relevant keywords appear in conversation. Use 'directive' type for rules that should load EVERY session (e.g., 'always use snake_case'). Use 'reference' type (default) for facts loaded on-demand when keywords match. Choose keywords carefully — they drive automatic retrieval.",
    schema: z.object({
      title: z.string().describe("Short descriptive title (shown in memory index)"),
      content: z.string().describe("The fact, rule, or preference to remember"),
      keywords: z.string().describe("Comma-separated retrieval keywords. Choose words the user would naturally say when this memory is relevant."),
      scope: z.enum(["local", "global"]).optional().describe("local = this project only (.voidrift/memory/). global = all projects (~/.config/voidrift/memory/). Default: local."),
      type: z.enum(["directive", "reference"]).optional().describe("directive = auto-loaded every session. reference = loaded on keyword match (default). Use directive sparingly."),
    }),
  }),
  tool(noop, {
    name: "delete_memory",
    description: "Remove an outdated or incorrect memory by its ID. Use list_memory first to find the ID. Delete when: a fact is no longer true, user explicitly says to forget, or you notice a memory contradicts current project state.",
    schema: z.object({
      id: z.string().describe("Memory ID from list_memory output (format: 'mem-abc123')"),
    }),
  }),
  tool(noop, {
    name: "list_memory",
    description: "List all saved memories with their IDs, titles, summaries, and keywords. Use to: check what's been remembered, find a memory ID for deletion, or verify a fact before re-saving it. Shows both local (project) and global (cross-project) memories.",
    schema: z.object({}),
  }),
  tool(noop, {
    name: "list_skills",
    description: "List all available skills with names, descriptions, and trigger conditions. Skills load automatically based on context (file extensions, keywords, agent bindings) but this lets you see the full catalog. Use load_skill to manually activate one if it hasn't triggered automatically.",
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
      priority: z.enum(["now", "next", "later", "complete"]).optional().describe("now = active work, next = up next, later = backlog (default: now)"),
      body: z.string().optional().describe("Plan body using template sections: ## Why, ## Overview, ## Constraints, ## Tasks (checklist), ## Done When"),
      scope: z.object({
        write: z.array(z.string()).optional().describe("Glob patterns for files this plan will modify (e.g. ['src/auth/**', 'tests/auth/**'])"),
        execute: z.array(z.string()).optional().describe("Commands this plan will run (e.g. ['bun run test', 'bun run lint'])"),
      }).optional().describe("Execution scope — declaring this lets the harness auto-approve actions within these boundaries without prompting. Omit if unsure."),
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
      priority: z.enum(["now", "next", "later", "complete"]).describe("Target priority lane"),
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
  tool(noop, {
    name: "search_tools",
    description: "Search for and activate additional tools by capability description. Use when you need a tool that isn't currently available.",
    schema: z.object({
      query: z.string().describe("Search query describing the capability you need (e.g. 'create pull request', 'write database', 'schedule task')"),
    }),
  }),
  tool(noop, {
    name: "load_skill",
    description: "Load a skill by name into active context. Skills provide detailed guidance for specific domains. Check the skill discovery index for available names.",
    schema: z.object({
      name: z.string().describe("Skill name from the discovery index (e.g. 'planning', 'SECURITY-TRUST', 'WEB-ENG')"),
    }),
  }),
  tool(noop, {
    name: "register_task",
    description: "Register a reusable task definition. Tasks can be invoked repeatedly with different inputs. Use for batch work — define the task once, invoke many times.",
    schema: z.object({
      name: z.string().describe("Task name (lowercase, hyphens). Used as filename."),
      description: z.string().describe("What this task does in one sentence"),
      instruction: z.string().describe("Instruction template with {{variable}} placeholders for inputs"),
      output: z.string().optional().describe("File path to write/append results to"),
      append: z.boolean().optional().describe("If true, append to output file instead of overwriting"),
    }),
  }),
  tool(noop, {
    name: "invoke_task",
    description: "Run a registered task with specific input variables. Executes as an isolated subagent with its own context.",
    schema: z.object({
      name: z.string().describe("Name of the registered task to run"),
      vars: z.string().describe("JSON object of template variables to fill (e.g. {\"url\": \"https://...\", \"output\": \"results.md\"})"),
    }),
  }),
  tool(noop, {
    name: "query_logs",
    description: "Query audit logs using Lucene-like syntax. Returns matching log entries from the session. Use to investigate what happened — tool calls, errors, file changes, mode switches. Example queries: source:tool AND level:error, message:\"call:\", data.toolName:read_file",
    schema: z.object({
      query: z.string().describe("Lucene-like query string. Fields: source, level, message, timestamp, data.*. Supports AND, OR, NOT, wildcards (*), ranges (TO)."),
      limit: z.number().optional().describe("Maximum results to return (default 50)"),
      since: z.string().optional().describe("ISO timestamp — only entries after this time"),
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
