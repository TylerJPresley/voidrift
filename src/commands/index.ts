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
import type { GitCheckpointer } from "../safeguards/checkpoint.js";
import { compactHistory } from "../session/compactor.js";
import { createTierAdapter, createAdapter } from "../adapters/factory.js";
import { EventBus } from "../events/bus.js";
import { execSync } from "child_process";
import type { PolicyEngine } from "../security/policy-engine.js";
import type { AuditLogger } from "../logging/audit.js";

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
  checkpointer: GitCheckpointer;
  bus: EventBus;
  workspaceRoot: string;
  sessionId: string;
  policyEngine?: PolicyEngine;
  logger?: AuditLogger;
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
  registry.registerSlashCommand({ name: "clear", description: "Reset conversation history", execute: async () => { deps.context.setMessages([]); deps.context.setFullHistory([]); deps.context.clearFocusedFiles(); deps.output("Session cleared."); } });
  registry.registerSlashCommand({ name: "plan", description: "View, edit, or delete the active plan", execute: async () => deps.openPanel("plan") });
  registry.registerSlashCommand({ name: "compact", description: "Compact conversation history", execute: async () => {
    const msgs = deps.context.getMessages();
    const result = compactHistory(msgs, deps.budget.state.used, deps.budget.state.limit, deps.config.contextKeepRecentTurns);
    if (result.compacted) { deps.context.setMessages(result.messages); deps.output(`Compacted: ${msgs.length} → ${result.messages.length} messages`); }
    else deps.output("Nothing to compact.");
  }});
  registry.registerSlashCommand({ name: "resume", description: "Conversation browser", execute: async () => deps.openPanel("resume") });
  registry.registerSlashCommand({ name: "rewind", description: "Rollback to previous turn", execute: async (args) => {
    const turn = args[0] ? parseInt(args[0]) : null;
    if (turn !== null) { const msgs = deps.context.getMessages().slice(0, turn * 2); deps.context.setMessages(msgs); deps.checkpointer.rollbackTo(turn); deps.output(`Rewound to turn ${turn}.`); }
    else deps.openPanel("rewind");
  }});

  // --- Model & Context ---
  registry.registerSlashCommand({ name: "config", description: "Edit configuration with validation", execute: async (args) => {
    if (!args.length) { deps.openPanel("config"); return; }
    const { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const { ConfigSchema } = await import("../config/loader.js");
    const { openInEditor } = await import("../utils/editor.js");

    const scope = args[0] === "global" ? "global" : "workspace";
    const realPath = scope === "global"
      ? join(homedir(), ".config", "voidrift", "config.json")
      : join(deps.workspaceRoot, ".voidrift", "config.json");

    if (!existsSync(realPath)) {
      mkdirSync(join(deps.workspaceRoot, ".voidrift"), { recursive: true });
      writeFileSync(realPath, JSON.stringify({}, null, 2), "utf-8");
    }

    // Copy to temp file for editing
    const cacheDir = join(deps.workspaceRoot, ".voidrift", "cache");
    mkdirSync(cacheDir, { recursive: true });
    const tempPath = join(cacheDir, `config-edit-${scope}.json`);
    copyFileSync(realPath, tempPath);

    if (!deps.config.editor) {
      deps.output(`No editor configured. Edit directly: ${realPath}`);
      return;
    }

    const result = openInEditor(tempPath, deps.config.editor);
    if (!result.success) { deps.output(result.error || "Editor failed"); return; }

    // Validate the edited temp file
    try {
      const edited = JSON.parse(readFileSync(tempPath, "utf-8"));

      // For workspace config, we only validate structure (it merges over global)
      // For global config, validate the full schema
      if (scope === "global") {
        const validation = ConfigSchema.safeParse(edited);
        if (!validation.success) {
          const issues = validation.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
          deps.output(`Validation failed:\n${issues}\n\nChanges NOT applied. Run /config again to fix.`);
          return;
        }
      }

      // Valid — apply to real config
      writeFileSync(realPath, JSON.stringify(edited, null, 2), "utf-8");

      // Hot-reload: update live config
      const { loadConfig } = await import("../config/loader.js");
      const reloaded = loadConfig({ workspaceRoot: deps.workspaceRoot });
      Object.assign(deps.config, reloaded);

      // Update budget limit if model changed
      const flashModel = reloaded.models[reloaded.modelTierFlash];
      if (flashModel) {
        deps.budget.setLimit(flashModel.contextLimit - (flashModel.maxOutputTokens ?? 4096));
      }

      deps.output(`Config updated (${scope}). Changes applied.`);
    } catch (err: any) {
      deps.output(`Invalid JSON: ${err.message}\n\nChanges NOT applied.`);
    }

    // Clean up temp file
    try { const { unlinkSync } = await import("fs"); unlinkSync(tempPath); } catch {}
  }});
  registry.registerSlashCommand({ name: "model", description: "Switch or list models", execute: async (args) => {
    if (args.length) { const ok = deps.switchModel(args[0], args[1]); deps.output(ok ? `Switched to: ${args[0]}` : `Model "${args[0]}" not found.`); }
    else deps.openPanel("model");
  }});
  registry.registerSlashCommand({ name: "stats", description: "Session analytics", execute: async () => deps.openPanel("stats") });
  registry.registerSlashCommand({ name: "context", description: "Context visualizer", execute: async () => deps.openPanel("context") });
  registry.registerSlashCommand({ name: "tools", description: "List available tools", execute: async () => deps.openPanel("tools") });
  registry.registerSlashCommand({ name: "diff", description: "Code diff viewer", execute: async (args) => {
    deps.openPanel("diff");
  }});

  // --- Skills, Agents, MCP ---
  registry.registerSlashCommand({ name: "skills", description: "Skill registry", execute: async (args) => {
    if (!args.length) { deps.openPanel("skills"); return; }
    const { existsSync, mkdirSync, writeFileSync, renameSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const { openInEditor } = await import("../utils/editor.js");

    if (args[0] === "create" && args[1]) {
      const name = args[1];
      const scope = args[2] === "global" ? "global" : "workspace";
      const dir = scope === "workspace"
        ? join(deps.workspaceRoot, ".voidrift", "skills")
        : join(homedir(), ".config", "voidrift", "skills");
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${name}.md`);
      if (existsSync(filePath)) { deps.output(`Skill "${name}" already exists.`); return; }
      writeFileSync(filePath, `---\nname: "${name}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\nagents: []\nactive: true\n---\n\n`, "utf-8");
      if (deps.config.editor) { openInEditor(filePath, deps.config.editor); deps.output(`Created ${name} (${scope}) — editing`); }
      else { deps.output(`Created: ${filePath}`); }
      return;
    }
    if (args[0] === "rename" && args[1] && args[2]) {
      const oldName = args[1];
      const newName = args[2];
      const dirs = [join(deps.workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "skills")];
      for (const dir of dirs) {
        const oldPath = join(dir, `${oldName}.md`);
        const newPath = join(dir, `${newName}.md`);
        if (existsSync(oldPath)) {
          if (existsSync(newPath)) { deps.output(`"${newName}" already exists.`); return; }
          renameSync(oldPath, newPath);
          deps.output(`Renamed: ${oldName} → ${newName}`);
          return;
        }
      }
      deps.output(`Skill "${oldName}" not found.`);
      return;
    }
    deps.output("Usage: /skills | /skills create <name> [global] | /skills rename <old> <new>");
  }});
  registry.registerSlashCommand({ name: "agents", description: "Agent manager", execute: async (args) => {
    if (!args.length) { deps.openPanel("agents"); return; }
    const { existsSync, mkdirSync, writeFileSync, renameSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const { openInEditor } = await import("../utils/editor.js");

    if (args[0] === "create" && args[1]) {
      const id = args[1];
      const type = args[2] === "task" ? "task" : "interactive";
      const scope = args[3] === "global" ? "global" : "workspace";
      const path = deps.agents.createAgent(id, type as any, deps.workspaceRoot, scope as any);
      deps.agents.discover(deps.workspaceRoot);
      if (deps.config.editor) { openInEditor(path, deps.config.editor); deps.output(`Created agent "${id}" (${type}, ${scope}) — editing`); }
      else { deps.output(`Created: ${path}`); }
      return;
    }
    if (args[0] === "rename" && args[1] && args[2]) {
      const oldId = args[1];
      const newId = args[2];
      const { dirname } = await import("path");
      const dirs = [join(deps.workspaceRoot, ".voidrift", "agents"), join(homedir(), ".config", "voidrift", "agents")];
      for (const dir of dirs) {
        const oldDir = join(dir, oldId);
        const newDir = join(dir, newId);
        if (existsSync(oldDir)) {
          if (existsSync(newDir)) { deps.output(`"${newId}" already exists.`); return; }
          renameSync(oldDir, newDir);
          deps.agents.discover(deps.workspaceRoot);
          deps.output(`Renamed: ${oldId} → ${newId}`);
          return;
        }
      }
      deps.output(`Agent "${oldId}" not found.`);
      return;
    }
    deps.output("Usage: /agents | /agents create <id> [task] [global] | /agents rename <old> <new>");
  }});
  registry.registerSlashCommand({ name: "mcp", description: "MCP server manager", execute: async () => deps.openPanel("mcp") });

  // --- Memory ---
  registry.registerSlashCommand({ name: "memory", description: "Memory manager", execute: async () => deps.openPanel("memory") });
  registry.registerSlashCommand({ name: "reflection", description: "Reflect on past sessions — extract lessons into memory", execute: async () => {
    const { ReflectionEngine } = await import("../session/reflector.js");
    const { FileSystemMemoryRepository } = await import("../session/memory-repository.js");
    const { join } = await import("path");
    const memoryDir = join(deps.workspaceRoot, ".voidrift", "memory");
    const memoryRepo = new FileSystemMemoryRepository();
    const reflector = new ReflectionEngine(deps.brain, memoryDir, memoryRepo, deps.bus, deps.config.contextReflectionBatchSize);

    // Use the active model tier
    const tier = deps.agents.active.role;
    const modelKey = tier === "auto"
      ? (deps.agents.active.type === "task" ? "utility" : "flash")
      : tier;
    const isTierKey = modelKey === "flash" || modelKey === "utility" || modelKey === "dense";
    const adapter = isTierKey
      ? createTierAdapter(modelKey as any, deps.config)
      : { client: createTierAdapter("flash", deps.config).client }; // fallback

    deps.output("Starting reflection...");
    const unsub = deps.bus.subscribe("WARNING_EMITTED", (e) => {
      if (e.payload.source === "reflection") deps.output(e.payload.message);
    });
    const result = await reflector.run(adapter.client);
    unsub();
    deps.output(`Reflection complete: ${result.summary}`);
  }});

  // --- Templates & Prompts ---
  registry.registerSlashCommand({ name: "templates", description: "Template manager", execute: async (args) => {
    if (!args.length) { deps.openPanel("templates"); return; }
    const { existsSync, mkdirSync, writeFileSync, renameSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const { openInEditor } = await import("../utils/editor.js");

    if (args[0] === "create" && args[1]) {
      const name = args[1];
      const scope = args[2] === "global" ? "global" : "workspace";
      const dir = scope === "workspace"
        ? join(deps.workspaceRoot, ".voidrift", "templates")
        : join(homedir(), ".config", "voidrift", "templates");
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${name}.md`);
      if (existsSync(filePath)) { deps.output(`Template "${name}" already exists.`); return; }
      writeFileSync(filePath, `---\nname: "${name}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\n---\n\n`, "utf-8");
      if (deps.config.editor) { openInEditor(filePath, deps.config.editor); deps.output(`Created ${name} (${scope}) — editing`); }
      else { deps.output(`Created: ${filePath}`); }
      return;
    }
    if (args[0] === "rename" && args[1] && args[2]) {
      const oldName = args[1];
      const newName = args[2];
      const dirs = [join(deps.workspaceRoot, ".voidrift", "templates"), join(homedir(), ".config", "voidrift", "templates")];
      for (const dir of dirs) {
        const oldPath = join(dir, `${oldName}.md`);
        const newPath = join(dir, `${newName}.md`);
        if (existsSync(oldPath)) {
          if (existsSync(newPath)) { deps.output(`"${newName}" already exists.`); return; }
          renameSync(oldPath, newPath);
          deps.output(`Renamed: ${oldName} → ${newName}`);
          return;
        }
      }
      deps.output(`Template "${oldName}" not found.`);
      return;
    }
    deps.output("Usage: /templates | /templates create <name> [global] | /templates rename <old> <new>");
  }});
  registry.registerSlashCommand({ name: "prompts", description: "Prompt manager", execute: async () => deps.openPanel("prompts") });

  // --- Tasks & Automation ---
  registry.registerSlashCommand({ name: "tasks", description: "Background task monitor", execute: async () => deps.openPanel("tasks") });
  registry.registerSlashCommand({ name: "routines", description: "Repeatable routine manager", execute: async () => deps.openPanel("routines") });
  registry.registerSlashCommand({ name: "run", description: "Autonomous execution", execute: async (args) => {
    if (!args.length) { deps.output("Usage: /run <instruction> | /run routine <name> | /run plan <name>"); return; }
    const subcommand = args[0];

    // Guard: prevent duplicate runs of the same plan/routine/instruction
    if (deps.scheduler) {
      const running = deps.scheduler.all.filter(t => t.status === "running");
      const dedupKey = args.join(" ");
      if (running.some(t => t.instruction.includes(dedupKey))) {
        deps.output(`Already running: ${dedupKey}`);
        return;
      }
    }

    const previousModel = deps.config.modelSelected;
    const backgroundModel = deps.config.modelBackground || "auto";
    const runAdapter = backgroundModel === "auto"
      ? createTierAdapter("flash", deps.config)
      : createAdapter(backgroundModel, deps.config);
    const { ralphLoop } = await import("../orchestration/run.js");

    if (subcommand === "routine") {
      const routineName = args[1];
      if (!routineName) { deps.output("Usage: /run routine <routine-name>"); return; }
      const { existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const routinePath = join(deps.workspaceRoot, ".voidrift", "routines", `${routineName}.md`);
      if (!existsSync(routinePath)) { deps.output(`Routine "${routineName}" not found.`); return; }
      const raw = readFileSync(routinePath, "utf-8");
      const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const routineBody = bodyMatch ? bodyMatch[1].trim() : raw;
      const descMatch = raw.match(/description:\s*(.+)/);
      const description = descMatch ? descMatch[1].trim() : routineName;
      deps.output(`Routine started: ${routineName}`);
      const routineInstruction = `## Routine: ${routineName}\n${description}\n\n${routineBody}\n\nExecute this routine. Work through each step in order. Verify at the end.`;
      const runHandle = deps.scheduler!.registerRun(routineInstruction);
      ralphLoop(routineInstruction, runAdapter.client, deps.bus, (chunk) => {
        if (chunk.type === "status") {
          const task = deps.scheduler!.getTask(runHandle.id);
          if (task) task.output = (task.output ? task.output + "\n" : "") + chunk.message;
        }
      }, runHandle.signal, deps.config.tasksMaxRunTurns, deps.workspaceRoot).then(result => {
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, result.success);
        const task = deps.scheduler!.getTask(runHandle.id);
        if (task) task.output = (task.output ? task.output + "\n" : "") + `Done: ${result.success ? "success" : "failed"} (${result.turns} turns, ${result.terminationReason})`;
      }).catch(err => {
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, false);
        const task = deps.scheduler!.getTask(runHandle.id);
        if (task) task.output = (task.output ? task.output + "\n" : "") + `Error: ${err.message}`;
      });
      return;
    }

    if (subcommand === "plan") {
      const planName = args[1];
      if (!planName) { deps.output("Usage: /run plan <plan-name>"); return; }
      const { existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const planPath = join(deps.workspaceRoot, ".voidrift", "plan", `${planName}.md`);
      if (!existsSync(planPath)) { deps.output(`Plan "${planName}" not found.`); return; }
      const raw = readFileSync(planPath, "utf-8");
      const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const planBody = bodyMatch ? bodyMatch[1].trim() : raw;
      const descMatch = raw.match(/description:\s*(.+)/);
      const description = descMatch ? descMatch[1].trim() : planName;
      deps.output(`Running plan: ${planName}`);
      const planInstruction = `## Plan: ${planName}\n${description}\n\n${planBody}\n\nExecute this plan. Work through each step in order. Verify at the end.`;
      const runHandle = deps.scheduler!.registerRun(planInstruction);
      ralphLoop(planInstruction, runAdapter.client, deps.bus, (chunk) => {
        if (chunk.type === "status") {
          const task = deps.scheduler!.getTask(runHandle.id);
          if (task) task.output = (task.output ? task.output + "\n" : "") + chunk.message;
        }
      }, runHandle.signal, deps.config.tasksMaxRunTurns, deps.workspaceRoot).then(result => {
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, result.success);
        const task = deps.scheduler!.getTask(runHandle.id);
        if (task) task.output = (task.output ? task.output + "\n" : "") + `Done: ${result.success ? "success" : "failed"} (${result.turns} turns, ${result.terminationReason})`;
      }).catch(err => {
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, false);
        const task = deps.scheduler!.getTask(runHandle.id);
        if (task) task.output = (task.output ? task.output + "\n" : "") + `Error: ${err.message}`;
      });
      return;
    }

    // Ad-hoc instruction — generate a plan, then execute it
    const instruction = args.join(" ");
    deps.output(`Running: ${instruction}`);
    const runHandle = deps.scheduler!.registerRun(instruction);

    // Phase 1: Generate plan from instruction using flash
    const planPrompt = `Break this task into concrete steps. Output a numbered checklist. Be specific about files and commands.\n\nTask: ${instruction}`;
    const appendOutput = (msg: string) => {
      const task = deps.scheduler!.getTask(runHandle.id);
      if (task) task.output = (task.output ? task.output + "\n" : "") + msg;
    };

    import("@langchain/core/messages").then(async ({ HumanMessage: HM, SystemMessage: SM }) => {
      try {
        appendOutput("Planning...");
        const planResponse = await runAdapter.client.invoke([
          new SM("You are a planning model. Break the task into a numbered checklist of concrete steps. Be specific about file paths and commands. Keep it under 15 steps."),
          new HM(instruction),
        ], { max_tokens: 1000, temperature: 0 } as any);
        const plan = typeof planResponse.content === "string" ? planResponse.content : "";
        if (!plan.trim()) {
          appendOutput("Failed to generate plan. Running raw instruction.");
        }
        const planInstruction = plan.trim()
          ? `## Plan\n${plan}\n\n## Original Request\n${instruction}\n\nFollow the plan above. Execute each step in order. Verify at the end.`
          : instruction;

        appendOutput("Executing...");
        const result = await ralphLoop(planInstruction, runAdapter.client, deps.bus, (chunk) => {
          if (chunk.type === "status") appendOutput(chunk.message);
        }, runHandle.signal, deps.config.tasksMaxRunTurns, deps.workspaceRoot);
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, result.success);
        appendOutput(`Done: ${result.success ? "success" : "failed"} (${result.turns} turns, ${result.terminationReason})`);
      } catch (err: any) {
        deps.config.modelSelected = previousModel;
        deps.scheduler!.completeRun(runHandle.id, false);
        appendOutput(`Error: ${err.message}`);
      }
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

  // --- Plugins ---
  registry.registerSlashCommand({ name: "plugins", description: "Plugin manager", execute: async () => deps.openPanel("plugins") });

  // --- Policy ---
  registry.registerSlashCommand({ name: "policy", description: "View or add security policy rules", execute: async (args) => {
    if (args.length === 0) { deps.openPanel("policy"); return; }
    if (args[0] === "add" && deps.policyEngine && args.length >= 4) {
      // /policy add <allow|deny> <tool> <pattern>
      const decision = args[1] as "allow" | "deny";
      const tool = args[2];
      const pattern = args.slice(3).join(" ").replace(/^['"]|['"]$/g, "");
      deps.policyEngine.persistRule({ tool, pattern, decision });
      deps.output(`Rule added: ${decision} ${tool} "${pattern}"`);
    } else {
      deps.output("Usage: /policy add <allow|deny> <tool> <pattern>");
    }
  }});

  // --- History ---
  registry.registerSlashCommand({ name: "history", description: "Audit event history", execute: async () => deps.openPanel("history") });
}
