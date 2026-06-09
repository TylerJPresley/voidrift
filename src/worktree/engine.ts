import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { EventBus } from "../events/bus.js";
import { writeWorktreeMeta } from "../bootstrap/cleanup.js";

export interface LockEntry {
  lockId: string;
  subagentId: string;
  pid: number;
  lockedPaths: string[];
  acquiredAt: number;
}

export interface QueueEntry {
  taskId: string;
  subagentId: string;
  requestedPaths: string[];
  spawnPayload: { prompt: string; role: string; worktreePath: string };
  queuedAt: number;
}

export interface SubagentTask {
  id: string;
  files: string[];
  worktreePath: string;
  branch: string;
  status: "pending" | "running" | "completed" | "failed" | "queued";
}

/**
 * Git Worktree Orchestration & Concurrency Engine (G-06).
 *
 * Persistent lock ledger (locks.json) + FIFO queue (lock_queue.json).
 * Path intersection with parent directory matching.
 * Merge conflict fallback (G-13).
 */
export class WorktreeEngine {
  private locksPath: string;
  private queuePath: string;
  private worktreeDir: string;

  constructor(private workspaceRoot: string, private bus: EventBus) {
    this.locksPath = join(workspaceRoot, ".voidrift", "locks.json");
    this.queuePath = join(workspaceRoot, ".voidrift", "lock_queue.json");
    this.worktreeDir = join(workspaceRoot, ".voidrift", "worktrees");
    mkdirSync(this.worktreeDir, { recursive: true });
  }

  get locks(): LockEntry[] {
    return this.readLocks();
  }

  get queue(): QueueEntry[] {
    return this.readQueue();
  }

  async schedule(
    files: string[],
    execute: (worktreePath: string) => Promise<"success" | "failed">
  ): Promise<SubagentTask> {
    const id = randomUUID().slice(0, 8);
    const branch = `voidrift-sub-${id}`;
    const worktreePath = join(this.worktreeDir, id);
    const task: SubagentTask = { id, files, worktreePath, branch, status: "pending" };

    if (this.hasOverlap(files)) {
      task.status = "queued";
      this.enqueue({ taskId: id, subagentId: id, requestedPaths: files, spawnPayload: { prompt: "", role: "engineer", worktreePath }, queuedAt: Date.now() });
      return task;
    }

    await this.run(task, execute);
    return task;
  }

  private async run(task: SubagentTask, execute: (worktreePath: string) => Promise<"success" | "failed">): Promise<void> {
    // Acquire locks
    const lockEntry: LockEntry = { lockId: `lock-${task.id}`, subagentId: task.id, pid: process.pid, lockedPaths: task.files, acquiredAt: Date.now() };
    this.addLock(lockEntry);
    this.bus.publish("LOCKS_UPDATED", { activeLocks: this.locks.flatMap((l) => l.lockedPaths) });
    this.bus.publish("SUBAGENT_SPAWNED", { subagentId: task.id, worktreePath: task.worktreePath });

    // Provision worktree
    task.status = "running";
    this.provision(task);

    // Execute
    try {
      const status = await execute(task.worktreePath);
      task.status = status === "success" ? "completed" : "failed";
      if (task.status === "completed") this.merge(task);
    } catch {
      task.status = "failed";
    }

    // Teardown
    this.teardown(task);
    this.removeLock(task.id);
    this.bus.publish("LOCKS_UPDATED", { activeLocks: this.locks.flatMap((l) => l.lockedPaths) });
    this.bus.publish("SUBAGENT_COMPLETED", { subagentId: task.id, status: task.status === "completed" ? "success" : "failed" });

    // Drain queue
    await this.drainQueue(execute);
  }

