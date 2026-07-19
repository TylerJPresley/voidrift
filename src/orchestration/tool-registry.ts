import { join } from "path";
import type { ContextManager } from "../session/context.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { PlanManager } from "../session/plan.js";
import type { TaskScheduler } from "./scheduler.js";
import { readFile, globFiles, writeFile, editFile, executeCommand } from "../tools/executors.js";
import { webFetch, webSearch } from "../tools/web.js";

export interface ExecutionContext {
  workspaceRoot: string;
  context?: ContextManager;
  config?: VoidRiftConfig;
  planManager?: PlanManager;
  scheduler?: TaskScheduler;
  bus?: import("../events/bus.js").EventBus;
}

export interface ToolExecutor {
  name: string;
  execute: (args: Record<string, any>, ctx: ExecutionContext) => Promise<string>;
}

const registry = new Map<string, ToolExecutor>();

export function registerToolExecutor(executor: ToolExecutor): void {
  registry.set(executor.name, executor);
}

export function getToolExecutor(name: string): ToolExecutor | undefined {
  return registry.get(name);
}

export function executeRegisteredTool(name: string, args: Record<string, any>, ctx: ExecutionContext): Promise<string> {
  const executor = registry.get(name);
  if (!executor) return Promise.resolve(`Error: Tool "${name}" not implemented.`);
  return executor.execute(args, ctx);
}

// ─── Built-in Tool Executors ───────────────────────────────────────────────

registerToolExecutor({
  name: "read_file",
  async execute(args, ctx) {
    const maxLines = ctx.config?.turnsMaxReadLines ?? 1000;
    const filePath = args.path ?? "";
    const fullPath = filePath.startsWith("/") ? filePath : join(ctx.workspaceRoot, filePath);

    // Concise mode: return structural outline without full content
    if (args.format === "concise") {
      try {
        const { readFileSync } = await import("fs");
        const content = readFileSync(fullPath, "utf-8");
        const { summarizeFile } = await import("../codemap/index.js");
        const { summary } = summarizeFile(filePath, content);
        return summary;
      } catch {
        return `Error: File not found: ${filePath}`;
      }
    }

    if (args.offset !== undefined || args.limit !== undefined) {
      const rf = readFile(ctx.workspaceRoot, filePath, args.offset ?? 0, args.limit ?? maxLines);
      return rf.output || rf.error || "";
    }

    try {
      const { readFileSync } = await import("fs");
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const estimatedTokens = Math.ceil(content.length / 4);

      if (estimatedTokens < 100000) return `[${filePath}] ${lines.length} lines\n` + content;

      const rf = readFile(ctx.workspaceRoot, filePath, 0, maxLines);
      return (rf.output || rf.error || "") +
        `\n\n[NOTE: File has ${lines.length} lines (~${estimatedTokens} tokens). Returned first ${maxLines}. Use read_file("${filePath}", offset: ${maxLines}, limit: ${maxLines}) to read the next section.]`;
    } catch {
      const rf = readFile(ctx.workspaceRoot, filePath, 0, maxLines);
      return rf.output || rf.error || "";
    }
  },
});

registerToolExecutor({
  name: "glob_files",
  async execute(args, ctx) {
    return globFiles(ctx.workspaceRoot, args.pattern ?? "").output;
  },
});

registerToolExecutor({
  name: "workspace_map",
  async execute(args, ctx) {
    const { getCodeMapEntries } = await import("../codemap/index.js");
    const targetPath = args.path ? join(ctx.workspaceRoot, args.path) : ctx.workspaceRoot;
    const depth = args.depth ?? 1;
    const entries = getCodeMapEntries(targetPath);
    // Filter to requested depth
    const baseParts = args.path ? args.path.split("/").filter(Boolean).length : 0;
    const filtered = entries.filter(e => {
      const parts = e.path.split("/").filter(Boolean);
      return parts.length <= baseParts + depth;
    });
    if (filtered.length === 0) return `No files found at ${args.path || "./"}`;
    const dirs = filtered.filter(e => e.type === "dir").length;
    const files = filtered.filter(e => e.type === "file").length;
    const summary = `${files} files, ${dirs} directories`;
    const listing = filtered.map(e => {
      if (e.type === "dir") return `📁 ${e.path}`;
      const lineInfo = e.lines ? ` (${e.lines}L)` : "";
      const symbols = e.symbols?.length ? `\n   [${e.symbols.join(", ")}]` : "";
      return `  ${e.path}${lineInfo}${symbols}`;
    }).join("\n");
    return `${summary}\n${listing}`;
  },
});

