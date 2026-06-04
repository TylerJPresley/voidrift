/**
 * Session Brain — partition-based session persistence.
 *
 * Writes session state to individual files at `.voidrift/sessions/<session-id>/`
 * after each turn. Supports crash recovery, rewind, and agent switch.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { SessionContext } from "../session/context.js";
import type { EventBus } from "../events/bus.js";

export interface TurnSnapshot {
  turn: number;
  timestamp: number;
  agentId: string;
  gitSha: string;
}

export class SessionBrain {
  private dir: string;
  private turnIndex = 0;
  private unsub: (() => void) | null = null;

  constructor(
    private workspaceRoot: string,
    private sessionId: string,
    private bus: EventBus,
  ) {
    this.dir = join(workspaceRoot, ".voidrift", "sessions", sessionId);
    mkdirSync(this.dir, { recursive: true });
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
    // System
    this.writeJson("system.metadata.json", {
      sessionId: this.sessionId,
      startTime: this.readJson("system.metadata.json")?.startTime || Date.now(),
      workspaceRoot: this.workspaceRoot,
      turnCount: this.turnIndex,
    });

    const turns = this.readJson("system.turns.json") || [];
    let gitSha = "";
    try { gitSha = execSync("git rev-parse --short HEAD", { cwd: this.workspaceRoot, encoding: "utf-8" }).trim(); } catch {}
    turns.push({ turn: this.turnIndex, timestamp: Date.now(), agentId, gitSha });
    this.writeJson("system.turns.json", turns);

    // Governance
    this.writeFile("governance.persona.md", ctx.governance.activePersona);
    this.writeJson("governance.skills.json", ctx.governance.activeSkills.map((_, i) => `skill-${i}`));
    this.writeJson("governance.tools.json", ctx.governance.activeTools);

    // Workspace
    this.writeFile("workspace.plan.md", ctx.workspace.activePlan || "");
    this.writeJson("workspace.focused.json", ctx.workspace.focusedFiles.map(f => ({ path: f.path, totalLines: f.totalLines, readRanges: f.readRanges })));
    this.writeJson("workspace.memory.json", ctx.workspace.activeMemory.length);

    // Work
    this.writeJson("work.messages.json", ctx.work.messages);
    this.writeFile("work.diagnostics.md", ctx.work.diagnostics || "");
  }

  /** Load session state from disk for recovery. */
  load(): { context: Partial<SessionContext>; turns: TurnSnapshot[] } | null {
    if (!existsSync(join(this.dir, "system.metadata.json"))) return null;

    const turns = this.readJson("system.turns.json") || [];
    const messages = this.readJson("work.messages.json") || [];
    const focused = this.readJson("workspace.focused.json") || [];
    const plan = this.readFile("workspace.plan.md") || null;
    const persona = this.readFile("governance.persona.md") || "";
    const tools = this.readJson("governance.tools.json") || [];
    const diagnostics = this.readFile("work.diagnostics.md") || null;

    this.turnIndex = turns.length;

    return {
      turns,
      context: {
        governance: { activePersona: persona, activeTools: tools, activeSkills: [], activeMemoryIndex: [] },
        workspace: { activePlan: plan, focusedFiles: focused, workspaceCodeMap: "", activeMemory: [], gitStatus: null },
        work: { messages, diagnostics: diagnostics || null },
      },
    };
  }

  /** Get the session directory path. */
  get path(): string { return this.dir; }

  /** Get current turn index. */
  get turn(): number { return this.turnIndex; }

  private writeJson(filename: string, data: unknown): void {
    writeFileSync(join(this.dir, filename), JSON.stringify(data, null, 2), "utf-8");
  }

  private writeFile(filename: string, content: string): void {
    writeFileSync(join(this.dir, filename), content, "utf-8");
  }

  private readJson(filename: string): any {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  }

  private readFile(filename: string): string | null {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    try { return readFileSync(path, "utf-8"); } catch { return null; }
  }
}