  private async drainQueue(execute: (worktreePath: string) => Promise<"success" | "failed">): Promise<void> {
    const q = this.readQueue();
    const ready = q.filter((entry) => !this.hasOverlap(entry.requestedPaths));
    for (const entry of ready) {
      this.removeFromQueue(entry.taskId);
      const task: SubagentTask = { id: entry.subagentId, files: entry.requestedPaths, worktreePath: entry.spawnPayload.worktreePath, branch: `voidrift-sub-${entry.subagentId}`, status: "pending" };
      await this.run(task, execute);
    }
  }

  /**
   * Path intersection: overlaps if identical or one is parent of another.
   */
  private hasOverlap(requestedPaths: string[]): boolean {
    const activePaths = this.locks.flatMap((l) => l.lockedPaths);
    for (const req of requestedPaths) {
      for (const locked of activePaths) {
        if (req === locked || req.startsWith(locked + "/") || locked.startsWith(req + "/")) return true;
      }
    }
    return false;
  }

  private provision(task: SubagentTask): void {
    mkdirSync(task.worktreePath, { recursive: true });
    try {
      execSync(`git worktree add -b ${task.branch} "${task.worktreePath}"`, { cwd: this.workspaceRoot, stdio: "ignore" });
    } catch {
      // Fallback if branch exists
      mkdirSync(task.worktreePath, { recursive: true });
    }
    writeWorktreeMeta(task.worktreePath);
  }

  /**
   * Merge with conflict fallback (G-13).
   */
  private merge(task: SubagentTask): void {
    try {
      execSync(`git merge ${task.branch} --no-edit`, { cwd: this.workspaceRoot, stdio: "ignore" });
    } catch {
      // Conflict detected — execute fallback
      try { execSync("git merge --abort", { cwd: this.workspaceRoot, stdio: "ignore" }); } catch {}
      try { execSync(`git branch recovery/subagent-${task.id} ${task.branch}`, { cwd: this.workspaceRoot, stdio: "ignore" }); } catch {}
      try {
        execSync(`git -C "${task.worktreePath}" add -A`, { stdio: "ignore" });
        execSync(`git -C "${task.worktreePath}" commit -m "subagent-recovery-checkpoint"`, { stdio: "ignore" });
      } catch {}
      this.bus.publish("ERROR_OCCURRED", { message: `Merge conflict on subagent ${task.id}. Recovery branch: recovery/subagent-${task.id}`, source: "worktree" });
    }
  }

  private teardown(task: SubagentTask): void {
    try { execSync(`git worktree remove "${task.worktreePath}" --force`, { cwd: this.workspaceRoot, stdio: "ignore" }); } catch {}
    try { execSync(`git branch -D ${task.branch}`, { cwd: this.workspaceRoot, stdio: "ignore" }); } catch {}
  }

  // Persistent lock file operations
  private readLocks(): LockEntry[] {
    if (!existsSync(this.locksPath)) return [];
    try { return JSON.parse(readFileSync(this.locksPath, "utf-8")).activeLocks ?? []; } catch { return []; }
  }

  private addLock(entry: LockEntry): void {
    const locks = this.readLocks();
    locks.push(entry);
    writeFileSync(this.locksPath, JSON.stringify({ activeLocks: locks }, null, 2));
  }

  private removeLock(subagentId: string): void {
    const locks = this.readLocks().filter((l) => l.subagentId !== subagentId);
    writeFileSync(this.locksPath, JSON.stringify({ activeLocks: locks }, null, 2));
  }

  // Persistent queue file operations
  private readQueue(): QueueEntry[] {
    if (!existsSync(this.queuePath)) return [];
    try { return JSON.parse(readFileSync(this.queuePath, "utf-8")).queue ?? []; } catch { return []; }
  }

  private enqueue(entry: QueueEntry): void {
    const q = this.readQueue();
    q.push(entry);
    writeFileSync(this.queuePath, JSON.stringify({ queue: q }, null, 2));
  }

  private removeFromQueue(taskId: string): void {
    const q = this.readQueue().filter((e) => e.taskId !== taskId);
    writeFileSync(this.queuePath, JSON.stringify({ queue: q }, null, 2));
  }
}