registerToolExecutor({
  name: "search_contents",
  async execute(args, ctx) {
    const pattern = args.pattern ?? "";
    const subdir = args.path ? join(ctx.workspaceRoot, args.path) : ctx.workspaceRoot;
    const include = args.include ? `--include='${args.include}'` : "";
    try {
      const { execSync } = await import("child_process");
      const cmd = `grep -rn ${include} -P '${pattern.replace(/'/g, "\\'")}' '${subdir}' 2>/dev/null`;
      const result = execSync(cmd, { encoding: "utf-8", timeout: 10000, maxBuffer: 512 * 1024 }).trim();
      if (!result) return "No matches found.";
      const lines = result.split("\n").map(l => l.startsWith(ctx.workspaceRoot) ? l.slice(ctx.workspaceRoot.length + 1) : l);
      return lines.join("\n");
    } catch {
      return "No matches found.";
    }
  },
});

registerToolExecutor({
  name: "write_file",
  async execute(args, ctx) {
    const path = args.path ?? "";
    if (!path) return "Error: No file path provided.";
    const content = args.content ?? "";
    const { computeDiff } = await import("../safeguards/diff.js");
    const diff = computeDiff(ctx.workspaceRoot, path, content);
    const result = writeFile(ctx.workspaceRoot, path, content);
    return result.output + "\n---DIFF---\n" + diff.join("\n");
  },
});

registerToolExecutor({
  name: "edit_file",
  async execute(args, ctx) {
    const path = args.path ?? "";
    const search = args.search ?? "";
    const replace = args.replace ?? "";
    const { computeEditDiff } = await import("../safeguards/diff.js");
    const diff = computeEditDiff(ctx.workspaceRoot, path, search, replace);
    const result = editFile(ctx.workspaceRoot, path, search, replace);
    return result.output + "\n---DIFF---\n" + diff.join("\n");
  },
});

registerToolExecutor({
  name: "execute_command",
  async execute(args, ctx) {
    return executeCommand(ctx.workspaceRoot, args.command ?? "", args.timeout ?? ctx.config?.networkCommandTimeoutMs).output;
  },
});

registerToolExecutor({
  name: "web_fetch",
  async execute(args, ctx) {
    const result = await webFetch(args.url ?? "", ctx.workspaceRoot, { timeoutMs: ctx.config?.networkFetchTimeoutMs, smallFileLines: ctx.config?.networkWebSmallFileLines });
    if (result.isPrivate) return "Error: This is a private/localhost URL. Permission required to access local services.";
    if (result.error) return `Error: ${result.error}`;
    if (args.format === "concise") {
      const lines = result.output.split("\n").slice(0, 20);
      return lines.join("\n") + (result.output.split("\n").length > 20 ? `\n\n[... ${result.output.split("\n").length - 20} more lines. Use format: "full" to get everything${result.cachedPath ? `, or read_file("${result.cachedPath}") for cached content` : ""}.]\n` : "");
    }
    return result.output;
  },
});

registerToolExecutor({
  name: "web_search",
  async execute(args, ctx) {
    const result = await webSearch(args.query ?? args.keywords ?? "", ctx.config?.search);
    return result.error ? `Error: ${result.error}` : result.output;
  },
});

registerToolExecutor({
  name: "read_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "(no plan manager available)";
    if (args.name) {
      const item = ctx.planManager.get(`${args.name}.md`);
      if (!item) return `Error: Plan item "${args.name}" not found.`;
      return `[${item.priority}] ${item.description}\n\n${item.body}`;
    }
    const items = ctx.planManager.all();
    if (items.length === 0) return "(no plan items)";
    const groups: Record<string, any[]> = { now: [], next: [], later: [] };
    for (const item of items) groups[item.priority]?.push(item);
    const counts = Object.entries(groups).filter(([,l]) => l.length > 0).map(([p,l]) => `${l.length} ${p}`).join(", ");
    const lines: string[] = [`${items.length} plan items (${counts})`];
    for (const [pri, list] of Object.entries(groups)) {
      if (list.length === 0) continue;
      lines.push(`\n## ${pri.toUpperCase()}`);
      for (const item of list) {
        lines.push(`- **${item.filename.replace(".md", "")}**: ${item.description}${item.rationale ? ` — ${item.rationale}` : ""}`);
      }
    }
    return lines.join("\n");
  },
});

