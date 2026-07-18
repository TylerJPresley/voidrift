/**
 * Session Brain — partition-based session persistence.
 *
 * Writes session state to individual files at `.voidrift/sessions/<session-id>/`
 * after each turn. Supports crash recovery, rewind, and agent switch.
 */
import { getGitSha } from "../output/workspace.js";
import type { SessionContext } from "../session/context.js";
import type { EventBus } from "../events/bus.js";
import type { SessionRepository } from "./session-repository.js";

export interface TurnSnapshot {
  turn: number;
  timestamp: number;
  agentId: string;
  gitSha: string;
}

export class SessionBrain {
  private repo: SessionRepository;
  private turnIndex = 0;
  private unsub: (() => void) | null = null;
  private sessionId: string;

  constructor(
    private workspaceRoot: string,
    sessionId: string,
    private bus: EventBus,
    repo?: SessionRepository,
  ) {
    this.sessionId = sessionId;
    this.repo = repo ?? (() => { throw new Error("SessionBrain requires a repository. Inject via bootstrap."); })();
    this.repo.init(sessionId);
  }

  /** Attach to event bus — writes state on TURN_COMPLETE. */
  attach(getContext: () => SessionContext, getAgentId: () => string): () => void {
    this.unsub = this.bus.subscribe("TURN_COMPLETE", () => {
      this.turnIndex++;
      this.save(getContext(), getAgentId());
    });
    return () => { if (this.unsub) this.unsub(); };
  }

  /** Write all session files atomically. */
  save(ctx: SessionContext, agentId: string): void {
    const sid = this.sessionId;

    // System
    this.repo.writeJson(sid, "system.metadata.json", {
      sessionId: this.sessionId,
      startTime: this.repo.readJson(sid, "system.metadata.json")?.startTime || Date.now(),
      workspaceRoot: this.workspaceRoot,
      turnCount: this.turnIndex,
    });

    const turns = this.repo.readJson(sid, "system.turns.json") || [];
    const gitSha = getGitSha(this.workspaceRoot);
    turns.push({ turn: this.turnIndex, timestamp: Date.now(), agentId, gitSha });
    this.repo.writeJson(sid, "system.turns.json", turns);

    // Agent
    this.repo.writeText(sid, "governance.persona.md", ctx.agent.activePersona);
    this.repo.writeJson(sid, "governance.skills.json", { bound: ctx.agent.boundSkills.length, active: ctx.orbit.activeSkills.length });
    this.repo.writeJson(sid, "governance.tools.json", ctx.agent.activeTools);

    // Orbit
    this.repo.writeText(sid, "workspace.plan.md", ctx.orbit.activePlan || "");
    this.repo.writeJson(sid, "workspace.focused.json", ctx.drift.focusedFiles.map(f => ({ path: f.path, totalLines: f.totalLines, readRanges: f.readRanges })));
    this.repo.writeJson(sid, "workspace.memory.json", ctx.orbit.activeMemory.length);

    // Void
    this.repo.writeJson(sid, "work.messages.json", ctx.void.fullHistory);
    this.repo.writeText(sid, "work.diagnostics.md", ctx.void.diagnostics || "");
  }

  /** Load session state from disk for recovery. */
  load(): { context: Partial<SessionContext>; turns: TurnSnapshot[] } | null {
    if (!this.repo.exists(this.sessionId)) return null;

    const sid = this.sessionId;
    const turns = this.repo.readJson(sid, "system.turns.json") || [];
    const messages = this.repo.readJson(sid, "work.messages.json") || [];
    const focused = this.repo.readJson(sid, "workspace.focused.json") || [];
    const plan = this.repo.readText(sid, "workspace.plan.md") || null;
    const persona = this.repo.readText(sid, "governance.persona.md") || "";
    const tools = this.repo.readJson(sid, "governance.tools.json") || [];
    const diagnostics = this.repo.readText(sid, "work.diagnostics.md") || null;

    this.turnIndex = turns.length;

    return {
      turns,
      context: {
        agent: { activePersona: persona, activeTools: tools, blockedTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
        orbit: { activePlan: plan, workspaceCodeMap: "", activeMemory: [], activeSkills: [] },
        drift: { focusedFiles: focused, gitStatus: null },
        void: { messages, fullHistory: messages, diagnostics: diagnostics || null, turnContext: [] },
      },
    };
  }

  /** Get the session directory path. */
  get path(): string { return "(session)"; }

  /** Get current turn index. */
  get turn(): number { return this.turnIndex; }

  /** Load a different session into the given context manager. */
  loadSession(sessionId: string, context: { setMessages: (m: any[]) => void; setFullHistory?: (m: any[]) => void; setPlan: (p: string | null) => void; setDiagnostics: (d: string | null) => void }): boolean {
    if (!this.repo.exists(sessionId)) return false;
    const messages = this.repo.readJson(sessionId, "work.messages.json") || [];
    const plan = this.repo.readText(sessionId, "workspace.plan.md") || null;
    const diag = this.repo.readText(sessionId, "work.diagnostics.md") || null;
    // Only user + assistant messages go to the model prompt (tool messages are invalid without their paired tool_calls)
    const promptMessages = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
    context.setMessages(promptMessages);
    if (context.setFullHistory) context.setFullHistory(messages);
    context.setPlan(plan);
    context.setDiagnostics(diag);
    // Update internal state to track the resumed session
    this.sessionId = sessionId;
    const turns = this.repo.readJson(sessionId, "system.turns.json") || [];
    this.turnIndex = turns.length;
    return true;
  }

  /** List all sessions on disk. */
  listSessions(): Array<{ id: string; startTime: number; turnCount: number; lastActivity: number }> {
    return this.repo.listSessions();
  }
}
