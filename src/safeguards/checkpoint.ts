import { execSync } from "child_process";
import type { EventBus } from "../events/bus.js";

/**
 * Git Checkpoint System.
 *
 * On every TURN_COMPLETE, creates a git commit tagged `voidrift-checkpoint-turn-<N>`
 * if the workspace has uncommitted changes from tool executions.
 */
export class GitCheckpointer {
  private turnIndex = 0;

  constructor(private workspaceRoot: string, private bus: EventBus) {}

  attach(): () => void {
    return this.bus.subscribe("TURN_COMPLETE", () => {
      this.turnIndex++;
      this.checkpoint();
    });
  }

  checkpoint(): string | null {
    if (!this.isDirty()) return null;

    const tag = `voidrift-checkpoint-turn-${this.turnIndex}`;
    try {
      execSync("git add -A", { cwd: this.workspaceRoot, stdio: "ignore" });
      execSync(`git commit -m "${tag}" --allow-empty`, { cwd: this.workspaceRoot, stdio: "ignore" });
      const sha = execSync("git rev-parse --short HEAD", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      return sha;
    } catch {
      return null;
    }
  }

  rollbackTo(turn: number): boolean {
    const tag = `voidrift-checkpoint-turn-${turn}`;
    try {
      // Find the commit with this message
      const sha = execSync(`git log --all --oneline --grep="${tag}" --format="%H" -1`, { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (!sha) return false;
      execSync(`git reset --hard ${sha}`, { cwd: this.workspaceRoot, stdio: "ignore" });
      this.turnIndex = turn;
      return true;
    } catch {
      return false;
    }
  }

  get currentTurn(): number {
    return this.turnIndex;
  }

  private isDirty(): boolean {
    try {
      const status = execSync("git status --porcelain", { cwd: this.workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      return status.length > 0;
    } catch {
      return false;
    }
  }
}