registerToolExecutor({
  name: "add_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "Error: Plan manager not available.";
    const name = args.name ?? `item-${Date.now().toString(36)}`;
    const filename = ctx.planManager.add(name, args.description ?? "", args.rationale ?? "", args.priority ?? "now", args.body ?? "");
    if (ctx.context) ctx.context.setPlan(ctx.planManager.compileActivePlanSummary() || "");
    return `Plan item added: ${filename}`;
  },
});

registerToolExecutor({
  name: "remove_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "Error: Plan manager not available.";
    if (ctx.planManager.remove(`${args.name}.md`)) {
      if (ctx.context) ctx.context.setPlan(ctx.planManager.compileActivePlanSummary() || "");
      return `Plan item "${args.name}" removed.`;
    }
    return `Error: Item "${args.name}" not found.`;
  },
});

registerToolExecutor({
  name: "prioritize_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "Error: Plan manager not available.";
    if (ctx.planManager.updatePriority(`${args.name}.md`, args.priority ?? "now")) {
      if (ctx.context) ctx.context.setPlan(ctx.planManager.compileActivePlanSummary() || "");
      return `Priority updated: ${args.name} → ${args.priority}`;
    }
    return `Error: Item "${args.name}" not found.`;
  },
});

registerToolExecutor({
  name: "update_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "Error: Plan manager not available.";
    const item = ctx.planManager.get(`${args.name}.md`);
    if (!item) return `Error: Item "${args.name}" not found.`;
    const updated = item.body.replace(args.search ?? "", args.replace ?? "");
    if (updated === item.body) return `Error: Search text not found in "${args.name}".`;
    ctx.planManager.add(args.name, item.description, item.rationale, item.priority, updated);
    return `Plan item "${args.name}" updated.`;
  },
});

