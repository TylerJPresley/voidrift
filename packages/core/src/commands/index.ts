import type { CoreRegistry } from "../registry/core.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { ContextManager } from "../session/context.js";
import type { TokenBudgetWatcher } from "../output/budget.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { SessionBrain } from "../session/brain.js";
import type { MemoryRegistry } from "../session/memory.js";
import type { StatsTracker } from "../session/stats.js";
import type { SkillManager } from "../skills/manager.js";
import type { TemplateService } from "../templates/service.js";
import type { MCPEngine } from "../mcp/engine.js";
import type { WorktreeEngine } from "../worktree/engine.js";
import type { TaskScheduler } from "../orchestration/scheduler.js";
import { compactHistory } from "../session/compactor.js";
import { createTierAdapter } from "../adapters/factory.js";
import { EventBus } from "../events/bus.js";
import { execSync } from "child_process";

export interface CommandDeps {
  config: VoidRiftConfig;
  context: ContextManager;
  budget: TokenBudgetWatcher;
  agents: AgentRegistry;
  brain: SessionBrain;
  memory: MemoryRegistry;
  stats: StatsTracker;
  skills: SkillManager;
  templates: TemplateService;
  mcp: MCPEngine;
  worktree: WorktreeEngine;
  scheduler?: TaskScheduler;
  bus: EventBus;
  workspaceRoot: string;
  sessionId: string;
  output: (text: string) => void;
  openPanel: (panel: string) => void;
  switchModel: (name: string, tier?: string) => boolean;
  exit: () => void;
}

/**
 * Registers all 26 core slash commands.
 */
