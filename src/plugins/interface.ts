import type { CoreRegistry } from "../registry/core.js";
import type { EventBus } from "../events/bus.js";
import type { WorktreeEngine } from "../worktree/engine.js";
import type { TemplateService } from "../templates/service.js";
import type { AgentRegistry, AgentManifest } from "../agents/registry.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { ContextManager } from "../session/context.js";
import type { EngineContext } from "../engine.js";
import { generateCodeMap } from "../codemap/index.js";
import { executeCommand } from "../tools/executors.js";
import { TOOL_SCHEMAS } from "../tools/definitions.js";
import { activateAgent } from "../use-cases/activate-agent.js";
import { fsResourceLoader } from "../infrastructure/resource-loader.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { safeConfigWrite } from "../config/writer.js";
import { openInEditor } from "../utils/editor.js";
import { editWithValidation, validateJSON, validateFrontmatter, validateSkillFile, validatePromptFile } from "../utils/safe-edit.js";
import { execSync } from "child_process";
import type {
  AgentDTO, AgentListResult, AgentGetResult,
  PlanItemDTO, PlanListResult, PlanGetResult,
  SkillDTO, SkillListResult,
  TemplateDTO, TemplateListResult, TemplateGetResult,
  PromptDTO, PromptListResult, PromptGetResult,
  MCPServerDTO, MCPServerListResult,
  MemoryDTO, MemoryListResult,
  ModelInfo, ModelListResult, StatsResult, ContextStatsResult,
  SendInputParams, SendInputResult,
  ConfirmToolParams,
  AddPlanItemInput, UpdatePlanPriorityInput, UpdatePlanBodyInput,
  ModelSwitchParams,
  ContextDetailResult,
} from "../operator/dto.js";

export interface PanelColumn {
  key: string;
  label: string;
  width?: number;
}

export interface PanelAction {
  label: string;
  handler: (item: any) => void | Promise<void>;
}

export interface PanelDefinition {
  title: string;
  columns: PanelColumn[];
  getItems: () => any[];
  actions?: Record<string, PanelAction>;
}

/**
 * Core API.
 *
 * The single public interface for VoidRift. Used by:
 * - Plugins (registration + data)
 * - TUI panels (data + mutations)
 * - VS Code extension (over JSON-RPC)
 * - Electron app (over IPC)
 * - CLI headless mode
 *
 * One API, many clients.
 */
export class CoreAPI {
  private _output: (text: string) => void = () => {};
  private _openPanel: (name: string) => void = () => {};
  private panels = new Map<string, PanelDefinition>();
  private __engine?: EngineContext;
  private abortController: AbortController | null = null;

  constructor(
    public registry: CoreRegistry,
    private bus: EventBus,
    private worktree: WorktreeEngine,
    private workspaceRoot: string,
    private templateService?: TemplateService,
    private agentRegistry?: AgentRegistry,
    private promptRegistry?: PromptRegistry,
    private contextManager?: ContextManager,
    private skillManager?: import("../skills/manager.js").SkillManager,
    private pluginName: string = "plugin",
    private extractorRegistry?: import("../codemap/extractors.js").ExtractorRegistry,
  ) {}

  /** Bind the full engine context. Unlocks all data/mutation methods. */
  bindEngine(engine: EngineContext): void {
    this.__engine = engine;
  }

  private get engine(): EngineContext {
    if (!this.__engine) throw new Error("CoreAPI: engine not bound. Call bindEngine() first.");
    return this.__engine;
  }

  /** Called by the TUI to wire output/panel callbacks. */
  setOutputHandler(fn: (text: string) => void): void { this._output = fn; }
  setPanelHandler(fn: (name: string) => void): void { this._openPanel = fn; }
  setContextManager(ctx: ContextManager): void { this.contextManager = ctx; }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAMESPACES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Registration — extend the harness */
  get register() {
    return {
      command: (name: string, description: string, handler: (args: string[]) => Promise<void>) => {
        this.registry.registerSlashCommand({ name, description, source: this.pluginName, execute: handler });
      },
      agent: (manifest: AgentManifest) => {
        this.agentRegistry?.register(manifest, this.pluginName);
      },
      skill: (entry: { name: string; description: string; triggers: { extensions?: string[]; files?: string[]; keywords?: string[] }; agents: string[]; content: string; active?: boolean; sourcePlugin: string }) => {
        this.skillManager?.register({ ...entry, active: entry.active !== false });
      },
      extractor: (extractor: import("../codemap/extractors.js").SymbolExtractor) => {
        this.extractorRegistry?.register(extractor, this.pluginName);
      },
      guardrail: (fn: import("../orchestration/guardrails.js").Guardrail) => {
        import("../orchestration/guardrails.js").then(({ registerGuardrail }) => registerGuardrail(fn));
      },
      prompt: (key: string, content: string, label?: string, description?: string) => {
        this.promptRegistry?.register(key, content, this.pluginName, label, description);
      },
      template: (key: string, content: string, label?: string, description?: string) => {
        this.templateService?.register(key, "template", content, this.pluginName, label, description);
      },
      panel: (name: string, definition: PanelDefinition) => {
        this.panels.set(name, definition);
      },
      agentProvider: (key: string, provider: () => string | null) => {
        import("../session/providers.js").then(({ registerContextProvider }) => registerContextProvider("agent", key, provider));
      },
      orbitProvider: (key: string, provider: () => string | null) => {
        import("../session/providers.js").then(({ registerContextProvider }) => registerContextProvider("orbit", key, provider));
      },
      driftProvider: (key: string, provider: () => string | null) => {
        import("../session/providers.js").then(({ registerContextProvider }) => registerContextProvider("drift", key, provider));
      },
    };
  }

