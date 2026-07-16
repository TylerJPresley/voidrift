/**
 * CLI Bootstrap — initializes all subsystems and returns the EngineContext.
 * Separated from UI rendering per SRP.
 */
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import {
  bootstrap,
  ContextManager,
  TokenBudgetWatcher,
  SessionBrain,
  MemoryRegistry,
  PlanManager,
  SkillManager,
  AuditLogger,
  ExceptionGuard,
  StatsTracker,
  TemplateService,
  MCPEngine,
  WorktreeEngine,
  GitCheckpointer,
  CoreRegistry,
  registerCommands,
  setWorkspaceRoot,
  setScheduler,
  setPlanManager,
  generateCodeMap,
  getGitBranch,
  shortenPath,
  AgentRegistry,
  PromptRegistry,
  TaskScheduler,
  CoreAPI,
  PolicyEngine,
} from "../index.js";
import { PluginRegistry, discoverPlugins } from "../plugins/registry.js";
import type { EngineContext } from "../engine.js";
import { validateEditor } from "../utils/editor.js";
import { validateAssets } from "./validate.js";
import { ResourceWatcher } from "../watcher/resources.js";
import { existsSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { basename } from "path";

function validateStartup(config: any): string[] {
  const warnings: string[] = [];
  if (config.editor) {
    const err = validateEditor(config.editor);
    if (err) warnings.push(err);
  }
  return warnings;
}

export async function createEngine(): Promise<EngineContext> {
  const workspaceRoot = process.cwd();
  const sessionId = randomUUID().slice(0, 8);
  const branch = getGitBranch(workspaceRoot);
  const shortPath = shortenPath(workspaceRoot);

  let container;
  try {
    container = await bootstrap({ workspaceRoot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  \x1b[31m✗ VoidRift failed to start\x1b[0m\n\n  ${msg.replace(/\n/g, "\n  ")}\n\n  Fix your config at:\n    Global: ~/.config/voidrift/config.json\n    Local:  ${workspaceRoot}/.voidrift/config.json\n\n`);
    process.exit(1);
  }
  setWorkspaceRoot(workspaceRoot);
  
  // Initialize symbol extractor registry with base extractors
  const { ExtractorRegistry, registerBaseExtractors } = await import("../codemap/extractors.js");
  const { setExtractorRegistry } = await import("../codemap/index.js");
  const extractorRegistry = new ExtractorRegistry(workspaceRoot);
  registerBaseExtractors(extractorRegistry);
  setExtractorRegistry(extractorRegistry);

  const codeMap = generateCodeMap(workspaceRoot);
  const agents = new AgentRegistry(container.bus, new (await import("../agents/repository.js")).FileSystemAgentRepository());
  const templates = new TemplateService(workspaceRoot);
  const prompts = new PromptRegistry(workspaceRoot);
  const mcp = new MCPEngine(workspaceRoot, container.bus);

  // Wire MCP sampling handler
  mcp.setSamplingHandler(async (messages: Array<{ role: string; content: string }>, options?: { maxTokens?: number; temperature?: number }) => {
    const { createTierAdapter } = await import("../adapters/factory.js");
    const { HumanMessage: HM, SystemMessage: SM, AIMessage: AM } = await import("@langchain/core/messages");
    const adapter = createTierAdapter("utility", container.config);
    const lcMessages = messages.map((m: { role: string; content: string }) => {
      if (m.role === "system") return new SM(m.content);
      if (m.role === "assistant") return new AM(m.content);
      return new HM(m.content);
    });
    const response = await adapter.client.invoke(lcMessages);
    const text = typeof response.content === "string" ? response.content : "";
    return { role: "assistant", content: text };
  });

  // Wire MCP elicitation handler
  mcp.setElicitationHandler(async (message: string) => {
    return new Promise((resolve) => {
      const requestId = `elicit-${Date.now()}`;
      container.bus.publish("TOOL_CONFIRMATION_REQUEST", { tool: "mcp_elicitation", args: { message }, requestId, inferredPatterns: [] } as any);
      const unsub = container.bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (event: any) => {
        if (event.payload.requestId === requestId) {
          unsub();
          resolve(event.payload.approved ? { action: "accept" } : { action: "deny" });
        }
      });
      setTimeout(() => { unsub(); resolve({ action: "deny" }); }, 120_000);
    });
  });

  // Auto-connect MCP servers
  for (const cfg of mcp.loadConfigs()) {
    if ((cfg as any).autoConnect !== false) {
      mcp.connect(cfg).catch(() => {});
    }
  }

  const worktree = new WorktreeEngine(workspaceRoot, container.bus);
  const checkpointer = new GitCheckpointer(workspaceRoot, container.bus);
  checkpointer.attach();

  // Skills
  const skills = new SkillManager(new (await import("../skills/repository.js")).FileSystemSkillRepository());
  const { registerBuiltinSkills } = await import("../skills/builtins.js");
  registerBuiltinSkills(skills);

  // Plugin loading
  const startupWarnings: string[] = [];
  templates.setActivePlugins(container.config.plugins);
  const pluginRegistry = new PluginRegistry();
  const discovered = discoverPlugins(workspaceRoot);
  const activePluginIds = new Set(container.config.plugins);

  for (const dp of discovered) {
    const isActive = activePluginIds.has(dp.id);
    if (!isActive) {
      pluginRegistry.register({ id: dp.id, name: dp.id, version: dp.version, description: dp.description, author: dp.author, license: dp.license, homepage: dp.homepage, active: false, commands: [], agents: [], modes: [], templates: [], prompts: [], skills: [] });
      continue;
    }
    try {
      const pluginInterface = new CoreAPI(container.registry, container.bus, worktree, workspaceRoot, templates, agents, prompts, undefined, skills, dp.id, extractorRegistry);
      const mod = await import(dp.id);
      if (typeof mod.register === "function") mod.register(pluginInterface);
      const cmds = container.registry.listSlashCommandHooks().filter(c => c.source === dp.id);
      pluginRegistry.register({
        id: dp.id, name: mod.name || dp.id, version: dp.version, description: dp.description,
        author: dp.author, license: dp.license, homepage: dp.homepage, active: true,
        commands: cmds.map(c => c.name),
        agents: agents.listInteractive().filter(a => a.source === dp.id).map(a => a.id),
        modes: [], templates: [], prompts: [], skills: [],
      });
    } catch (err: any) {
      startupWarnings.push(`Plugin "${dp.id}" failed to load: ${err.message}`);
    }
  }

  agents.discover(workspaceRoot);
  const activeAgent = agents.active;
  const basePrompt = prompts.resolve("chat")?.body || "";
  const startupPersona = activeAgent.prompt ? `${activeAgent.prompt}\n\n${basePrompt}` : basePrompt;
  const context = new ContextManager(startupPersona, codeMap);
  context.setTools(activeAgent.tools);
  // Compile on-demand tool TOC (shows model what exotic tools exist beyond the baseline)
  const { compileOnDemandTOC } = await import("../orchestration/tool-binding.js");
  const mcpToolSummary = mcp.connected.map(s => ({ name: s.name, tools: s.tools.map(t => ({ name: t.name, description: t.description })) }));
  context.context.agent.onDemandToolTOC = compileOnDemandTOC(activeAgent.tools, mcpToolSummary.length ? mcpToolSummary : undefined);
  const flashModel = container.config.models[container.config.modelTierFlash];
  const inputBudget = (flashModel?.contextLimit ?? 128000) - (flashModel?.maxOutputTokens ?? 4096);
  const budget = new TokenBudgetWatcher(inputBudget);
  const brain = new SessionBrain(workspaceRoot, sessionId, container.bus, new (await import("../session/session-repository.js")).FileSystemSessionRepository(workspaceRoot));
  const memory = new MemoryRegistry(new (await import("../session/memory-repository.js")).FileSystemMemoryRepository());
  const planManager = new PlanManager(new (await import("../session/plan-repository.js")).FileSystemPlanRepository(workspaceRoot));
  const { RoutineManager } = await import("../session/routine.js");
  const { FileSystemRoutineRepository } = await import("../session/routine-repository.js");
  const routineManager = new RoutineManager(new FileSystemRoutineRepository(workspaceRoot));
  const logger = new AuditLogger({ workspaceRoot, sessionId });
  const policyEngine = new PolicyEngine(workspaceRoot);
  const guard = new ExceptionGuard(container.bus, context);
  const stats = new StatsTracker(sessionId);
  const scheduler = new TaskScheduler(container.bus, (instruction) => {
    container.bus.publish("USER_INPUT", { text: `[Scheduled] ${instruction}` });
  });
  setScheduler(scheduler);
  setPlanManager(planManager);

  // Inject persisted plan
  const compiledPlan = planManager.compileActivePlanSummary();
  if (compiledPlan) context.setPlan(compiledPlan);

  // Index skills and memory
  skills.index([join(workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "resources", "skills")]);
  context.setSkillDiscoveryIndex(skills.indexedSkills.map(s => `- ${s.name}: ${s.description}`));
  memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
  // Auto-load directive memories into Orbit (always in context)
  for (const body of memory.loadDirectiveBodies()) {
    context.loadMemory(body);
  }
  // Note: MEMORY_LOADED events for directive memories are bulk-loaded at startup, not individually emitted
  logger.attach(container.bus);
  brain.attach(() => context.context, () => agents.active.id);

  // ─── TURN_BEFORE subscribers (registration order = execution order) ───────

  // 1. Message decay — summarize old turns to free context budget
  container.bus.subscribe("TURN_BEFORE", async () => {
    const decayAfter = container.config.contextDecayAfterTurns ?? 20;
    if (decayAfter > 0) {
      const msgs = context.getMessages();
      const userCount = msgs.filter(m => m.role === "user").length;
      if (userCount > decayAfter) {
        const { compactHistory } = await import("../session/compactor.js");
        const result = compactHistory(msgs, budget.state.used, budget.state.limit * 0.5, container.config.contextKeepRecentTurns);
        if (result.compacted) {
          context.setMessages(result.messages);
          container.bus.publish("CONTEXT_COMPACTED", { beforeCount: msgs.length, afterCount: result.messages.length, freedTokens: (msgs.length - result.messages.length) * 50 });
        }
      }
    }
  }, { priority: "high" });

  // 2. Context pressure — staged compaction with graduated response
  container.bus.subscribe("TURN_BEFORE", async () => {
    const contextPct = budget.getContextPct(context.getTokenCount());

    if (contextPct < 50) return;

    // Stage 1 (50%): warn model to be concise
    if (contextPct >= 50 && contextPct < 70) {
      context.injectTurnContext("Context Budget", `Context usage: ${contextPct}%. Be concise. Avoid loading large files without offset/limit.`);
      container.bus.publish("CONTEXT_PRESSURE", { percentage: contextPct, level: "warning" });
      return;
    }

    // Stage 2 (70%): mask old tool results to one-line summaries
    if (contextPct >= 70 && contextPct < 80) {
      const msgs = context.getMessages();
      let masked = 0;
      const cutoff = msgs.length - 10; // keep last 10 messages untouched
      for (let i = 0; i < cutoff; i++) {
        if (msgs[i].role === "tool" && msgs[i].content.length > 200) {
          msgs[i] = { ...msgs[i], content: msgs[i].content.slice(0, 100) + "... [masked — context pressure]" };
          masked++;
        }
      }
      if (masked > 0) {
        context.setMessages(msgs);
        container.bus.publish("CONTEXT_COMPACTED", { beforeCount: msgs.length, afterCount: msgs.length, freedTokens: masked * 200 });
      }
      // Staleness report
      const report = buildStalenessReport(planManager, memory, context);
      const budgetMsg = `Context usage: ${contextPct}%. Old tool results masked. Be concise.` + (report ? `\n\n${report}` : "");
      context.injectTurnContext("Context Budget", budgetMsg);
      container.bus.publish("CONTEXT_PRESSURE", { percentage: contextPct, level: "warning" });
      return;
    }

    // Stage 3 (80%): prune oldest turns (keep summaries via compactHistory)
    if (contextPct >= 80 && contextPct < 90) {
      const msgs = context.getMessages();
      const { compactHistory } = await import("../session/compactor.js");
      const result = compactHistory(msgs, budget.state.used, budget.state.limit * 0.7, container.config.contextKeepRecentTurns);
      if (result.compacted) {
        context.setMessages(result.messages);
        container.bus.publish("CONTEXT_COMPACTED", { beforeCount: msgs.length, afterCount: result.messages.length, freedTokens: (msgs.length - result.messages.length) * 50 });
      }
      const report = buildStalenessReport(planManager, memory, context);
      const budgetMsg = `⚠️ Context usage: ${contextPct}% — old turns pruned. Summarize rather than quote. Avoid new file reads unless essential.` + (report ? `\n\n${report}` : "");
      context.injectTurnContext("Context Budget", budgetMsg);
      container.bus.publish("CONTEXT_PRESSURE", { percentage: contextPct, level: "critical" });
      return;
    }

    // Stage 4 (90%+): aggressive — prune to last 6 turns + summary
    if (contextPct >= 90) {
      const msgs = context.getMessages();
      const { compactHistory } = await import("../session/compactor.js");
      const result = compactHistory(msgs, budget.state.used, budget.state.limit * 0.5, container.config.contextKeepRecentTurns);
      if (result.compacted) {
        context.setMessages(result.messages);
        container.bus.publish("CONTEXT_COMPACTED", { beforeCount: msgs.length, afterCount: result.messages.length, freedTokens: (msgs.length - result.messages.length) * 50 });
      }
      const report = buildStalenessReport(planManager, memory, context);
      const budgetMsg = `🚨 Context usage: ${contextPct}% — critically high. History aggressively compacted. Consider calling \`escalate\` to switch to a model with a larger context window.` + (report ? `\n\n${report}` : "");
      context.injectTurnContext("Context Budget", budgetMsg);
      container.bus.publish("CONTEXT_PRESSURE", { percentage: contextPct, level: "critical" });
    }
  }, { priority: "high" });

  // 3. Skill resolution (stateless — each turn evaluates from scratch)
  container.bus.subscribe("TURN_BEFORE", async (event) => {
    const resolvedSkills = skills.resolveMatchingSkillContent(
      {
        focusedFiles: context.context.drift.focusedFiles.map(f => f.path),
        userInput: event.payload.userMessage,
        activePlan: context.context.orbit.activePlan,
      },
      agents.active.id,
    );
    context.setActiveSkills(resolvedSkills);
  }, { priority: "normal" });

  // ─── TURN_AFTER subscribers (registration order = execution order) ──────

  // 2. Escalation check — handle model-requested and automatic escalation
  container.bus.subscribe("TURN_AFTER", async (event) => {
    const toolNames = event.payload.toolsUsed;
    if (toolNames.includes("escalate") && container.config.modelSelected !== "dense") {
      const from = container.config.modelSelected;
      container.config.modelSelected = "dense";
      agents.active.autoEscalated = false;
      container.bus.publish("MODEL_ESCALATED", { from, to: "dense", reason: "model-requested", auto: false });
    } else if (toolNames.includes("deescalate")) {
      const from = container.config.modelSelected;
      container.config.modelSelected = "auto";
      agents.active.autoEscalated = false;
      container.bus.publish("MODEL_DEESCALATED", { from, to: "auto" });
    } else if (container.config.modelSelected === "auto") {
      // Automatic escalation: context overflow (only when on auto)
      const tier = agents.active.type === "task" ? "utility" : "flash";
      const modelConfig = container.config.models[tier === "flash" ? container.config.modelTierFlash : tier === "utility" ? container.config.modelTierUtility : container.config.modelTierDense];
      const contextLimit = modelConfig?.contextLimit ?? 32768;
      const { shouldEscalate, escalateTier } = await import("../router/index.js");
      if (shouldEscalate(budget.state.used, contextLimit, 0)) {
        const next = escalateTier(tier as any);
        if (next) {
          container.config.modelSelected = next;
          agents.active.autoEscalated = true;
          container.bus.publish("MODEL_ESCALATED", { from: tier, to: next, reason: "context-overflow", auto: true });
        }
      }
    }
  }, { priority: "high" });

  // 3. Stats recording — track turn metrics from TURN_AFTER payload
  container.bus.subscribe("TURN_AFTER", async (event) => {
    if (event.payload.model && event.payload.usage) {
      stats.recordTurn(
        event.payload.model,
        event.payload.usage.promptTokens,
        event.payload.usage.completionTokens,
        0,
        event.payload.timingMs || 0,
      );
    }
  }, { priority: "background" });

  // 4. Context summary — fire-and-forget, generates one-sentence recap for next turn's preflight
  container.bus.subscribe("TURN_AFTER", async (event) => {
    const { createTierAdapter: cta } = await import("../adapters/factory.js");
    const summaryClient = cta("utility", container.config).client;
    const userSlice = event.payload.userMessage.slice(0, 150);
    const assistantSlice = event.payload.responseText.slice(0, 300);
    const toolsUsed = event.payload.toolsUsed.join(", ");
    summaryClient.invoke([
      new (await import("@langchain/core/messages")).SystemMessage(
        "Summarize what happened this turn in one sentence (max 20 words). Include: the task, files affected, and current state (waiting for approval, completed, in progress)."
      ),
      new (await import("@langchain/core/messages")).HumanMessage(
        `User: "${userSlice}"\nAssistant: "${assistantSlice}"${toolsUsed ? `\nTools used: ${toolsUsed}` : ""}`
      ),
    ], { max_tokens: 40, temperature: 0 } as any).then(res => {
      const summary = typeof res.content === "string" ? res.content.trim() : "";
      if (summary) {
        const msgs = context.getMessages();
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") lastMsg.summary = summary;
      }
    }).catch(() => {});
  }, { priority: "background" });

  // Bridge AGENT_ACTIVATED → MODE_CHANGED for backward compat (serve.ts)
  container.bus.subscribe("AGENT_ACTIVATED", (e) => {
    container.bus.publish("MODE_CHANGED", { previousMode: (e.payload as any).from, newMode: (e.payload as any).to });
  });

  // Plan feedback loop — learn from completed plans
  const planFeedbackLevel = container.config.tasksPlanFeedbackLoop ?? 1;
  if (planFeedbackLevel > 0) {
    let sessionErrors = 0;
    container.bus.subscribe("AFTER_TOOL_EXECUTE", (e) => {
      if (e.payload.status === "error") sessionErrors++;
    });
    container.bus.subscribe("PLAN_ITEM_REMOVED", async (e) => {
      // Level 1: only fire if errors/retries occurred
      if (planFeedbackLevel === 1 && sessionErrors === 0) return;
      // Synthesize a learning from the completed plan
      try {
        const { createTierAdapter: cta } = await import("../adapters/factory.js");
        const client = cta("utility", container.config).client;
        const planName = (e.payload as any).name || "unknown";
        const errorCount = sessionErrors;
        const recentMsgs = context.getMessages().slice(-20);
        const turnSummary = recentMsgs
          .filter(m => m.role === "assistant" && m.summary)
          .map(m => m.summary)
          .slice(-5)
          .join("; ");

        const { HumanMessage: HM, SystemMessage: SM } = await import("@langchain/core/messages");
        const response = await client.invoke([
          new SM("You extract a single reusable lesson from completed work. Output ONE paragraph (2-3 sentences max): what was the task, what approach worked (or failed then succeeded), and what should be remembered for next time. No preamble."),
          new HM(`Plan "${planName}" was completed. ${errorCount} errors occurred during execution. Recent activity: ${turnSummary}`),
        ], { max_tokens: 100, temperature: 0 } as any);

        const lesson = typeof response.content === "string" ? response.content.trim() : "";
        if (lesson && lesson.length > 20) {
          container.bus.publish("WARNING_EMITTED", {
            message: `📝 Lesson learned: ${lesson.slice(0, 120)}... — Save as memory? (use save_memory)`,
            source: "plan-feedback",
            category: "suggestion",
          });
        }
      } catch {}
    });
  }

  // Wire stats tracking to tool events
  const toolStartTimes = new Map<string, number>();
  container.bus.subscribe("BEFORE_TOOL_EXECUTE", (e) => {
    toolStartTimes.set(e.payload.toolName + JSON.stringify(e.payload.arguments), Date.now());
  });
  container.bus.subscribe("AFTER_TOOL_EXECUTE", (e) => {
    const key = e.payload.toolName + JSON.stringify(e.payload.arguments);
    const startTime = toolStartTimes.get(key) || Date.now();
    toolStartTimes.delete(key);
    stats.recordToolCall(e.payload.status === "success", Date.now() - startTime, e.payload.toolName);
    container.bus.publish("CONTEXT_BUDGET_UPDATED", { used: budget.state.used, limit: budget.state.limit, percentage: budget.state.percentage });
  });

  // Record tool executions to fullHistory for session resume
  container.bus.subscribe("AFTER_TOOL_EXECUTE", (e) => {
    const output = e.payload.output.length > 500 ? e.payload.output.slice(0, 500) + "..." : e.payload.output;
    context.context.void.fullHistory.push({
      role: "tool",
      content: `[${e.payload.toolName}] ${output}`,
      timestamp: Date.now(),
    });
  });

  container.bus.publish("SESSION_START", { workspaceRoot, globalConfig: container.config as any });

  // Retention cleanup — background purge of old cache/sessions/logs (non-blocking)
  import("./retention.js").then(({ runRetention }) => {
    runRetention(workspaceRoot, ({ maxCacheAgeDays: container.config.retentionMaxCacheAgeDays, maxSessionCount: container.config.retentionMaxSessionCount, maxLogAgeDays: container.config.retentionMaxLogAgeDays }));
  }).catch(() => {});

  // Trace analyzer — learns from failure patterns and suggests improvements
  const { TraceAnalyzer } = await import("../orchestration/trace-analyzer.js");
  const traceAnalyzer = new TraceAnalyzer(container.bus, container.config.turnsSuggestionThreshold);
  traceAnalyzer.attach();

  // File watcher → re-index on changes
  let reindexTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReindex = (path: string) => {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => {
      // Invalidate symbol cache for the changed file
      extractorRegistry.invalidate(path);
      context.setCodeMap(generateCodeMap(workspaceRoot));
      container.bus.publish("CODEMAP_UPDATED", { fileCount: 0, dirCount: 0 } as any);
      container.bus.publish("FILE_INDEXED", { path, symbolCount: 0 } as any);
      if (path.includes(".voidrift/memory") || path.includes(".voidrift\\memory")) {
        memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
      }
      // Flush symbol cache periodically
      extractorRegistry.flush();
    }, 2000);
  };
  container.bus.subscribe("FILE_MODIFIED", (e) => scheduleReindex(e.payload.path));
  container.bus.subscribe("FILE_CREATED", (e) => { scheduleReindex(e.payload.path); mcp.notifyRootsChanged(); });
  container.bus.subscribe("FILE_DELETED", (e) => { scheduleReindex(e.payload.path); mcp.notifyRootsChanged(); });

  // Resource watcher
  const resourceWatcher = new ResourceWatcher(workspaceRoot, join(homedir(), ".config", "voidrift"), container.bus);
  resourceWatcher.start().catch(() => {});
  container.bus.subscribe("RESOURCE_CHANGED", (e) => {
    const { type, path: changedPath } = e.payload;

    // Validate changed files — reject invalid edits
    if (changedPath && existsSync(changedPath) && !changedPath.includes("/cache/")) {
      const { validateResourceFile } = require("../utils/safe-edit.js");
      const validation = validateResourceFile(changedPath, type);
      if (validation && !validation.valid) {
        // Move bad file to cache with unique name
        const ext = changedPath.split(".").pop() || "md";
        const cachePath = join(workspaceRoot, ".voidrift", "cache", `rejected-${Date.now().toString(36)}.${ext}`);
        mkdirSync(join(workspaceRoot, ".voidrift", "cache"), { recursive: true });
        copyFileSync(changedPath, cachePath);
        // Restore from snapshot if available, otherwise delete the bad file
        const snapshotPath = join(workspaceRoot, ".voidrift", "cache", `snapshot-${basename(changedPath)}`);
        if (existsSync(snapshotPath)) {
          copyFileSync(snapshotPath, changedPath);
          unlinkSync(snapshotPath);
        } else {
          unlinkSync(changedPath);
        }
        container.bus.publish("WARNING_EMITTED", {
          message: `⚠️ Changes rejected: ${validation.errors?.join(", ")}. Your edit saved to: ${cachePath.replace(workspaceRoot + "/", "")}`,
          source: "validation",
          category: "error",
        });
        return; // Don't re-index broken file
      }
    }

    if (type === "skill") skills.index([join(workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "skills")]);
    if (type === "agent") agents.discover(workspaceRoot);
    if (type === "template") templates.discover();
  });

  // Event hooks — run shell commands on bus events
  const hooks = container.config.hooks || {};
  for (const [event, commands] of Object.entries(hooks)) {
    container.bus.subscribe(event as any, (e) => {
      for (const cmd of commands) {
        import("child_process").then(({ exec }) => {
          exec(cmd, { cwd: workspaceRoot, timeout: 10000, env: { ...process.env, VOIDRIFT_EVENT: event, VOIDRIFT_PAYLOAD: JSON.stringify(e.payload) } });
        });
      }
    });
  }

  // Command registration
  let cmdOutputFn: (text: string) => void = () => {};
  let openPanelFn: (panel: string) => void = () => {};

  registerCommands(container.registry, {
    config: container.config, context, budget, agents, brain, memory, stats,
    skills, templates, mcp, worktree, scheduler, checkpointer, bus: container.bus, workspaceRoot, sessionId,
    policyEngine, logger,
    output: (text) => cmdOutputFn(text),
    openPanel: (panel) => openPanelFn(panel),
    switchModel: (name) => {
      if (!container.config.models[name]) return false;
      budget.setLimit(container.config.models[name].contextLimit);
      return true;
    },
    exit: () => { process.stdout.write("\x1B[?25h"); process.exit(0); },
  });

  return {
    container, context, budget, agents, prompts, guard, stats, memory, skills, mcp, templates, logger,
    worktree, scheduler, checkpointer, planManager, routineManager, brain, sessionId, pluginRegistry, policyEngine,
    branch, shortPath, workspaceRoot,
    startupWarnings: [...startupWarnings, ...validateStartup(container.config), ...validateAssets(agents, skills).map(i => `[${i.type}] ${i.id}: ${i.message}`)],
    setCmdOutput: (fn: (text: string) => void) => { cmdOutputFn = fn; },
    setOpenPanel: (fn: (panel: string) => void) => { openPanelFn = fn; },
  };
}

// ─── Staleness Report ────────────────────────────────────────────────────────

function buildStalenessReport(
  planManager: import("../session/plan.js").PlanManager,
  memory: import("../session/memory.js").MemoryRegistry,
  context: import("../session/context.js").ContextManager,
): string | null {
  const parts: string[] = [];

  // Check plans not referenced in recent messages
  const plans = planManager.all();
  if (plans.length > 0) {
    const msgs = context.getMessages();
    const recentText = msgs.slice(-20).map(m => m.content).join(" ").toLowerCase();
    const stalePlans = plans.filter(p => !recentText.includes(p.filename.replace(".md", "").toLowerCase()));
    if (stalePlans.length > 0) {
      parts.push(`Stale plans (not referenced in recent turns): ${stalePlans.map(p => p.filename.replace(".md", "")).join(", ")}`);
    }
  }

  // Check loaded memories not triggered by recent context
  const activeMemory = context.context.orbit.activeMemory;
  if (activeMemory.length > 0) {
    const msgs = context.getMessages();
    const recentText = msgs.slice(-10).map(m => m.content).join(" ").toLowerCase();
    const allMeta = memory.all;
    const unreferenced = allMeta.filter(m => {
      const keywords = m.context.keywords || [];
      return keywords.length > 0 && !keywords.some(kw => recentText.includes(kw.toLowerCase()));
    });
    if (unreferenced.length > 0) {
      parts.push(`Memories not triggered by recent context: ${unreferenced.map(m => m.title).join(", ")}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
