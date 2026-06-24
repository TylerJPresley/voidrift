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
  const codeMap = generateCodeMap(workspaceRoot);
  const agents = new AgentRegistry();
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
  const skills = new SkillManager();
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
      const pluginInterface = new CoreAPI(container.registry, container.bus, worktree, workspaceRoot, templates, agents, prompts, undefined, skills, dp.id);
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
  const flashModel = container.config.models[container.config.tiers.flash];
  const inputBudget = (flashModel?.contextLimit ?? 128000) - (flashModel?.maxOutputTokens ?? 4096);
  const budget = new TokenBudgetWatcher(inputBudget);
  const brain = new SessionBrain(workspaceRoot, sessionId, container.bus);
  const memory = new MemoryRegistry();
  const planManager = new PlanManager(workspaceRoot);
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
  const compiledPlan = planManager.compile();
  if (compiledPlan) context.setPlan(compiledPlan);

  // Index skills and memory
  skills.index([join(workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "resources", "skills")]);
  context.setSkillDiscoveryIndex(skills.indexed.map(s => `- ${s.name}: ${s.description}`));
  memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
  // Auto-load directive memories into Orbit (always in context)
  for (const body of memory.loadDirectiveBodies()) {
    context.loadMemory(body);
  }
  logger.attach(container.bus);
  brain.attach(() => context.context, () => agents.active.id);

  // Wire stats tracking to tool events
  const toolStartTimes = new Map<string, number>();
  container.bus.subscribe("BEFORE_TOOL_EXECUTE", (e) => {
    toolStartTimes.set(e.payload.toolName + JSON.stringify(e.payload.arguments), Date.now());
  });
  container.bus.subscribe("AFTER_TOOL_EXECUTE", (e) => {
    const key = e.payload.toolName + JSON.stringify(e.payload.arguments);
    const startTime = toolStartTimes.get(key) || Date.now();
    toolStartTimes.delete(key);
    stats.recordToolCall(e.payload.status === "success", Date.now() - startTime);
  });

  container.bus.publish("SESSION_START", { workspaceRoot, globalConfig: container.config as any });

  // File watcher → re-index on changes
  let reindexTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReindex = (path: string) => {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => {
      context.setCodeMap(generateCodeMap(workspaceRoot));
      if (path.includes(".voidrift/memory") || path.includes(".voidrift\\memory")) {
        memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
      }
    }, 2000);
  };
  container.bus.subscribe("FILE_MODIFIED", (e) => scheduleReindex(e.payload.path));
  container.bus.subscribe("FILE_CREATED", (e) => { scheduleReindex(e.payload.path); mcp.notifyRootsChanged(); });
  container.bus.subscribe("FILE_DELETED", (e) => { scheduleReindex(e.payload.path); mcp.notifyRootsChanged(); });

  // Resource watcher
  const resourceWatcher = new ResourceWatcher(workspaceRoot, join(homedir(), ".config", "voidrift"), container.bus);
  resourceWatcher.start().catch(() => {});
  container.bus.subscribe("RESOURCE_CHANGED", (e) => {
    const { type } = e.payload;
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
    worktree, scheduler, checkpointer, planManager, brain, sessionId, pluginRegistry, policyEngine,
    branch, shortPath, workspaceRoot,
    startupWarnings: [...startupWarnings, ...validateStartup(container.config), ...validateAssets(agents, skills).map(i => `[${i.type}] ${i.id}: ${i.message}`)],
    setCmdOutput: (fn: (text: string) => void) => { cmdOutputFn = fn; },
    setOpenPanel: (fn: (panel: string) => void) => { openPanelFn = fn; },
  };
}
