import type { MemoryMeta } from "./memory.js";

// ─── Layer 1: Agent (never changes, always cached) ───────────────────────────

export interface AgentPartition {
  activePersona: string;
  activeTools: string[];
  boundSkills: string[];          // Agent-manifest-declared skill bodies (static)
  skillDiscoveryIndex: string[];  // Lightweight name+trigger summaries of all available skills (static)
  activeMemoryIndex: MemoryMeta[];
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
  diagnostics: string | null;
  turnContext: TurnContext[];
}

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: number;
}

export interface SessionContext {
  agent: AgentPartition;
  orbit: OrbitPartition;
  drift: DriftPartition;
  void: VoidPartition;
}

// Legacy aliases for compatibility during migration
export type GovernancePartition = AgentPartition;
export type WorkspacePartition = OrbitPartition & DriftPartition;
export type WorkPartition = VoidPartition;

/**
 * Four-Layer Context Manager (Agent → Orbit → Drift → Void).
 *
 * Ascending volatility: Agent is static, Void is ephemeral.
 * This ordering maximizes prompt prefix cache reuse across turns.
 */
export class ContextManager {
  private ctx: SessionContext;

  constructor(persona: string, codeMap: string) {
    this.ctx = {
      agent: { activePersona: persona, activeTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
      orbit: { workspaceCodeMap: codeMap, activePlan: null, activeMemory: [], activeSkills: [] },
      drift: { focusedFiles: [], gitStatus: null },
      void: { messages: [], diagnostics: null, turnContext: [] },
    };
  }

  get context(): SessionContext {
    return this.ctx;
  }

  // Legacy accessor — provides a merged view for code that still uses the old shape
  get legacyContext() {
    return {
      governance: this.ctx.agent,
      workspace: {
        ...this.ctx.orbit,
        ...this.ctx.drift,
      },
      work: this.ctx.void,
    };
  }

  // ─── Agent Layer ─────────────────────────────────────────────────────────
  setPersona(persona: string): void { this.ctx.agent.activePersona = persona; }
  setTools(tools: string[]): void { this.ctx.agent.activeTools = tools; }
  setBoundSkills(skills: string[]): void { this.ctx.agent.boundSkills = skills; }
  setSkillDiscoveryIndex(index: string[]): void { this.ctx.agent.skillDiscoveryIndex = index; }
  setMemoryIndex(index: MemoryMeta[]): void { this.ctx.agent.activeMemoryIndex = index; }

  // ─── Orbit Layer ─────────────────────────────────────────────────────────
  setActiveSkills(skills: string[]): void { this.ctx.orbit.activeSkills = skills; }
  setPlan(plan: string | null): void { this.ctx.orbit.activePlan = plan; }
  setCodeMap(map: string): void { this.ctx.orbit.workspaceCodeMap = map; }
  loadMemory(content: string): void { this.ctx.orbit.activeMemory.push(content); }
  unloadMemory(index: number): void { this.ctx.orbit.activeMemory.splice(index, 1); }

  // ─── Drift Layer ─────────────────────────────────────────────────────────
  setGitStatus(status: string | null): void { this.ctx.drift.gitStatus = status; }
  clearFocusedFiles(): void { this.ctx.drift.focusedFiles = []; }

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
  }

  private evictToBudget(maxFiles: number, maxBudget: number): void {
    const calculateTokens = () => this.ctx.drift.focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
    while (
      (this.ctx.drift.focusedFiles.length > maxFiles || calculateTokens() > maxBudget) &&
      this.ctx.drift.focusedFiles.length > 0
    ) {
      this.ctx.drift.focusedFiles.shift();
    }
  }

  // ─── Void Layer ──────────────────────────────────────────────────────────
  addMessage(msg: Message): void { this.ctx.void.messages.push({ ...msg, timestamp: Date.now() }); }
  setDiagnostics(diag: string | null): void { this.ctx.void.diagnostics = diag; }
  getMessages(): Message[] { return this.ctx.void.messages; }
  setMessages(msgs: Message[]): void { this.ctx.void.messages = msgs; }
  injectTurnContext(label: string, content: string): void { this.ctx.void.turnContext.push({ label, content }); }
  clearTurnContext(): void { this.ctx.void.turnContext = []; }
}
