import type { MemoryMeta } from "./memory.js";

export interface GovernancePartition {
  activePersona: string;
  activeTools: string[];
  boundSkills: string[];          // Agent-manifest-declared skill bodies (static)
  skillDiscoveryIndex: string[];  // Lightweight name+trigger summaries of all available skills (static)
  activeMemoryIndex: MemoryMeta[];
}

export interface FocusedFile {
  path: string;
  summary: string;
  totalLines: number;
  readRanges: Array<[number, number]>;
}

export interface WorkspacePartition {
  activePlan: string | null;
  focusedFiles: FocusedFile[];
  activeSkills: string[];         // Dynamically loaded skill bodies (trigger-matched per turn)
  workspaceCodeMap: string;
  activeMemory: string[];
  gitStatus: string | null;
}

export interface WorkPartition {
  messages: Message[];
  diagnostics: string | null;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: number;
}

export interface SessionContext {
  governance: GovernancePartition;
  workspace: WorkspacePartition;
  work: WorkPartition;
}

/**
 * Three-Partition Context Manager.
 * Manages governance (immutable rules), workspace (semi-dynamic), and work (volatile) partitions.
 */
export class ContextManager {
  private ctx: SessionContext;

  constructor(persona: string, codeMap: string) {
    this.ctx = {
      governance: { activePersona: persona, activeTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
      workspace: { activePlan: null, focusedFiles: [], activeSkills: [], workspaceCodeMap: codeMap, activeMemory: [], gitStatus: null },
      work: { messages: [], diagnostics: null },
    };
  }

  get context(): SessionContext {
    return this.ctx;
  }

  // Governance
  setPersona(persona: string): void { this.ctx.governance.activePersona = persona; }
  setTools(tools: string[]): void { this.ctx.governance.activeTools = tools; }
  setBoundSkills(skills: string[]): void { this.ctx.governance.boundSkills = skills; }
  setSkillDiscoveryIndex(index: string[]): void { this.ctx.governance.skillDiscoveryIndex = index; }
  setMemoryIndex(index: MemoryMeta[]): void { this.ctx.governance.activeMemoryIndex = index; }

  // Workspace
  setActiveSkills(skills: string[]): void { this.ctx.workspace.activeSkills = skills; }
  setPlan(plan: string | null): void { this.ctx.workspace.activePlan = plan; }
  setCodeMap(map: string): void { this.ctx.workspace.workspaceCodeMap = map; }
  setGitStatus(status: string | null): void { this.ctx.workspace.gitStatus = status; }

  focusFile(path: string, summary: string, totalLines: number, readRange?: [number, number], maxFiles = 3, maxTokenBudget = 8000): void {
    const existing = this.ctx.workspace.focusedFiles.find(f => f.path === path);
    if (existing) {
      existing.summary = summary;
      existing.totalLines = totalLines;
      if (readRange) {
        // Merge range if not already tracked
        const overlaps = existing.readRanges.some(([s, e]) => readRange[0] >= s && readRange[1] <= e);
        if (!overlaps) existing.readRanges.push(readRange);
      }
      // Move to end (most recent)
      this.ctx.workspace.focusedFiles = [...this.ctx.workspace.focusedFiles.filter(f => f.path !== path), existing];
    } else {
      this.ctx.workspace.focusedFiles.push({ path, summary, totalLines, readRanges: readRange ? [readRange] : [] });
    }

    // Dynamic Eviction: Evict based on count or token budget
    this.evictToBudget(maxFiles, maxTokenBudget);
  }

  private evictToBudget(maxFiles: number, maxBudget: number): void {
    const calculateTokens = () => this.ctx.workspace.focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
    while (
      (this.ctx.workspace.focusedFiles.length > maxFiles || calculateTokens() > maxBudget) &&
      this.ctx.workspace.focusedFiles.length > 0
    ) {
      this.ctx.workspace.focusedFiles.shift(); // LRU eviction
    }
  }

  loadMemory(content: string): void { this.ctx.workspace.activeMemory.push(content); }
  unloadMemory(index: number): void { this.ctx.workspace.activeMemory.splice(index, 1); }

  // Work
  addMessage(msg: Message): void { this.ctx.work.messages.push({ ...msg, timestamp: Date.now() }); }
  setDiagnostics(diag: string | null): void { this.ctx.work.diagnostics = diag; }
  getMessages(): Message[] { return this.ctx.work.messages; }
  setMessages(msgs: Message[]): void { this.ctx.work.messages = msgs; }
  clearFocusedFiles(): void { this.ctx.workspace.focusedFiles = []; }
}