  /** Events — pub/sub on the bus */
  get events() {
    return {
      register: (name: string) => { this.bus.registerEvent(name); },
      subscribe: (eventType: string, handler: (event: any) => void, opts?: { priority?: import("../events/bus.js").EventPriority }) => {
        return this.bus.subscribe(eventType as any, handler, opts);
      },
      emit: (key: string, payload: Record<string, unknown>) => {
        this.bus.publish(key as any, payload as any);
      },
    };
  }

  /** Session — turn lifecycle */
  get session() {
    return {
      id: this.__engine?.sessionId ?? "",
      warnings: this.__engine?.startupWarnings ?? [],
      send: async (params: SendInputParams): Promise<SendInputResult> => {
        const { executeTurn } = await import("../turn.js");
        const turnId = `turn-${Date.now().toString(36)}`;
        this.abortController = new AbortController();
        executeTurn(this.engine, params.text, {
          onChunk: (chunk) => {
            if (chunk.type === "content" && (chunk as any).text) {
              this.bus.publish("TOKEN_STREAM", { token: (chunk as any).text, done: false });
            }
            if (chunk.type === "done") {
              this.bus.publish("TOKEN_STREAM", { token: "", done: true, usage: (chunk as any).usage });
            }
            if (chunk.type === "error") {
              this.bus.publish("ERROR_OCCURRED", { message: (chunk as any).message, source: "model" });
            }
          },
          signal: this.abortController.signal,
        });
        return { turnId };
      },
      execute: async (text: string, callbacks: { onChunk: (chunk: any) => void; signal?: AbortSignal }) => {
        const { executeTurn } = await import("../turn.js");
        return executeTurn(this.engine, text, callbacks);
      },
      cancel: () => { this.abortController?.abort(); this.abortController = null; },
      clear: () => { this.engine.context.setMessages([]); this.engine.context.setFullHistory([]); this.engine.context.clearFocusedFiles(); },
      compact: () => { const msgs = this.engine.context.getMessages(); return { before: msgs.length, after: this.engine.context.getMessages().length }; },
      confirm: (params: ConfirmToolParams) => { this.bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: params.approved, requestId: params.requestId, persist: params.persist, chosenPattern: params.chosenPattern }); },
      resume: (sessionId: string) => {
        const success = this.engine.brain.loadSession(sessionId, this.engine.context);
        if (!success) return { success: false, turnCount: 0 };
        const messages = this.engine.context.getMessages();
        const turnCount = messages.filter(m => m.role === "user").length;
        this.bus.publish("SESSION_RESUMED", { sessionId, turnCount });
        return { success: true, turnCount };
      },
      list: () => this.engine.brain.listSessions(),
      /** Load messages from a specific session without resuming it */
      loadMessages: (sessionId: string): Array<{ role: string; content: string }> => {
        const msgsPath = join(this.workspaceRoot, ".voidrift", "sessions", sessionId, "work.messages.json");
        if (!existsSync(msgsPath)) return [];
        try { return JSON.parse(readFileSync(msgsPath, "utf-8")); } catch { return []; }
      },
      rewind: (turn: number) => { this.engine.context.setMessages(this.engine.context.getMessages().slice(0, turn * 2)); this.engine.checkpointer.rollbackTo(turn); },
      command: async (name: string, args: string[] = []) => {
        const handler = this.registry.getSlashCommand(name);
        if (!handler) throw new Error(`Command "/${name}" not found`);
        let output = "";
        this.engine.setCmdOutput((text) => { output += (output ? "\n" : "") + text; });
        await handler.execute(args);
        this.engine.setCmdOutput(() => {});
        return { output };
      },
      listCommands: () => this.registry.listSlashCommandHooks().map(h => ({ name: h.name, description: h.description, source: h.source })),
      shutdown: async () => { this.abortController?.abort(); this.engine.scheduler?.killAll(); await this.engine.mcp.shutdownAll(); this.bus.publish("SESSION_END", { sessionDurationMs: Date.now(), exitCode: 0 }); await this.engine.container.shutdown(); },
      messages: () => this.engine.context.getMessages(),
      setCmdOutput: (fn: (text: string) => void) => { this.engine.setCmdOutput(fn); },
      setOpenPanel: (fn: (panel: string) => void) => { this.engine.setOpenPanel(fn); },
    };
  }

  /** Models — model management */
  get models() {
    return {
      list: (): ModelListResult => {
        const config = this.engine.container.config;
        const models: ModelInfo[] = Object.entries(config.models).map(([name, cfg]) => ({ name, protocol: cfg.protocol, model: cfg.model, contextLimit: cfg.contextLimit, tiers: Object.entries({ selected: config.modelSelected, utility: config.modelUtility, escalation: config.modelEscalation }).filter(([, v]) => v === name).map(([k]) => k) }));
        return { models, modelSelected: this.engine.container.config.modelSelected };
      },
      switch: (params: ModelSwitchParams) => {
        const config = this.engine.container.config;
        if (!config.models[params.name]) throw new Error(`Model "${params.name}" not found`);
        if (params.tier) { if (params.tier === "selected") config.modelSelected = params.name; else if (params.tier === "utility") config.modelUtility = params.name; else config.modelEscalation = params.name; }
        else {
          config.modelSelected = params.name;
          safeConfigWrite(join(this.workspaceRoot, ".voidrift", "config.json"), (raw: any) => { raw.modelSelected = params.name; });
        }
        this.engine.budget.setLimit(config.models[params.name].contextLimit);
      },
      /** Persist current tier assignments to workspace config */
      persistTiers: () => {
        const wsPath = join(this.workspaceRoot, ".voidrift", "config.json");
        const config = this.engine.container.config;
        safeConfigWrite(wsPath, (raw: any) => {
          raw.modelSelected = config.modelSelected; raw.modelEscalation = config.modelEscalation; raw.modelUtility = config.modelUtility;
        });
      },
      /** Switch the background model (for /run, routines, subagents) */
      switchBackground: (name: string) => {
        const config = this.engine.container.config;
        if (!config.models[name]) throw new Error(`Model "${name}" not found`);
        config.modelBackground = name;
        safeConfigWrite(join(this.workspaceRoot, ".voidrift", "config.json"), (raw: any) => { raw.modelBackground = name; });
      },
      stats: (): StatsResult => {
        const s = this.engine.stats.current;
        const perTool: Record<string, number> = {};
        s.tools.perTool.forEach((v, k) => { perTool[k] = v; });
        return { sessionId: s.sessionId, turns: s.turns, duration: this.engine.stats.durationFormatted, tools: { total: s.tools.total, success: s.tools.success, failed: s.tools.failed, totalTimeMs: s.tools.totalTimeMs, perTool }, models: [...s.modelUsage.entries()].map(([name, u]) => ({ name, turns: u.turns, inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTimeMs: u.totalTimeMs })) };
      },
      context: (): ContextStatsResult => {
        const b = this.engine.budget.state;
        return { percentage: b.percentage, used: b.used, limit: b.limit, layers: { agent: 0, orbit: 0, drift: 0, void: 0 } };
      },
      contextPct: () => this.engine.budget.getContextPct(this.engine.context.getTokenCount()),
      contextDetail: (): ContextDetailResult => {
        const ctx = this.engine.context.context;
        const est = (s: string) => Math.ceil(s.length / 4);
        const toolsJson = JSON.stringify(TOOL_SCHEMAS.filter((t: any) => ctx.agent.activeTools.includes(t.name)));
        return {
          limit: this.engine.budget.state.limit,
          agent: {
            persona: ctx.agent.activePersona,
            personaTokens: est(ctx.agent.activePersona),
            tools: ctx.agent.activeTools,
            toolsTokens: est(toolsJson),
            boundSkills: ctx.agent.boundSkills.length,
            boundSkillsTokens: ctx.agent.boundSkills.reduce((a, s) => a + est(s), 0),
            skillIndex: ctx.agent.skillDiscoveryIndex.length,
            skillIndexTokens: ctx.agent.skillDiscoveryIndex.reduce((a, s) => a + est(s), 0),
            memoryIndex: ctx.agent.activeMemoryIndex.length,
            memoryIndexTokens: ctx.agent.activeMemoryIndex.reduce((a, m) => a + est(m.title + m.summary), 0),
          },
          orbit: {
            activeSkills: ctx.orbit.activeSkills.length,
            activeSkillsTokens: ctx.orbit.activeSkills.reduce((a, s) => a + est(s), 0),
            activeMemory: ctx.orbit.activeMemory.length,
            memoryTokens: ctx.orbit.activeMemory.reduce((a, m) => a + est(m), 0),
            plan: ctx.orbit.activePlan,
            planTokens: ctx.orbit.activePlan ? est(ctx.orbit.activePlan) : 0,
          },
          drift: {
            focusedFiles: ctx.drift.focusedFiles.map(f => ({ path: f.path, totalLines: f.totalLines, readRanges: f.readRanges })),
            filesTokens: ctx.drift.focusedFiles.reduce((a, f) => a + est(f.summary), 0),
            codeMapTokens: est(ctx.orbit.workspaceCodeMap),
            gitStatus: ctx.drift.gitStatus,
            gitTokens: ctx.drift.gitStatus ? est(ctx.drift.gitStatus) : 0,
          },
          void: {
            messageCount: ctx.void.messages.length,
            messagesTokens: ctx.void.messages.filter(m => m.role === "user" || m.role === "assistant").reduce((a, m) => a + est(m.content), 0),
            toolResultTokens: ctx.void.messages.filter(m => m.role === "tool").reduce((a, m) => a + est(m.content), 0),
            diagnostics: ctx.void.diagnostics,
            diagnosticsTokens: ctx.void.diagnostics ? est(ctx.void.diagnostics) : 0,
          },
        };
      },
    };
  }

  /** Agents — persona management */
  get agents() {
    return {
      list: (): AgentListResult => {
        const all = [...this.engine.agents.listInteractive(), ...this.engine.agents.listPassive()];
        const activeId = this.engine.agents.active.id;
        return { agents: all.map((a): AgentDTO => {
          const globalDir = join(homedir(), ".config", "voidrift", "agents", a.id);
          const wsDir = join(this.workspaceRoot, ".voidrift", "agents", a.id);
          const configOverride: "default" | "global" | "workspace" = existsSync(join(wsDir, "agent.json")) ? "workspace" : existsSync(join(globalDir, "agent.json")) ? "global" : "default";
          const promptOverride: "default" | "global" | "workspace" = existsSync(join(wsDir, "prompt.md")) ? "workspace" : existsSync(join(globalDir, "prompt.md")) ? "global" : "default";
          return { id: a.id, name: a.name, description: a.description, type: a.type, role: a.role, tools: a.tools, approvalMode: a.approvalMode, active: a.id === activeId, source: a.source, prompt: a.prompt, overridePath: a.overridePath, overrideStatus: a.overrideStatus, configOverride, promptOverride, skills: a.skills, resources: a.resources, welcomeMessage: a.welcomeMessage };
        }) };
      },
      get: (id: string): AgentGetResult => {
        const a = this.engine.agents.get(id);
        if (!a) throw new Error(`Agent "${id}" not found`);
        return { agent: { id: a.id, name: a.name, description: a.description, type: a.type, role: a.role, tools: a.tools, approvalMode: a.approvalMode, active: a.id === this.engine.agents.active.id, source: a.source, prompt: a.prompt, overridePath: a.overridePath, overrideStatus: a.overrideStatus, skills: a.skills, resources: a.resources, welcomeMessage: a.welcomeMessage } };
      },
      activate: (id: string) => {
        return activateAgent(id, {
          agents: this.engine.agents,
          prompts: this.engine.prompts,
          context: this.engine.context,
          skills: this.engine.skills,
          config: this.engine.container.config,
          workspaceRoot: this.workspaceRoot,
          resourceLoader: fsResourceLoader,
        });
      },
      cycle: (): AgentGetResult => { this.engine.agents.cycle(); return this.agents.get(this.engine.agents.active.id); },
      create: (id: string, type: "interactive" | "passive", scope: "workspace" | "global" = "workspace") => this.engine.agents.createAgent(id, type, this.workspaceRoot, scope),
      deactivate: (id: string) => { this.engine.agents.deactivate(id, this.workspaceRoot); },
      deleteOverride: (id: string, scope: "workspace" | "global") => { this.engine.agents.deleteOverride(id, scope, this.workspaceRoot); },
      reindex: () => { this.engine.agents.discover(this.workspaceRoot); },
      /** Get the full override cascade for an agent (config + prompt at each level) */
      getOverrideCascade: (id: string): Array<{ section: string; level: string; active: boolean; path?: string; editable: boolean; target?: string }> => {
        const agent = this.engine.agents.get(id);
        if (!agent) return [];
        const globalDir = join(homedir(), ".config", "voidrift", "agents", id);
        const wsDir = join(this.workspaceRoot, ".voidrift", "agents", id);
        const globalConfig = join(globalDir, "agent.json");
        const wsConfig = join(wsDir, "agent.json");
        const globalPrompt = join(globalDir, "prompt.md");
        const wsPrompt = join(wsDir, "prompt.md");
        const gcExists = existsSync(globalConfig);
        const wcExists = existsSync(wsConfig);
        const gpExists = existsSync(globalPrompt);
        const wpExists = existsSync(wsPrompt);
        const hasBuiltIn = agent.source !== "custom";
        const configActive = wcExists ? "workspace" : gcExists ? "global" : "default";
        const promptActive = wpExists ? "workspace" : gpExists ? "global" : "default";
        const rows: Array<{ section: string; level: string; active: boolean; path?: string; editable: boolean; target?: string }> = [];
        if (hasBuiltIn) {
          rows.push({ section: "config", level: "Default", active: configActive === "default", path: "(built-in)", editable: true, target: undefined });
          rows.push({ section: "config", level: "Global", active: configActive === "global", path: gcExists ? globalConfig.replace(homedir(), "~") : undefined, editable: true, target: globalConfig });
          rows.push({ section: "config", level: "Workspace", active: configActive === "workspace", path: wcExists ? wsConfig.replace(this.workspaceRoot, ".") : undefined, editable: true, target: wsConfig });
          rows.push({ section: "prompt", level: "Default", active: promptActive === "default", path: "(built-in)", editable: true, target: undefined });
          rows.push({ section: "prompt", level: "Global", active: promptActive === "global", path: gpExists ? globalPrompt.replace(homedir(), "~") : undefined, editable: true, target: globalPrompt });
          rows.push({ section: "prompt", level: "Workspace", active: promptActive === "workspace", path: wpExists ? wsPrompt.replace(this.workspaceRoot, ".") : undefined, editable: true, target: wsPrompt });
        } else {
          const configPath = gcExists ? globalConfig : wcExists ? wsConfig : undefined;
          const promptPath_ = gpExists ? globalPrompt : wpExists ? wsPrompt : undefined;
          rows.push({ section: "file", level: "Config", active: !!configPath, path: configPath ? configPath.replace(homedir(), "~").replace(this.workspaceRoot, ".") : undefined, editable: true, target: configPath || wsConfig });
          rows.push({ section: "file", level: "Prompt", active: !!promptPath_, path: promptPath_ ? promptPath_.replace(homedir(), "~").replace(this.workspaceRoot, ".") : undefined, editable: true, target: promptPath_ || wsPrompt });
        }
        return rows;
      },
      /** Scaffold an override file with default content. Returns path. */
      scaffoldOverride: (id: string, target: string): string => {
        mkdirSync(dirname(target), { recursive: true });
        if (!existsSync(target)) {
          const agent = this.engine.agents.get(id);
          if (agent) {
            if (target.endsWith(".json")) {
              const copy: Record<string, unknown> = { ...agent };
              delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
              writeFileSync(target, JSON.stringify(copy, null, 2), "utf-8");
            } else {
              writeFileSync(target, agent.prompt, "utf-8");
            }
          }
        }
        return target;
      },
      /** Delete a specific override file */
      deleteFile: (path: string): boolean => {
        if (existsSync(path)) { unlinkSync(path); return true; }
        return false;
      },
      /** Reset an override file to default content */
      resetOverride: (id: string, target: string): void => {
        if (target.endsWith(".json")) {
          const defaultConfig = { id, name: id, description: "", type: "interactive", role: "auto", tools: [] as string[], approvalMode: "prompt" as const, allowedTools: [] as string[], active: false };
          writeFileSync(target, JSON.stringify(defaultConfig, null, 2), "utf-8");
        } else {
          writeFileSync(target, `You are ${id}.\n`, "utf-8");
        }
      },
      /** Rename a custom agent directory */
      renameAgent: (oldId: string, newId: string): { success: boolean; error?: string } => {
        const agent = this.engine.agents.get(oldId);
        const oldDir = agent?.overridePath ? dirname(agent.overridePath) : join(this.workspaceRoot, ".voidrift", "agents", oldId);
        const parentDir = dirname(oldDir);
        const newDir = join(parentDir, newId);
        if (!existsSync(oldDir)) return { success: false, error: "Source folder not found" };
        if (existsSync(newDir)) return { success: false, error: `"${newId}" already exists` };
        renameSync(oldDir, newDir);
        this.engine.agents.discover(this.workspaceRoot);
        return { success: true };
      },
      /** Get the location of a custom agent (workspace or global) */
      getLocation: (id: string): "workspace" | "global" => {
        return existsSync(join(this.workspaceRoot, ".voidrift", "agents", id)) ? "workspace" : "global";
      },
    };
  }

  /** Plan — task tracking */
  get plan() {
    return {
      list: (): PlanListResult => ({ items: this.engine.planManager.all() }),
      get: (filename: string): PlanGetResult => {
        const item = this.engine.planManager.get(filename);
        if (!item) throw new Error(`Plan item "${filename}" not found`);
        return { item };
      },
      add: (input: AddPlanItemInput): PlanGetResult => {
        const filename = this.engine.planManager.add(input.name, input.description, input.rationale, input.priority, input.body);
        this.engine.context.setPlan(this.engine.planManager.compileActivePlanSummary() || "");
        return { item: this.engine.planManager.get(filename)! };
      },
      updatePriority: (input: UpdatePlanPriorityInput) => {
        if (!this.engine.planManager.updatePriority(input.filename, input.priority)) throw new Error(`Plan item "${input.filename}" not found`);
        this.engine.context.setPlan(this.engine.planManager.compileActivePlanSummary() || "");
      },
      updateBody: (input: UpdatePlanBodyInput) => {
        const item = this.engine.planManager.get(input.filename);
        if (!item) throw new Error(`Plan item "${input.filename}" not found`);
        const updated = item.body.replace(input.search, input.replace);
        if (updated === item.body) throw new Error(`Search text not found in "${input.filename}"`);
        this.engine.planManager.add(input.filename.replace(".md", ""), item.description, item.rationale, item.priority, updated);
      },
      remove: (filename: string) => {
        if (!this.engine.planManager.remove(filename)) throw new Error(`Plan item "${filename}" not found`);
        this.engine.context.setPlan(this.engine.planManager.compileActivePlanSummary() || "");
      },
      dir: () => this.engine.planManager.dir,
    };
  }

  /** Routines — repeatable instructions */
  get routines() {
    return {
      list: () => this.engine.routineManager.all(),
      get: (filename: string) => {
        const item = this.engine.routineManager.get(filename);
        if (!item) throw new Error(`Routine "${filename}" not found`);
        return item;
      },
      add: (name: string, description: string, body = ""): string => {
        return this.engine.routineManager.add(name, description, body);
      },
      remove: (filename: string): boolean => {
        return this.engine.routineManager.remove(filename);
      },
      dir: () => this.engine.routineManager.dir,
    };
  }

  /** Memory — persistent knowledge */
  get memory() {
    return {
      list: (): MemoryListResult => {
        const activeMemory = this.engine.context.context.orbit.activeMemory;
        return { memories: this.engine.memory.all.map((m): MemoryDTO => ({ id: m.id, title: m.title, summary: m.summary, keywords: m.context?.keywords ?? [], scope: m.filePath?.includes(".config/voidrift") ? "global" : "local", filePath: m.filePath, loaded: !!this.engine.memory.loadBody(m.id) && activeMemory.includes(this.engine.memory.loadBody(m.id)!) })) };
      },
      load: (id: string) => {
        const body = this.engine.memory.loadBody(id);
        if (!body) throw new Error(`Memory "${id}" not found`);
        this.engine.context.loadMemory(body);
        const meta = this.engine.memory.all.find(m => m.id === id);
        if (meta) this.bus.publish("MEMORY_LOADED", { id, title: meta.title, scope: meta.filePath?.includes(".config/voidrift") ? "global" : "local" } as any);
      },
      unload: (id: string) => {
        const body = this.engine.memory.loadBody(id);
        if (!body) throw new Error(`Memory "${id}" not found`);
        const idx = this.engine.context.context.orbit.activeMemory.indexOf(body);
        if (idx !== -1) { this.engine.context.unloadMemory(idx); this.bus.publish("MEMORY_UNLOADED", { id } as any); }
      },
      /** Delete a memory permanently by ID */
      delete: (id: string): boolean => {
        const meta = this.engine.memory.all.find(m => m.id === id);
        if (!meta?.filePath) return false;
        if (existsSync(meta.filePath)) {
          unlinkSync(meta.filePath);
          return true;
        }
        return false;
      },
    };
  }

  /** Skills — domain knowledge */
  get skills() {
    return {
      list: (): SkillListResult => {
        return { skills: this.engine.skills.indexedSkills.map((s): SkillDTO => {
          const isBuiltin = s.filePath === "(builtin)";
          let overrideLevel: string | undefined;
          if (isBuiltin) {
            const wsPath = join(this.workspaceRoot, ".voidrift", "skills", `${s.name}.md`);
            const globalPath = join(homedir(), ".config", "voidrift", "skills", `${s.name}.md`);
            overrideLevel = existsSync(wsPath) ? "workspace" : existsSync(globalPath) ? "global" : "default";
          }
          return { name: s.name, description: s.description, filePath: s.filePath, location: s.filePath.includes(".config/voidrift") ? "global" : "workspace", active: s.active, triggers: { extensions: s.triggers.extensions ?? [], files: s.triggers.files ?? [], keywords: s.triggers.keywords ?? [] }, agents: s.agents, overrideLevel };
        }) };
      },
      reindex: (): SkillListResult => {
        this.engine.skills.index([join(this.engine.workspaceRoot, ".voidrift", "skills"), homedir() + "/.config/voidrift/skills"]);
        return this.skills.list();
      },
      create: (name: string, scope: "workspace" | "global"): string => {
        const dir = scope === "workspace"
          ? join(this.workspaceRoot, ".voidrift", "skills")
          : join(homedir(), ".config", "voidrift", "skills");
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `${name}.md`);
        if (!existsSync(filePath)) {
          writeFileSync(filePath, `---\nname: "${name}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\nagents: []\nactive: true\n---\n\n`, "utf-8");
        }
        return filePath;
      },
      rename: (oldName: string, newName: string): { success: boolean; error?: string } => {
        const dirs = [join(this.workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "skills")];
        for (const dir of dirs) {
          const oldPath = join(dir, `${oldName}.md`);
          const newPath = join(dir, `${newName}.md`);
          if (existsSync(oldPath)) {
            if (existsSync(newPath)) return { success: false, error: `"${newName}" already exists` };
            renameSync(oldPath, newPath);
            return { success: true };
          }
        }
        return { success: false, error: `Skill "${oldName}" not found` };
      },
      delete: (name: string): { success: boolean } => {
        const dirs = [join(this.workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "skills")];
        for (const dir of dirs) {
          const filePath = join(dir, `${name}.md`);
          if (existsSync(filePath)) { unlinkSync(filePath); return { success: true }; }
        }
        return { success: false };
      },
      /** Create an override file for a builtin skill. Copies builtin content to the override location. Returns path. */
      createOverride: (name: string, scope: "workspace" | "global"): string => {
        const dir = scope === "workspace"
          ? join(this.workspaceRoot, ".voidrift", "skills")
          : join(homedir(), ".config", "voidrift", "skills");
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `${name}.md`);
        if (!existsSync(filePath)) {
          const skill = this.engine.skills.indexedSkills.find(s => s.name === name);
          if (skill) {
            const content = `---\nname: "${skill.name}"\ndescription: "${skill.description}"\ntriggers:\n  keywords: [${(skill.triggers.keywords || []).map((k: string) => `"${k}"`).join(", ")}]\nagents: [${skill.agents.map((a: string) => `"${a}"`).join(", ")}]\nactive: ${skill.active}\n---\n\n${skill.content}\n`;
            writeFileSync(filePath, content, "utf-8");
          }
        }
        return filePath;
      },
    };
  }
  /** Tools — capability system */
  get tools() {
    return {
      list: () => {
        const agent = this.engine.agents.active;
        const core = TOOL_SCHEMAS.filter((t: any) => agent.tools.includes(t.name)).map((t: any) => ({ name: t.name, description: t.description, approval: agent.allowedTools.includes(t.name) ? "auto" : "gated", parameters: t.parameters || [] }));
        const mcp = this.engine.mcp.connected.flatMap(s => s.tools.map(t => ({ name: t.name, server: s.name, fullName: `mcp_${s.name}_${t.name}`, description: t.description, inputSchema: JSON.stringify(t.inputSchema, null, 2).slice(0, 500) })));
        return { core, mcp };
      },
    };
  }

  /** MCP — external server integration */
  get mcp() {
    return {
      list: (): MCPServerListResult => {
        const configs = this.engine.mcp.loadConfigs();
        const servers = this.engine.mcp.all;
        const allNames = [...new Set([...configs.map(c => c.name), ...servers.map(s => s.name)])];
        return { servers: allNames.map((name): MCPServerDTO => { const srv = servers.find(s => s.name === name); const cfg = configs.find(c => c.name === name); return { name, status: srv?.status ?? "disconnected", transport: cfg?.transport ?? (cfg?.url ? "http-sse" : "stdio"), url: cfg?.url, toolCount: srv?.tools.length ?? 0, autoConnect: (cfg as any)?.autoConnect !== false }; }) };
      },
      connect: async (name: string) => {
        const cfg = this.engine.mcp.loadConfigs().find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);
        await this.engine.mcp.connect(cfg);
      },
      disconnect: (name: string) => { this.engine.mcp.disconnect(name); },
      listConfigs: () => this.engine.mcp.loadConfigs(),
      removeConfig: (name: string) => this.engine.mcp.removeConfig(name),
      saveConfig: (config: any) => this.engine.mcp.saveConfig(config),
    };
  }

  /** Templates — document templates */
  get templates() {
    return {
      list: (): TemplateListResult => {
        const slots = this.engine.templates.slotsByType("template");
        return { templates: slots.map((s): TemplateDTO => { const resolved = this.engine.templates.resolveSlot(s); return { key: s.key, label: s.label, description: s.description, source: s.sourcePlugin, activeLevel: resolved.source as any }; }) };
      },
      get: (key: string): TemplateGetResult => {
        const slot = this.engine.templates.slotsByType("template").find(s => s.key === key);
        if (!slot) throw new Error(`Template "${key}" not found`);
        const resolved = this.engine.templates.resolveSlot(slot);
        return { key, content: resolved.content, source: resolved.source };
      },
      /** Get all template slots with resolution metadata (for cascade panels) */
      slots: () => this.engine.templates.slotsByType("template").map(s => {
        const resolved = this.engine.templates.resolveSlot(s);
        return { key: s.key, label: s.label, description: s.description, sourcePlugin: s.sourcePlugin, source: resolved.source, overridePath: resolved.overridePath, content: resolved.content };
      }),
      /** Resolve a single slot by key — returns content + source level */
      resolve: (key: string) => {
        const slot = this.engine.templates.slotsByType("template").find(s => s.key === key);
        if (!slot) return null;
        const resolved = this.engine.templates.resolveSlot(slot);
        return { content: resolved.content, source: resolved.source, overridePath: resolved.overridePath };
      },
      /** Create an override file for a template. Returns the file path. */
      createSlotOverride: (key: string, scope: "workspace" | "global") => {
        const slot = this.engine.templates.slotsByType("template").find(s => s.key === key);
        if (!slot) return null;
        return this.engine.templates.createOverrideForSlot(slot, scope);
      },
      createOverride: (key: string, scope: "workspace" | "global") => this.engine.templates.createOverride(key, scope),
      deleteOverride: (key: string, scope: "workspace" | "global") => this.engine.templates.deleteOverride(key, scope),
      /** Create a custom template file */
      create: (name: string, scope: "workspace" | "global"): string => {
        const dir = scope === "workspace"
          ? join(this.workspaceRoot, ".voidrift", "templates")
          : join(homedir(), ".config", "voidrift", "templates");
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `${name}.md`);
        if (!existsSync(filePath)) {
          writeFileSync(filePath, `---\nname: "${name}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\n---\n\n`, "utf-8");
        }
        return filePath;
      },
      /** Rename a custom template */
      rename: (oldName: string, newName: string): { success: boolean; error?: string } => {
        const dirs = [join(this.workspaceRoot, ".voidrift", "templates"), join(homedir(), ".config", "voidrift", "templates")];
        for (const dir of dirs) {
          const oldPath = join(dir, `${oldName}.md`);
          const newPath = join(dir, `${newName}.md`);
          if (existsSync(oldPath)) {
            if (existsSync(newPath)) return { success: false, error: `"${newName}" already exists` };
            renameSync(oldPath, newPath);
            return { success: true };
          }
        }
        return { success: false, error: `Template "${oldName}" not found` };
      },
      /** Delete a custom template */
      delete: (name: string): { success: boolean } => {
        const dirs = [join(this.workspaceRoot, ".voidrift", "templates"), join(homedir(), ".config", "voidrift", "templates")];
        for (const dir of dirs) {
          const filePath = join(dir, `${name}.md`);
          if (existsSync(filePath)) { unlinkSync(filePath); return { success: true }; }
        }
        return { success: false };
      },
    };
  }

  /** Prompts — system prompts */
  get prompts() {
    return {
      list: (): PromptListResult => ({ prompts: this.engine.prompts.list().map((e): PromptDTO => { const resolved = this.engine.prompts.resolve(e.key); return { key: e.key, label: e.label, description: e.description || "", source: e.sourcePlugin, activeLevel: resolved?.source as any || "default" }; }) }),
      get: (key: string): PromptGetResult => {
        const resolved = this.engine.prompts.resolve(key);
        if (!resolved) throw new Error(`Prompt "${key}" not found`);
        return { key, content: resolved.body, source: resolved.source };
      },
      createOverride: (key: string, scope: "workspace" | "global") => this.engine.prompts.createOverride(key, scope),
      deleteOverride: (key: string) => this.engine.prompts.deleteOverride(key),
    };
  }

  /** Policy — security rules */
  get policy() {
    return {
      list: () => this.engine.policyEngine.getRules().map(r => ({ tool: r.tool, pattern: r.pattern, decision: r.decision, priority: r.priority, source: r.source, label: r.label })),
    };
  }

  /** Audit — observability */
  get audit() {
    return {
      list: (limit = 50) => {
        const logPath = this.engine.logger.localLogPath;
        if (!existsSync(logPath)) return [];
        try { const content = readFileSync(logPath, "utf-8"); const lines = content.trim().split("\n").filter(Boolean); return lines.map((l: string) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit); } catch { return []; }
      },
    };
  }

  /** Workspace — file operations, map, tasks */
  get workspace() {
    return {
      map: () => generateCodeMap(this.workspaceRoot),
      root: () => this.workspaceRoot,
      branch: () => this.__engine?.branch ?? null,
      shortPath: () => this.__engine?.shortPath ?? this.workspaceRoot,
      exec: (cmd: string, cwd?: string, timeout?: number) => executeCommand(cwd ?? this.workspaceRoot, cmd, timeout),
      tasks: () => (this.engine.scheduler?.all ?? []).map(t => ({ id: t.id, type: t.type, status: t.status, instruction: t.instruction, output: t.output })),
      runningCount: () => (this.engine.scheduler?.runningCount ?? 0) + this.engine.worktree.locks.length,
      locks: () => this.engine.worktree.locks,
      killTasks: () => { this.engine.scheduler?.killAll(); },
      spawn: (fileBoundaries: string[], execute: (wtPath: string) => Promise<"success" | "failed">) => this.worktree.schedule(fileBoundaries, execute),
      inject: (label: string, content: string) => { this.contextManager?.injectTurnContext(label, content); },
      config: () => this.engine.container.config,
      /** Get config file paths by scope */
      configPaths: (): { global: string; workspace: string } => ({
        global: join(homedir(), ".config", "voidrift", "config.json"),
        workspace: join(this.workspaceRoot, ".voidrift", "config.json"),
      }),
      /** Shorten an absolute path for display (replaces homedir with ~, workspace with .) */
      shortenPath: (p: string): string => {
        return p.replace(homedir(), "~").replace(this.workspaceRoot, ".");
      },
      diff: (): string[] => {
        try {
          const raw = execSync("git diff --no-color", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
          return raw ? raw.split("\n") : [];
        } catch { return []; }
      },
      /** List workspace files for autocomplete (relative paths, depth-limited) */
      listFiles: (maxDepth = 3): string[] => {
        const IGNORED = new Set(["node_modules", ".git", ".voidrift", "dist", "build", ".next", "coverage"]);
        const walk = (dir: string, root: string, depth: number): string[] => {
          if (depth > maxDepth) return [];
          const results: string[] = [];
          let items: string[];
          try { items = readdirSync(dir); } catch { return []; }
          for (const item of items) {
            if (IGNORED.has(item) || item.startsWith(".")) continue;
            const fullPath = join(dir, item);
            const relPath = fullPath.slice(root.length + 1);
            let stat;
            try { stat = statSync(fullPath); } catch { continue; }
            if (stat.isDirectory()) { results.push(relPath + "/"); results.push(...walk(fullPath, root, depth + 1)); }
            else { results.push(relPath); }
          }
          return results;
        };
        return walk(this.workspaceRoot, this.workspaceRoot, 0);
      },
    };
  }

  /** Plugins — installed plugins */
  get plugins() {
    return {
      list: () => this.engine.pluginRegistry.list(),
      /** Get which config scope a plugin is enabled in */
      getScope: (id: string): "global" | "workspace" | "available" => {
        const globalPath = join(homedir(), ".config", "voidrift", "config.json");
        const wsPath = join(this.workspaceRoot, ".voidrift", "config.json");
        let inGlobal = false, inWorkspace = false;
        try { const g = JSON.parse(readFileSync(globalPath, "utf-8")); inGlobal = (g.plugins || []).includes(id); } catch {}
        try { const w = JSON.parse(readFileSync(wsPath, "utf-8")); inWorkspace = (w.plugins || []).includes(id); } catch {}
        if (inWorkspace) return "workspace";
        if (inGlobal) return "global";
        return "available";
      },
      /** Enable a plugin in workspace config */
      enable: (id: string, scope: "global" | "workspace" = "workspace") => {
        const path = scope === "global"
          ? join(homedir(), ".config", "voidrift", "config.json")
          : join(this.workspaceRoot, ".voidrift", "config.json");
        safeConfigWrite(path, (config: any) => {
          if (!Array.isArray(config.plugins)) config.plugins = [];
          if (!config.plugins.includes(id)) config.plugins.push(id);
        });
      },
      /** Disable a plugin (remove from workspace config) */
      disable: (id: string) => {
        const wsPath = join(this.workspaceRoot, ".voidrift", "config.json");
        if (!existsSync(wsPath)) return;
        safeConfigWrite(wsPath, (config: any) => {
          if (Array.isArray(config.plugins)) config.plugins = config.plugins.filter((p: string) => p !== id);
        });
      },
    };
  }

  /** Editor — file editing operations */
  get editor() {
    return {
      /** Open a file in the configured editor. Returns success/error. */
      open: (filePath: string): { success: boolean; error?: string } => {
        const config = this.engine.container.config;
        if (!config.editor) return { success: false, error: "No editor configured" };
        return openInEditor(filePath, config.editor);
      },
      /** Edit a file with validation. Temp copy → validate → apply. */
      editValidated: (filePath: string, type: "json" | "frontmatter" | "skill" | "prompt"): { success: boolean; changed: boolean; error?: string } => {
        const config = this.engine.container.config;
        if (!config.editor) return { success: false, changed: false, error: "No editor configured" };
        const validators: Record<string, any> = { json: validateJSON, frontmatter: validateFrontmatter, skill: validateSkillFile, prompt: validatePromptFile };
        return editWithValidation(filePath, config.editor, validators[type]);
      },
      /** Write content to temp file and open read-only in editor. */
      viewReadonly: (content: string, filename: string): { success: boolean; error?: string } => {
        const config = this.engine.container.config;
        if (!config.editor) return { success: false, error: "No editor configured" };
        const tmpDir = join(this.workspaceRoot, ".voidrift", "cache", "view");
        mkdirSync(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, filename);
        writeFileSync(tmpPath, content, "utf-8");
        return openInEditor(tmpPath, config.editor);
      },
      /** Check if an editor is configured */
      hasEditor: (): boolean => !!this.engine.container.config.editor,
    };
  }
}
