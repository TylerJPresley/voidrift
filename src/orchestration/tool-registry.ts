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
    const maxLines = ctx.config?.maxReadLines ?? 1000;
    const filePath = args.path ?? "";
    const fullPath = filePath.startsWith("/") ? filePath : join(ctx.workspaceRoot, filePath);

    if (args.offset !== undefined || args.limit !== undefined) {
      const rf = readFile(ctx.workspaceRoot, filePath, args.offset ?? 0, args.limit ?? maxLines);
      return rf.output || rf.error || "";
    }

    try {
      const { readFileSync } = await import("fs");
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const estimatedTokens = Math.ceil(content.length / 4);

      if (estimatedTokens < 100000) return content;

      const rf = readFile(ctx.workspaceRoot, filePath, 0, maxLines);
      return (rf.output || rf.error || "") +
        `\n\n[NOTE: File has ${lines.length} lines (~${estimatedTokens} tokens). Returned first ${maxLines}. Use offset/limit for remaining sections.]`;
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
  name: "write_file",
  async execute(args, ctx) {
    return writeFile(ctx.workspaceRoot, args.path ?? "", args.content ?? "").output;
  },
});

registerToolExecutor({
  name: "edit_file",
  async execute(args, ctx) {
    return editFile(ctx.workspaceRoot, args.path ?? "", args.search ?? "", args.replace ?? "").output;
  },
});

registerToolExecutor({
  name: "execute_command",
  async execute(args, ctx) {
    return executeCommand(ctx.workspaceRoot, args.command ?? "", args.timeout).output;
  },
});

registerToolExecutor({
  name: "web_fetch",
  async execute(args) {
    const result = await webFetch(args.url ?? "", "");
    if (result.isPrivate) return "Error: This is a private/localhost URL. Permission required to access local services.";
    return result.error ? `Error: ${result.error}` : result.output;
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
    if (args.action === "load" && args.name) {
      const body = ctx.planManager.loadBody(`${args.name}.md`);
      return body ?? `Error: Plan item "${args.name}" not found.`;
    }
    const items = ctx.planManager.all();
    if (items.length === 0) return "(no plan items)";
    const groups: Record<string, any[]> = { now: [], next: [], later: [] };
    for (const item of items) groups[item.priority]?.push(item);
    const lines: string[] = [];
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
  name: "write_plan",
  async execute(args, ctx) {
    if (!ctx.planManager) return "Error: Plan manager not available.";
    const action = args.action ?? "";
    switch (action) {
      case "add": {
        const name = args.name ?? `item-${Date.now().toString(36)}`;
        const filename = ctx.planManager.add(name, args.description ?? "", args.rationale ?? "", args.priority ?? "now", args.body ?? "");
        if (ctx.context) ctx.context.setPlan(ctx.planManager.compile() || "");
        return `Plan item added: ${filename}`;
      }
      case "remove":
        if (ctx.planManager.remove(`${args.name}.md`)) {
          if (ctx.context) ctx.context.setPlan(ctx.planManager.compile() || "");
          return `Plan item "${args.name}" removed.`;
        }
        return `Error: Item "${args.name}" not found.`;
      case "prioritize":
        if (ctx.planManager.updatePriority(`${args.name}.md`, args.priority ?? "now")) {
          if (ctx.context) ctx.context.setPlan(ctx.planManager.compile() || "");
          return `Priority updated: ${args.name} → ${args.priority}`;
        }
        return `Error: Item "${args.name}" not found.`;
      default:
        return `Error: Unknown action "${action}". Use: add, remove, prioritize.`;
    }
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
    const id = `mem-${Date.now().toString(36)}`;
    const dir = scope === "global"
      ? join(process.env.HOME || "", ".config", "voidrift", "memory")
      : join(ctx.workspaceRoot, ".voidrift", "memory");
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${id}.md`);
    const file = `---\nid: ${id}\ntitle: ${title}\nsummary: ${content.slice(0, 100)}\ncontext:\n  keywords: [${keywords.map((k: string) => `"${k}"`).join(", ")}]\n---\n\n${content}\n`;
    writeFileSync(filePath, file, "utf-8");
    return `Memory saved: "${title}" (${scope})`;
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
  name: "run_task_agent",
  async execute() {
    return "Error: run_task_agent must be handled by the orchestration layer.";
  },
});
