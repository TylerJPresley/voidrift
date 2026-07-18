import type { MemoryMeta } from "./memory.js";
import { TOOL_SCHEMAS } from "../tools/definitions.js";

// ─── Layer 1: Agent (never changes, always cached) ───────────────────────────

export interface AgentPartition {
  activePersona: string;
  activeTools: string[];
  blockedTools: string[];         // Tools the agent manifest excludes (for prompt injection)
  boundSkills: string[];          // Agent-manifest-declared skill bodies (static)
  skillDiscoveryIndex: string[];  // Lightweight name+trigger summaries of all available skills (static)
  activeMemoryIndex: MemoryMeta[];
  onDemandToolTOC?: string;       // Lightweight TOC of tools available via search_tools (static per agent)
}

// ─── Layer 2: Orbit (stable project landscape, rarely changes) ───────────────

export interface OrbitPartition {
  workspaceCodeMap: string;
  activePlan: string | null;
  activeMemory: string[];
  activeSkills: string[];         // Dynamically loaded skill bodies (trigger-matched per turn)
}

// ─── Layer 3: Drift (active working set, changes on tool use) ────────────────

export interface FocusedFile {
  path: string;
  summary: string;
  totalLines: number;
  readRanges: Array<[number, number]>;
}

export interface DriftPartition {
  focusedFiles: FocusedFile[];
  gitStatus: string | null;
}

// ─── Layer 4: Void (transient, changes every turn, never cached) ─────────────

export interface TurnContext {
  label: string;
  content: string;
}

export interface VoidPartition {
  messages: Message[];
  fullHistory: Message[];
  diagnostics: string | null;
  turnContext: TurnContext[];
}

// ─── Shared Types ────────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  contentBlocks?: ContentBlock[];
  toolCalls?: string[];   // tool names used this turn (for preflight lookback)
  summary?: string;       // one-sentence context summary (for preflight routing)
  timestamp?: number;
}

export interface SessionContext {
  agent: AgentPartition;
  orbit: OrbitPartition;
  drift: DriftPartition;
  void: VoidPartition;
}

/**
 * Four-Layer Context Manager (Agent → Orbit → Drift → Void).
 *
 * Ascending volatility: Agent is static, Void is ephemeral.
 * This ordering maximizes prompt prefix cache reuse across turns.
 */
export class ContextManager {
  private ctx: SessionContext;
  private bus?: import("../events/bus.js").EventBus;

