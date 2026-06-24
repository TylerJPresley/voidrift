/**
 * OperatorAPI — curated management facade for first-party frontends.
 *
 * This is NOT the plugin API. This is the trusted frontend surface —
 * same level of access as the TUI panels. Provides serializable
 * responses suitable for IPC.
 */
import type { EngineContext } from "../engine.js";
import { join } from "path";
import { homedir } from "os";
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
  CreateAgentInput, UpdateAgentInput,
  AddPlanItemInput, UpdatePlanPriorityInput, UpdatePlanBodyInput,
  ModelSwitchParams, SkillToggleParams,
  UpsertOverrideInput, DeleteOverrideInput,
} from "./dto.js";
import { executeTurn } from "../turn.js";

export class OperatorAPI {
  private abortController: AbortController | null = null;

  constructor(private engine: EngineContext) {}

  // ─── Session ─────────────────────────────────────────────────────────────

  async sendInput(params: SendInputParams): Promise<SendInputResult> {
    const turnId = `turn-${Date.now().toString(36)}`;
    this.abortController = new AbortController();

    executeTurn(this.engine, params.text, {
      onChunk: (chunk) => {
        switch (chunk.type) {
          case "content":
            if ((chunk as any).text) {
              this.engine.container.bus.publish("TOKEN_STREAM", {
                token: (chunk as any).text,
                done: false,
              });
            }
            break;
          case "tool_call": {
            // Graph already publishes BEFORE/AFTER_TOOL_EXECUTE — no action needed here
            break;
          }
          case "done":
            this.engine.container.bus.publish("TOKEN_STREAM", {
              token: "",
              done: true,
              usage: (chunk as any).usage,
            });
            break;
          case "error":
            this.engine.container.bus.publish("ERROR_OCCURRED", {
              message: (chunk as any).message,
              source: "model",
            });
            break;
        }
      },
      signal: this.abortController.signal,
    });

    return { turnId };
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  clear(): void {
    this.engine.context.setMessages([]);
    this.engine.context.clearFocusedFiles();
  }

  compact(): { before: number; after: number } {
    const msgs = this.engine.context.getMessages();
    const before = msgs.length;
    // Compaction is handled by the existing compactor
    return { before, after: this.engine.context.getMessages().length };
  }

  confirmTool(params: ConfirmToolParams): void {
    this.engine.container.bus.publish("TOOL_CONFIRMATION_RESPONSE", {
      approved: params.approved,
      requestId: params.requestId,
      persist: params.persist,
      chosenPattern: params.chosenPattern,
    });
  }

  async executeCommand(name: string, args: string[] = []): Promise<{ output: string }> {
    const handler = this.engine.container.registry.getSlashCommand(name);
    if (!handler) throw new Error(`Command "/${name}" not found`);
    let output = "";
    this.engine.setCmdOutput((text) => { output += (output ? "\n" : "") + text; });
    await handler.execute(args);
    this.engine.setCmdOutput(() => {});
    return { output };
  }

  listCommands(): Array<{ name: string; description: string; source?: string }> {
    return this.engine.container.registry.listSlashCommandHooks().map(h => ({ name: h.name, description: h.description, source: h.source }));
  }

  // ─── Model ───────────────────────────────────────────────────────────────

  listModels(): ModelListResult {
    const config = this.engine.container.config;
    const models: ModelInfo[] = Object.entries(config.models).map(([name, cfg]) => ({
      name,
      protocol: cfg.protocol,
      model: cfg.model,
      contextLimit: cfg.contextLimit,
      tiers: Object.entries(config.tiers)
        .filter(([, v]) => v === name)
        .map(([k]) => k),
    }));
    return { models, activeTier: this.engine.agents.active.modelTier };
  }

  switchModel(params: ModelSwitchParams): void {
    const config = this.engine.container.config;
    if (!config.models[params.name]) throw new Error(`Model "${params.name}" not found`);
    if (params.tier) {
      (config.tiers as any)[params.tier] = params.name;
    }
    this.engine.budget.setLimit(config.models[params.name].contextLimit);
  }

  getStats(): StatsResult {
    const s = this.engine.stats.current;
    return {
      sessionId: s.sessionId,
      turns: s.turns,
      duration: this.engine.stats.durationFormatted,
      tools: { total: s.tools.total, success: s.tools.success, failed: s.tools.failed },
      models: [...s.modelUsage.entries()].map(([name, u]) => ({
        name, turns: u.turns, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
      })),
    };
  }

  getContextStats(): ContextStatsResult {
    const b = this.engine.budget.state;
    return {
      percentage: b.percentage,
      used: b.used,
      limit: b.limit,
      layers: { agent: 0, orbit: 0, drift: 0, void: 0 }, // TODO: expose from context manager
    };
  }

  // ─── Agents ──────────────────────────────────────────────────────────────

  listAgents(): AgentListResult {
    const all = [...this.engine.agents.listInteractive(), ...this.engine.agents.listTask()];
    const activeId = this.engine.agents.active.id;
    return {
      agents: all.map((a): AgentDTO => ({
        id: a.id,
        name: a.name,
        description: a.description,
        type: a.type,
        modelTier: a.modelTier,
        tools: a.tools,
        approvalMode: a.approvalMode,
        active: a.id === activeId,
        source: a.source,
      })),
    };
  }

  getAgent(id: string): AgentGetResult {
    const a = this.engine.agents.get(id);
    if (!a) throw new Error(`Agent "${id}" not found`);
    return {
      agent: {
        id: a.id, name: a.name, description: a.description, type: a.type,
        modelTier: a.modelTier, tools: a.tools, approvalMode: a.approvalMode,
        active: a.id === this.engine.agents.active.id, source: a.source,
      },
    };
  }

  activateAgent(id: string): void {
    const a = this.engine.agents.get(id);
    if (!a) throw new Error(`Agent "${id}" not found`);
    this.engine.agents.setActive(id);
  }

  cycleAgent(): AgentGetResult {
    this.engine.agents.cycle();
    return this.getAgent(this.engine.agents.active.id);
  }

  // ─── Plan ────────────────────────────────────────────────────────────────

  listPlan(): PlanListResult {
    return { items: this.engine.planManager.all() };
  }

  getPlan(filename: string): PlanGetResult {
    const item = this.engine.planManager.get(filename);
    if (!item) throw new Error(`Plan item "${filename}" not found`);
    return { item };
  }

  addPlanItem(input: AddPlanItemInput): PlanGetResult {
    const filename = this.engine.planManager.add(
      input.name, input.description, input.rationale, input.priority, input.body,
    );
    this.engine.context.setPlan(this.engine.planManager.compile() || "");
    return { item: this.engine.planManager.get(filename)! };
  }

  updatePlanPriority(input: UpdatePlanPriorityInput): void {
    if (!this.engine.planManager.updatePriority(input.filename, input.priority)) {
      throw new Error(`Plan item "${input.filename}" not found`);
    }
    this.engine.context.setPlan(this.engine.planManager.compile() || "");
  }

  updatePlanBody(input: UpdatePlanBodyInput): void {
    const item = this.engine.planManager.get(input.filename);
    if (!item) throw new Error(`Plan item "${input.filename}" not found`);
    const updated = item.body.replace(input.search, input.replace);
    if (updated === item.body) throw new Error(`Search text not found in "${input.filename}"`);
    this.engine.planManager.add(
      input.filename.replace(".md", ""), item.description, item.rationale, item.priority, updated,
    );
  }

  removePlanItem(filename: string): void {
    if (!this.engine.planManager.remove(filename)) {
      throw new Error(`Plan item "${filename}" not found`);
    }
    this.engine.context.setPlan(this.engine.planManager.compile() || "");
  }

  // ─── Skills ──────────────────────────────────────────────────────────────

  listSkills(): SkillListResult {
    return {
      skills: this.engine.skills.indexed.map((s): SkillDTO => ({
        name: s.name,
        description: s.description,
        filePath: s.filePath,
        location: s.filePath.includes(".config/voidrift") ? "global" : "workspace",
        active: s.active,
        triggers: { extensions: s.triggers.extensions ?? [], files: s.triggers.files ?? [], keywords: s.triggers.keywords ?? [] },
        agents: s.agents,
      })),
    };
  }

  toggleSkill(_name: string, _active: boolean): void {
    // Skills toggle by editing the YAML frontmatter `active` field in the file
    // TODO: implement when SkillManager exposes a toggle method
  }

  reindexSkills(): SkillListResult {
    this.engine.skills.index([
      join(this.engine.workspaceRoot, ".voidrift", "skills"),
      homedir() + "/.config/voidrift/skills",
    ]);
    return this.listSkills();
  }

  // ─── Templates ───────────────────────────────────────────────────────────

  listTemplates(): TemplateListResult {
    const slots = this.engine.templates.slotsByType("template");
    return {
      templates: slots.map((s): TemplateDTO => {
        const resolved = this.engine.templates.resolveSlot(s);
        return {
          key: s.key, label: s.label, description: s.description,
          source: s.sourcePlugin, activeLevel: resolved.source as any,
        };
      }),
    };
  }

  getTemplate(key: string): TemplateGetResult {
    const slot = this.engine.templates.slotsByType("template").find(s => s.key === key);
    if (!slot) throw new Error(`Template "${key}" not found`);
    const resolved = this.engine.templates.resolveSlot(slot);
    return { key, content: resolved.content, source: resolved.source };
  }

  // ─── Prompts ─────────────────────────────────────────────────────────────

  listPrompts(): PromptListResult {
    return {
      prompts: this.engine.prompts.list().map((e): PromptDTO => {
        const resolved = this.engine.prompts.resolve(e.key);
        return {
          key: e.key, label: e.label, description: e.description || "",
          source: e.sourcePlugin, activeLevel: resolved?.source as any || "default",
        };
      }),
    };
  }

  getPrompt(key: string): PromptGetResult {
    const resolved = this.engine.prompts.resolve(key);
    if (!resolved) throw new Error(`Prompt "${key}" not found`);
    return { key, content: resolved.body, source: resolved.source };
  }

  // ─── MCP ─────────────────────────────────────────────────────────────────

  listMCPServers(): MCPServerListResult {
    const configs = this.engine.mcp.loadConfigs();
    const servers = this.engine.mcp.all;
    const allNames = [...new Set([...configs.map(c => c.name), ...servers.map(s => s.name)])];

    return {
      servers: allNames.map((name): MCPServerDTO => {
        const srv = servers.find(s => s.name === name);
        const cfg = configs.find(c => c.name === name);
        return {
          name,
          status: srv?.status ?? "disconnected",
          transport: cfg?.transport ?? (cfg?.url ? "http-sse" : "stdio"),
          url: cfg?.url,
          toolCount: srv?.tools.length ?? 0,
          autoConnect: (cfg as any)?.autoConnect !== false,
        };
      }),
    };
  }

  async connectMCP(name: string): Promise<void> {
    const cfg = this.engine.mcp.loadConfigs().find(c => c.name === name);
    if (!cfg) throw new Error(`MCP server "${name}" not found`);
    await this.engine.mcp.connect(cfg);
  }

  disconnectMCP(name: string): void {
    this.engine.mcp.disconnect(name);
  }

  // ─── Memory ──────────────────────────────────────────────────────────────

  listMemory(): MemoryListResult {
    const activeMemory = this.engine.context.context.orbit.activeMemory;
    return {
      memories: this.engine.memory.all.map((m): MemoryDTO => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        keywords: m.context?.keywords ?? [],
        scope: m.filePath?.includes(".config/voidrift") ? "global" : "local",
        loaded: !!this.engine.memory.loadBody(m.id) && activeMemory.includes(this.engine.memory.loadBody(m.id)!),
      })),
    };
  }

  loadMemory(id: string): void {
    const body = this.engine.memory.loadBody(id);
    if (!body) throw new Error(`Memory "${id}" not found`);
    this.engine.context.loadMemory(body);
  }

  unloadMemory(id: string): void {
    const body = this.engine.memory.loadBody(id);
    if (!body) throw new Error(`Memory "${id}" not found`);
    const idx = this.engine.context.context.orbit.activeMemory.indexOf(body);
    if (idx !== -1) this.engine.context.unloadMemory(idx);
  }
}
