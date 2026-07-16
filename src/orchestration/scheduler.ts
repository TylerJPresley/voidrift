import type { EventBus } from "../events/bus.js";
import { spawn, type ChildProcess } from "child_process";

export interface ScheduledTask {
  id: string;
  type: "cron" | "delay" | "background";
  pattern: string;
  instruction: string;
  createdAt: number;
  nextRunAt: number | null;
  status: "active" | "fired" | "cancelled" | "running" | "completed" | "failed";
  output?: string;
}

/**
 * Background Timer & Scheduled Task Cron.
 *
 * Registers tasks to execute on a cron interval or after a one-shot delay.
 * Also manages background command execution with process tracking.
 */
export class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private processes = new Map<string, ChildProcess>();

  constructor(private bus: EventBus, private onFire: (instruction: string) => void) {}

  /**
   * Run a command in the background. Returns immediately with task ID.
   */
  backgroundExec(command: string, workspaceRoot: string): ScheduledTask {
    const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: ScheduledTask = { id, type: "background", pattern: command, instruction: command, createdAt: Date.now(), nextRunAt: null, status: "running" };
    this.tasks.push(task);

    const child = spawn("sh", ["-c", command], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"], detached: false });
    this.processes.set(id, child);

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      task.status = code === 0 ? "completed" : "failed";
      task.output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 50000);
      this.processes.delete(id);
      this.bus.publish("TASK_COMPLETED", { taskId: id, status: task.status, output: task.output?.slice(0, 500) });
    });

    child.on("error", (err) => {
      task.status = "failed";
      task.output = `Error: ${err.message}`;
      this.processes.delete(id);
    });

    return task;
  }

  /** Get a task by ID */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** Get count of running background processes */
  get runningCount(): number {
    return this.processes.size + this.runSignals.size;
  }

  /** Kill all running background processes */
  killAll(): void {
    for (const [id, child] of this.processes) {
      child.kill("SIGTERM");
      const task = this.tasks.find(t => t.id === id);
      if (task) task.status = "cancelled";
    }
    this.processes.clear();
    // Also cancel any active run loops
    for (const [id, signal] of this.runSignals) {
      signal.interrupted = true;
      const task = this.tasks.find(t => t.id === id);
      if (task) task.status = "cancelled";
    }
    this.runSignals.clear();
  }

  private runSignals = new Map<string, { interrupted: boolean }>();

  /**
   * Register an active /run loop as a trackable task.
   * Returns a signal object and task ID. Set signal.interrupted = true to cancel.
   */
  registerRun(instruction: string): { id: string; signal: { interrupted: boolean } } {
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const signal = { interrupted: false };
    const task: ScheduledTask = { id, type: "background", pattern: "/run", instruction: instruction.slice(0, 200), createdAt: Date.now(), nextRunAt: null, status: "running" };
    this.tasks.push(task);
    this.runSignals.set(id, signal);
    this.bus.publish("TASK_SCHEDULED", { taskId: id, type: "background", pattern: "/run" });
    return { id, signal };
  }

  /** Mark a /run loop as complete */
  completeRun(id: string, success: boolean): void {
    const task = this.tasks.find(t => t.id === id);
    if (task) task.status = success ? "completed" : "failed";
    this.runSignals.delete(id);
    this.bus.publish("TASK_COMPLETED", { taskId: id, status: success ? "completed" : "failed" });
  }

  /**
   * Schedule a one-shot delay task.
   * @param delayMs Milliseconds to wait before firing.
   * @param instruction The prompt/command to execute.
   */
  scheduleDelay(delayMs: number, instruction: string): ScheduledTask {
    const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: ScheduledTask = { id, type: "delay", pattern: `${delayMs}ms`, instruction, createdAt: Date.now(), nextRunAt: Date.now() + delayMs, status: "active" };
    this.tasks.push(task);
    this.bus.publish("TASK_SCHEDULED", { taskId: id, type: "delay", pattern: `${delayMs}ms` });

    const timer = setTimeout(() => {
      task.status = "fired";
      this.timers.delete(id);
      this.bus.publish("TASK_FIRED", { taskId: id, instruction });
      this.onFire(instruction);
    }, delayMs);
    this.timers.set(id, timer);

    return task;
  }

  /**
   * Schedule a recurring cron task.
   * Simplified: runs at fixed interval parsed from cron-like pattern.
   */
  scheduleCron(pattern: string, instruction: string): ScheduledTask {
    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const intervalMs = parseCronToMs(pattern);
    const task: ScheduledTask = { id, type: "cron", pattern, instruction, createdAt: Date.now(), nextRunAt: Date.now() + intervalMs, status: "active" };
    this.tasks.push(task);
    this.bus.publish("TASK_SCHEDULED", { taskId: id, type: "cron", pattern });

    const timer = setInterval(() => {
      task.nextRunAt = Date.now() + intervalMs;
      this.bus.publish("TASK_FIRED", { taskId: id, instruction });
      this.onFire(instruction);
    }, intervalMs);
    this.timers.set(id, timer);

    return task;
  }

  cancel(id: string): boolean {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return false;
    task.status = "cancelled";
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); clearInterval(timer); this.timers.delete(id); }
    return true;
  }

  cancelAll(): void {
    for (const [id, timer] of this.timers) { clearTimeout(timer); clearInterval(timer); }
    this.timers.clear();
    this.tasks.forEach((t) => { if (t.status === "active") t.status = "cancelled"; });
  }

  get active(): ScheduledTask[] { return this.tasks.filter((t) => t.status === "active"); }
  get all(): ScheduledTask[] { return this.tasks; }
}

/** Parses 5-field cron patterns to next-run interval in milliseconds. */
function parseCronToMs(pattern: string): number {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5) return 30 * 60 * 1000; // default 30min

  const [minute, hour] = fields;

  // */N in minute field = every N minutes
  const minMatch = minute.match(/^\*\/(\d+)$/);
  if (minMatch) return parseInt(minMatch[1]) * 60 * 1000;

  // */N in hour field = every N hours
  const hourMatch = hour.match(/^\*\/(\d+)$/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 * 60 * 1000;

  // Specific minute with * hour = every hour at that minute
  if (/^\d+$/.test(minute) && hour === "*") return 60 * 60 * 1000;

  // Specific minute and hour = once daily (24h interval)
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 24 * 60 * 60 * 1000;

  // Default: every 30 minutes
  return 30 * 60 * 1000;
}

/** Parses delay strings like "15m", "2h", "30s" to milliseconds. */
export function parseDelay(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60000; // default 1 minute
  const [, num, unit] = match;
  const n = parseInt(num);
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 60 * 1000;
}