export function registerCommands(registry: CoreRegistry, deps: CommandDeps): void {
  // --- Session & Navigation ---
  registry.registerSlashCommand({ name: "help", description: "Interactive help utility panel", execute: async () => deps.openPanel("help") });
  registry.registerSlashCommand({ name: "exit", description: "Save session and exit", execute: async () => { deps.brain.save(deps.context.context, deps.agents.active.id); deps.output("Session saved. Goodbye."); deps.exit(); } });
  registry.registerSlashCommand({ name: "clear", description: "Reset conversation history", execute: async () => { deps.context.setMessages([]); deps.output("Session cleared."); } });
  registry.registerSlashCommand({ name: "plan", description: "View, edit, or delete the active plan", execute: async () => deps.openPanel("plan") });
  registry.registerSlashCommand({ name: "compact", description: "Compact conversation history", execute: async () => {
    const msgs = deps.context.getMessages();
    const result = compactHistory(msgs, deps.budget.state.used, deps.budget.state.limit);
    if (result.compacted) { deps.context.setMessages(result.messages); deps.output(`Compacted: ${msgs.length} → ${result.messages.length} messages`); }
    else deps.output("Nothing to compact.");
  }});
  registry.registerSlashCommand({ name: "resume", description: "Conversation browser", execute: async () => deps.openPanel("resume") });
  registry.registerSlashCommand({ name: "rewind", description: "Rollback to previous turn", execute: async (args) => {
    const turn = args[0] ? parseInt(args[0]) : null;
    if (turn !== null) { const msgs = deps.context.getMessages().slice(0, turn * 2); deps.context.setMessages(msgs); deps.output(`Rewound to turn ${turn}.`); }
    else deps.openPanel("rewind");
  }});

  // --- Model & Context ---
  registry.registerSlashCommand({ name: "model", description: "Switch or list models", execute: async (args) => {
    if (args.length) { const ok = deps.switchModel(args[0], args[1]); deps.output(ok ? `Switched to: ${args[0]}` : `Model "${args[0]}" not found.`); }
    else deps.openPanel("model");
  }});
  registry.registerSlashCommand({ name: "stats", description: "Session analytics", execute: async () => deps.openPanel("stats") });
  registry.registerSlashCommand({ name: "context", description: "Context visualizer", execute: async () => deps.openPanel("context") });
  registry.registerSlashCommand({ name: "tools", description: "List available tools", execute: async () => deps.openPanel("tools") });
  registry.registerSlashCommand({ name: "diff", description: "Code diff viewer", execute: async (args) => {
    const flag = args.includes("--turn") || args.includes("-t") ? "--cached" : "";
    try { const diff = execSync(`git diff ${flag} --stat`, { cwd: deps.workspaceRoot, encoding: "utf-8" }); deps.output(diff || "No changes."); }
    catch { deps.output("Not a git repository or no changes."); }
  }});

  // --- Skills, Agents, MCP ---
  registry.registerSlashCommand({ name: "skills", description: "Skill registry", execute: async () => deps.openPanel("skills") });
  registry.registerSlashCommand({ name: "agents", description: "Agent manager", execute: async () => deps.openPanel("agents") });
  registry.registerSlashCommand({ name: "mcp", description: "MCP server manager", execute: async () => deps.openPanel("mcp") });

  // --- Memory ---
  registry.registerSlashCommand({ name: "memory", description: "Memory manager", execute: async () => deps.openPanel("memory") });

  // --- Templates & Prompts ---
  registry.registerSlashCommand({ name: "templates", description: "Template manager", execute: async () => deps.openPanel("templates") });
  registry.registerSlashCommand({ name: "prompts", description: "Prompt manager", execute: async () => deps.openPanel("prompts") });

  // --- Tasks & Automation ---
  registry.registerSlashCommand({ name: "tasks", description: "Background task monitor", execute: async () => deps.openPanel("tasks") });
  registry.registerSlashCommand({ name: "goal", description: "Autonomous execution loop", execute: async (args) => {
    if (!args.length) { deps.output("Usage: /goal <instruction>"); return; }
    const instruction = args.join(" ");
    deps.output(`Goal started: ${instruction}`);
    const resolved = createTierAdapter("dense", deps.config);
    const { runGoal } = await import("../orchestration/goal.js");
    runGoal(instruction, resolved.client, deps.bus, (chunk) => {
      if (chunk.type === "status") deps.output(`[Goal Status] ${chunk.message}`);
    }).then(result => {
      deps.output(`Goal finished! Success: ${result.success}. Turns: ${result.turns}. Reason: ${result.terminationReason}`);
    }).catch(err => {
      deps.output(`Goal failed: ${err.message}`);
    });
  }});

  registry.registerSlashCommand({ name: "schedule", description: "Background timer & cron", execute: async (args) => {
    if (args.length < 2) { deps.output("Usage: /schedule <cron|--delay time> \"<instruction>\""); return; }
    const type = args[0];
    
    // Fallback if not injected in testing or basic environments
    let scheduler = deps.scheduler;
    if (!scheduler) {
      const { TaskScheduler } = await import("../orchestration/scheduler.js");
      scheduler = new TaskScheduler(deps.bus, (instruction) => {
        deps.output(`[Scheduler Triggered] Executing: "${instruction}"`);
      });
    }

    if (type === "--delay") {
      const { parseDelay } = await import("../orchestration/scheduler.js");
      const delayStr = args[1];
      const promptText = args.slice(2).join(" ");
      const ms = parseDelay(delayStr);
      const task = scheduler.scheduleDelay(ms, promptText);
      deps.output(`Scheduled one-shot task [${task.id}] with delay ${delayStr}`);
    } else {
      const promptText = args.slice(1).join(" ");
      const task = scheduler.scheduleCron(type, promptText);
      deps.output(`Scheduled recurring cron task [${task.id}] with pattern ${type}`);
    }
  }});

  // --- Dev Workflow (Plugins) ---
  registry.registerSlashCommand({ name: "ideas", description: "Ideas manager", execute: async () => deps.openPanel("ideas") });
  registry.registerSlashCommand({ name: "idea", description: "Open/create an idea", execute: async (args) => {
    if (!args.length) deps.openPanel("ideas");
    else deps.output(`Opening IDEA-${args[0]}...`);
  }});
  registry.registerSlashCommand({ name: "cr", description: "Change request manager", execute: async (args) => {
    if (!args.length) deps.openPanel("changes");
    else deps.output(`Opening CR-${args[0]}...`);
  }});
  registry.registerSlashCommand({ name: "changes", description: "List change requests", execute: async () => deps.openPanel("changes") });
  registry.registerSlashCommand({ name: "import", description: "Scan codebase structure", execute: async (args) => {
    const path = args[0] || ".";
    deps.output(`Scanning ${path}`);
    const { importScan } = await import("../orchestration/import.js");
    const report = importScan(deps.workspaceRoot, path);
    deps.output(report);
  }});
  registry.registerSlashCommand({ name: "develop", description: "Spawn engineer subagents for a CR", execute: async (args) => {
    const crFlag = args.indexOf("--cr");
    const crId = crFlag >= 0 ? args[crFlag + 1] : null;
    if (!crId) { deps.output("Usage: /develop --cr <id>"); return; }
    const { developCR } = await import("../orchestration/develop.js");
    deps.output(`Developing CR-${crId}...`);
    developCR(crId, deps.workspaceRoot, deps.worktree, async (wtPath, taskContent) => {
      deps.output(`[Worktree Subagent] Running in ${wtPath}...`);
      return "success";
    }).then(res => {
      deps.output(`CR-${crId} development spawned! Tasks Scheduled: ${res.tasksSpawned}, Queued: ${res.tasksQueued}`);
    }).catch(err => {
      deps.output(`Development failed: ${err.message}`);
    });
  }});
  registry.registerSlashCommand({ name: "done", description: "Mark current task complete", execute: async () => { deps.output("Task marked complete."); } });
}