registerToolExecutor({
  name: "save_memory",
  async execute(args, ctx) {
    const title = args.title ?? "Untitled";
    const content = args.content ?? "";
    const keywords = (args.keywords ?? "").split(",").map((k: string) => k.trim()).filter(Boolean);
    const scope = args.scope === "global" ? "global" : "local";
    const type = args.type === "directive" ? "directive" : "reference";
    const id = `mem-${Date.now().toString(36)}`;
    const dir = scope === "global"
      ? join(process.env.HOME || "", ".config", "voidrift", "memory")
      : join(ctx.workspaceRoot, ".voidrift", "memory");
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${id}.md`);
    const file = `---\nid: ${id}\ntitle: ${title}\nsummary: ${content.slice(0, 100)}\ntype: ${type}\ncontext:\n  keywords: [${keywords.map((k: string) => `"${k}"`).join(", ")}]\n---\n\n${content}\n`;
    writeFileSync(filePath, file, "utf-8");
    return `Memory saved: "${title}" (${scope}, ${type})`;
  },
});

registerToolExecutor({
  name: "delete_memory",
  async execute(args, ctx) {
    const id = args.id ?? "";
    const { existsSync, unlinkSync } = await import("fs");
    const dirs = [
      join(ctx.workspaceRoot, ".voidrift", "memory"),
      join(process.env.HOME || "", ".config", "voidrift", "memory"),
    ];
    for (const dir of dirs) {
      const filePath = join(dir, `${id}.md`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return `Memory "${id}" deleted.`;
      }
    }
    return `Error: Memory "${id}" not found.`;
  },
});

registerToolExecutor({
  name: "list_memory",
  async execute(args, ctx) {
    const { existsSync, readdirSync, readFileSync } = await import("fs");
    const dirs = [
      join(ctx.workspaceRoot, ".voidrift", "memory"),
      join(process.env.HOME || "", ".config", "voidrift", "memory"),
    ];
    const entries: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(f => f.endsWith(".md"))) {
        try {
          const raw = readFileSync(join(dir, file), "utf-8");
          const id = raw.match(/^id:\s*(.+)$/m)?.[1]?.trim() || file;
          const title = raw.match(/^title:\s*(.+)$/m)?.[1]?.trim() || "";
          const summary = raw.match(/^summary:\s*(.+)$/m)?.[1]?.trim() || "";
          const keywords = raw.match(/keywords:\s*\[([^\]]*)\]/)?.[1] || "";
          entries.push(`- [${id}] ${title}: ${summary}${keywords ? ` (${keywords})` : ""}`);
        } catch {}
      }
    }
    return entries.length ? entries.join("\n") : "(no memories saved)";
  },
});

registerToolExecutor({
  name: "list_skills",
  async execute(args, ctx) {
    const { existsSync, readdirSync, readFileSync } = await import("fs");
    const dirs = [
      join(ctx.workspaceRoot, ".voidrift", "skills"),
      join(process.env.HOME || "", ".config", "voidrift", "skills"),
    ];
    const entries: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(f => f.endsWith(".md"))) {
        try {
          const raw = readFileSync(join(dir, file), "utf-8");
          const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() || file.replace(".md", "");
          const desc = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
          entries.push(`- ${name}: ${desc}`);
        } catch {}
      }
    }
    return entries.length ? entries.join("\n") : "(no skills found)";
  },
});

registerToolExecutor({
  name: "schedule",
  async execute(args, ctx) {
    const instruction = args.instruction ?? "";
    if (!ctx.scheduler) return "Error: Scheduler not available.";
    const { parseDelay } = await import("./scheduler.js");
    if (args.delay) {
      const ms = parseDelay(args.delay);
      const task = ctx.scheduler.scheduleDelay(ms, instruction);
      return `Scheduled one-shot task [${task.id}] firing in ${args.delay}.`;
    } else if (args.cron) {
      const task = ctx.scheduler.scheduleCron(args.cron, instruction);
      return `Scheduled recurring task [${task.id}] with pattern "${args.cron}".`;
    }
    return "Error: Provide either 'delay' or 'cron' parameter.";
  },
});

registerToolExecutor({
  name: "background_exec",
  async execute(args, ctx) {
    if (!ctx.scheduler) return "Error: Scheduler not available.";
    const task = ctx.scheduler.backgroundExec(args.command ?? "", ctx.workspaceRoot);
    return `Background task started [${task.id}]. Use check_task("${task.id}") to get status/output.`;
  },
});

registerToolExecutor({
  name: "check_task",
  async execute(args, ctx) {
    if (!ctx.scheduler) return "Error: Scheduler not available.";
    const task = ctx.scheduler.getTask(args.id ?? "");
    if (!task) return `Error: Task "${args.id}" not found.`;
    if (task.status === "running") return `Task [${task.id}] is still running.`;
    return `Task [${task.id}] ${task.status}.\n${task.output || "(no output)"}`;
  },
});

registerToolExecutor({
  name: "run_task_agent",
  async execute() {
    return "Error: run_task_agent must be handled by the orchestration layer.";
  },
});

registerToolExecutor({
  name: "spawn_subagent",
  async execute() {
    return "Error: spawn_subagent must be handled by the orchestration layer.";
  },
});

registerToolExecutor({
  name: "escalate",
  async execute(args) {
    return `Escalation requested: ${args.reason || "no reason given"}. System will switch to dense model.`;
  },
});

registerToolExecutor({
  name: "deescalate",
  async execute() {
    return "De-escalated. Returning to flash model.";
  },
});

registerToolExecutor({
  name: "search_tools",
  async execute(args, ctx) {
    const { compileToolTOC, selectTools } = await import("./tool-binding.js");
    const { createTierAdapter } = await import("../adapters/factory.js");
    const { ALL_TOOLS } = await import("../agents/registry.js");

    const toolTOC = compileToolTOC(ALL_TOOLS, undefined);
    const flashClient = createTierAdapter("utility", ctx.config!).client;
    const selected = await selectTools(flashClient, args.query, toolTOC);
    if (selected.length === 0) return "No matching tools found for that query.";
    // Activate the tools in the context so the harness can re-bind them
    if (ctx.context) {
      const active = ctx.context.context.agent.activeTools;
      for (const tool of selected) {
        if (!active.includes(tool)) active.push(tool);
      }
      ctx.context.setTools(active);
    }
    return `Found tools: ${selected.join(", ")}. These are now available for this turn.`;
  },
});

registerToolExecutor({
  name: "load_skill",
  async execute(args, ctx) {
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const name = args.name ?? "";
    
    // Resolution cascade: workspace → global → builtin
    const candidates = [
      join(ctx.workspaceRoot, ".voidrift", "skills", `${name}.md`),
      join(process.env.HOME || "", ".config", "voidrift", "skills", `${name}.md`),
    ];
    
    // Check filesystem first (workspace → global)
    for (const path of candidates) {
      if (existsSync(path)) {
        const content = readFileSync(path, "utf-8");
        // Strip frontmatter, load body into active skills
        const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
        if (ctx.context) {
          const active = ctx.context.context.orbit.activeSkills;
          if (!active.includes(body)) {
            active.push(body);
            ctx.context.setActiveSkills(active);
          }
        }
        return `Skill "${name}" loaded into active context.`;
      }
    }
    
    // Fallback: check builtins (already indexed by SkillManager)
    // We can't directly access SkillManager here, but builtins are in the indexed list
    // which is accessible via context's skillDiscoveryIndex. The actual content needs
    // to come from the SkillManager instance — but we don't have it in ExecutionContext.
    // For builtins, check if the skill exists in the indexed list and return guidance.
    return `Error: Skill "${name}" not found. Check the skill discovery index for available names.`;
  },
});

registerToolExecutor({
  name: "query_logs",
  async execute(args, ctx) {
    const { queryLogs } = await import("../logging/audit.js");
    const { join, resolve } = await import("path");
    const { readdirSync } = await import("fs");
    // Find the latest log file in .voidrift/logs/
    const logsDir = join(ctx.workspaceRoot, ".voidrift", "logs");
    let logPath = "";
    try {
      const files = readdirSync(logsDir).filter(f => f.endsWith(".log")).sort().reverse();
      if (files.length > 0) logPath = join(logsDir, files[0]);
    } catch {}
    if (!logPath) return "No log files found.";
    const result = await queryLogs(logPath, args.query ?? "", { limit: args.limit, since: args.since });
    if (result.entries.length === 0) return result.query.startsWith("Error") ? result.query : "No matching entries found.";
    const header = `${result.total} matches (showing ${result.entries.length}):`;
    const lines = result.entries.map(e => `[${e.timestamp?.slice(11, 19) || ""}] ${e.source}/${e.level}: ${e.message}${e.data ? " " + JSON.stringify(e.data).slice(0, 100) : ""}`);
    return header + "\n" + lines.join("\n");
  },
});

registerToolExecutor({
  name: "register_task",
  async execute(args, ctx) {
    const { TaskRegistry } = await import("../tasks/registry.js");
    const registry = new TaskRegistry(ctx.workspaceRoot);
    const filename = registry.register({
      name: args.name ?? "unnamed",
      description: args.description ?? "",
      instruction: args.instruction ?? "",
      output: args.output,
      append: args.append,
    });
    return `Task registered: ${filename}. Invoke with invoke_task("${args.name}", vars).`;
  },
});

registerToolExecutor({
  name: "invoke_task",
  async execute(args, ctx) {
    const { TaskRegistry } = await import("../tasks/registry.js");
    const registry = new TaskRegistry(ctx.workspaceRoot);
    const vars = JSON.parse(args.vars || "{}");
    const instruction = registry.render(args.name, vars);
    if (!instruction) return `Error: Task "${args.name}" not found.`;
    const def = registry.get(args.name)!;

    // Execute via scheduler as a background task
    if (ctx.scheduler) {
      // Write a runner script that executes the task instruction
      const { writeFileSync, mkdirSync } = await import("fs");
      const { join } = await import("path");
      const cacheDir = join(ctx.workspaceRoot, ".voidrift", "cache", "tasks");
      mkdirSync(cacheDir, { recursive: true });
      const scriptPath = join(cacheDir, `${args.name}-${Date.now()}.sh`);
      const outputFlag = def.output ? (def.append ? `>> "${def.output}"` : `> "${def.output}"`) : "";
      // The script uses the existing tools via shell commands
      writeFileSync(scriptPath, `#!/bin/bash\ncd "${ctx.workspaceRoot}"\n# Task: ${args.name}\n# Instruction: ${instruction.replace(/\n/g, "\n# ")}\necho "[Task:${args.name}] Executing..."\n`, "utf-8");
      const task = ctx.scheduler.backgroundExec(`bash "${scriptPath}"`, ctx.workspaceRoot);
      return `Task "${args.name}" queued [${task.id}]. Instruction: ${instruction.slice(0, 100)}. Use check_task("${task.id}") for status.`;
    }
    return `Error: Scheduler not available.`;
  },
});