  constructor(persona: string, codeMap: string, bus?: import("../events/bus.js").EventBus) {
    this.bus = bus;
    this.ctx = {
      agent: { activePersona: persona, activeTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
      orbit: { workspaceCodeMap: codeMap, activePlan: null, activeMemory: [], activeSkills: [] },
      drift: { focusedFiles: [], gitStatus: null },
      void: { messages: [], fullHistory: [], diagnostics: null, turnContext: [] },
    };
  }

  get context(): SessionContext {
    return this.ctx;
  }

  // ─── Agent Layer ─────────────────────────────────────────────────────────
  setPersona(persona: string): void { this.ctx.agent.activePersona = persona; }
  setTools(tools: string[]): void { this.ctx.agent.activeTools = tools; }
  setBlockedTools(tools: string[]): void { this.ctx.agent.blockedTools = tools; }
  setBoundSkills(skills: string[]): void { this.ctx.agent.boundSkills = skills; }
  setSkillDiscoveryIndex(index: string[]): void { this.ctx.agent.skillDiscoveryIndex = index; }
  setMemoryIndex(index: MemoryMeta[]): void { this.ctx.agent.activeMemoryIndex = index; }

  // ─── Orbit Layer ─────────────────────────────────────────────────────────
  setActiveSkills(skills: string[]): void { this.ctx.orbit.activeSkills = skills; }
  setPlan(plan: string | null): void { this.ctx.orbit.activePlan = plan; }
  setCodeMap(map: string): void { this.ctx.orbit.workspaceCodeMap = map; }
  loadMemory(content: string): void {
    this.ctx.orbit.activeMemory.push(content);
  }
  unloadMemory(index: number): void {
    this.ctx.orbit.activeMemory.splice(index, 1);
  }

  // ─── Drift Layer ─────────────────────────────────────────────────────────
  setGitStatus(status: string | null): void { this.ctx.drift.gitStatus = status; }
  clearFocusedFiles(): void {
    const paths = this.ctx.drift.focusedFiles.map(f => f.path);
    this.ctx.drift.focusedFiles = [];
    for (const path of paths) {
      this.bus?.publish("FILE_UNFOCUSED", { path, reason: "cleared" } as any);
    }
  }

  focusFile(path: string, summary: string, totalLines: number, readRange?: [number, number], maxFiles = 3, maxTokenBudget = 8000): void {
    const existing = this.ctx.drift.focusedFiles.find(f => f.path === path);
    if (existing) {
      existing.summary = summary;
      existing.totalLines = totalLines;
      if (readRange) {
        const overlaps = existing.readRanges.some(([s, e]) => readRange[0] >= s && readRange[1] <= e);
        if (!overlaps) existing.readRanges.push(readRange);
      }
      this.ctx.drift.focusedFiles = [...this.ctx.drift.focusedFiles.filter(f => f.path !== path), existing];
    } else {
      this.ctx.drift.focusedFiles.push({ path, summary, totalLines, readRanges: readRange ? [readRange] : [] });
    }
    this.evictToBudget(maxFiles, maxTokenBudget);
    this.bus?.publish("FILE_FOCUSED", { path, totalLines, tokensUsed: Math.ceil(summary.length / 4) } as any);
  }

  private evictToBudget(maxFiles: number, maxBudget: number): void {
    const calculateTokens = () => this.ctx.drift.focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
    while (
      (this.ctx.drift.focusedFiles.length > maxFiles || calculateTokens() > maxBudget) &&
      this.ctx.drift.focusedFiles.length > 0
    ) {
      const evicted = this.ctx.drift.focusedFiles.shift();
      if (evicted) this.bus?.publish("FILE_UNFOCUSED", { path: evicted.path, reason: "evicted" } as any);
    }
  }

  // ─── Void Layer ──────────────────────────────────────────────────────────
  addMessage(msg: Message): void {
    const stamped = { ...msg, timestamp: Date.now() };
    this.ctx.void.messages.push(stamped);
    this.ctx.void.fullHistory.push(stamped);
  }
  setDiagnostics(diag: string | null): void { this.ctx.void.diagnostics = diag; }
  getMessages(): Message[] { return this.ctx.void.messages; }
  getFullHistory(): Message[] { return this.ctx.void.fullHistory; }
  setMessages(msgs: Message[]): void { this.ctx.void.messages = msgs; }
  setFullHistory(msgs: Message[]): void { this.ctx.void.fullHistory = msgs; }
  injectTurnContext(label: string, content: string): void { this.ctx.void.turnContext.push({ label, content }); }
  clearTurnContext(): void { this.ctx.void.turnContext = []; }

  /** Estimate total tokens across all four context layers. */
  getTokenCount(): number {
    const estimate = (text: string) => Math.ceil(text.length / 4);
    const agent = estimate(this.ctx.agent.activePersona)
      + Math.ceil(JSON.stringify(TOOL_SCHEMAS.filter(t => this.ctx.agent.activeTools.includes(t.name))).length / 4)
      + this.ctx.agent.boundSkills.reduce((a, s) => a + estimate(s), 0)
      + this.ctx.agent.skillDiscoveryIndex.reduce((a, s) => a + estimate(s), 0)
      + this.ctx.agent.activeMemoryIndex.reduce((a, m) => a + estimate(m.title + m.summary), 0);
    const orbit = this.ctx.orbit.activeSkills.reduce((a, s) => a + estimate(s), 0)
      + this.ctx.orbit.activeMemory.reduce((a, m) => a + estimate(m), 0)
      + (this.ctx.orbit.activePlan ? estimate(this.ctx.orbit.activePlan) : 0);
    const drift = (this.ctx.orbit.workspaceCodeMap.length > 0 ? estimate(this.ctx.orbit.workspaceCodeMap) : 0)
      + this.ctx.drift.focusedFiles.reduce((a, f) => a + estimate(f.summary), 0)
      + (this.ctx.drift.gitStatus ? estimate(this.ctx.drift.gitStatus) : 0);
    const void_ = this.ctx.void.messages.reduce((a, m) => a + estimate(m.content), 0)
      + (this.ctx.void.diagnostics ? estimate(this.ctx.void.diagnostics) : 0)
      + this.ctx.void.turnContext.reduce((a, t) => a + estimate(t.label + t.content), 0);
    return agent + orbit + drift + void_;
  }
}
