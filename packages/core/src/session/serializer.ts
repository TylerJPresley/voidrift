import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import type { SessionContext } from "./context.js";
import type { EventBus } from "../events/bus.js";

export interface TurnStateJSON {
  sessionId: string;
  turnIndex: number;
  timestamp: number;
  gitState: {
    currentBranch: string;
    checkpointSha: string;
    isDirty: boolean;
  };
  harnessState: {
    approvalMode: string;
    activeLocks: string[];
  };
  graphState: {
    activeNode: string;
    currentNodeState: {
      retryCount: number;
      lastExecutionStatus: string;
    };
  };
  contextSnapshot: {
    governance: { loadedSkills: string[] };
    workspace: { activePlan: string | null; focusedFiles: Array<{ path: string; totalLines: number; readRanges: Array<[number, number]> }> };
    work: { messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>; diagnostics: string | null };
  };
}

/**
 * Turn Serializer (G-10).
 *
 * Persists full session state to <workspace>/.voidrift/session_state.json
 * on every TURN_COMPLETE event. Supports recovery via /resume.
 */
export class TurnSerializer {
  private filePath: string;
  private turnIndex = 0;

  constructor(private workspaceRoot: string, private sessionId: string, private bus: EventBus) {
    const dir = join(workspaceRoot, ".voidrift");
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "session_state.json");
  }

  attach(getContext: () => SessionContext, getMode?: () => string, getNode?: () => string): () => void {
    return this.bus.subscribe("TURN_COMPLETE", () => {
      this.turnIndex++;
      const ctx = getContext();
      this.save(ctx, getMode?.() ?? "chat", getNode?.() ?? "idle");
    });
  }

  save(ctx: SessionContext, approvalMode: string = "prompt", activeNode: string = "idle"): void {
    const state: TurnStateJSON = {
      sessionId: this.sessionId,
      turnIndex: this.turnIndex,
      timestamp: Date.now(),
      gitState: this.getGitState(),
      harnessState: {
        approvalMode,
        activeLocks: this.getActiveLocks(),
      },
      graphState: {
        activeNode,
        currentNodeState: { retryCount: 0, lastExecutionStatus: "complete" },
      },
      contextSnapshot: {
        governance: { loadedSkills: [...ctx.governance.boundSkills.map((_, i) => `bound-${i}`), ...ctx.workspace.activeSkills.map((_, i) => `active-${i}`)] },
        workspace: {
          activePlan: ctx.workspace.activePlan,
          focusedFiles: ctx.workspace.focusedFiles.map((f) => ({ path: f.path, totalLines: f.totalLines, readRanges: f.readRanges })),
        },
        work: {
          messages: ctx.work.messages.map((m) => ({ role: m.role, content: m.content })),
          diagnostics: ctx.work.diagnostics,
        },
      },
    };

    writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }

  load(): TurnStateJSON | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf-8"));
      if (!raw.sessionId || !raw.contextSnapshot) return null;
      return raw;
    } catch {
      return null;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get currentTurn(): number {
    return this.turnIndex;
  }

  private getGitState(): TurnStateJSON["gitState"] {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      const sha = execSync("git rev-parse --short HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      const status = execSync("git status --porcelain", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      return { currentBranch: branch, checkpointSha: sha, isDirty: status.length > 0 };
    } catch {
      return { currentBranch: "unknown", checkpointSha: "unknown", isDirty: false };
    }
  }

  private getActiveLocks(): string[] {
    const locksPath = join(this.workspaceRoot, ".voidrift", "locks.json");
    if (!existsSync(locksPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(locksPath, "utf-8"));
      return (raw.activeLocks ?? []).flatMap((l: any) => l.lockedPaths ?? []);
    } catch {
      return [];
    }
  }
}
