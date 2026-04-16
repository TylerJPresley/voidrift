/**
 * ErrorTracker: accumulate structured errors during a command run (REQ-LOG-6).
 */

import { appendFileSync } from "node:fs";

export type ErrorCategory = "api" | "tool" | "filesystem" | "parse" | "timeout" | "budget" | "context";

export interface ErrorEvent {
  category: ErrorCategory;
  errorType: string;
  message: string;
  taskId?: string;
  recoverable: boolean;
  timestamp: string;
}

export class ErrorTracker {
  private _events: ErrorEvent[] = [];

  record(category: ErrorCategory, errorType: string, message: string, opts?: { taskId?: string; recoverable?: boolean }): void {
    this._events.push({
      category,
      errorType,
      message,
      taskId: opts?.taskId,
      recoverable: opts?.recoverable ?? true,
      timestamp: new Date().toISOString(),
    });
  }

  get events(): readonly ErrorEvent[] { return this._events; }
  get count(): number { return this._events.length; }

  summaryByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this._events) counts[e.category] = (counts[e.category] ?? 0) + 1;
    return counts;
  }

  toStateDict(): { total: number; categories: Record<string, number> } {
    return { total: this._events.length, categories: this.summaryByCategory() };
  }

  /** Write errors to .errors.jsonl alongside the command log. */
  writeJsonl(logPath: string): void {
    if (!this._events.length) return;
    const errPath = logPath.replace(/\.log$/, ".errors.jsonl");
    for (const e of this._events) {
      appendFileSync(errPath, JSON.stringify(e) + "\n");
    }
  }

  /** Format summary for terminal display. */
  formatSummary(): string {
    if (!this._events.length) return "";
    const cats = this.summaryByCategory();
    const lines = ["⚠ Errors during run:"];
    for (const [cat, count] of Object.entries(cats).sort()) {
      lines.push(`  ${cat}: ${count}`);
    }
    return lines.join("\n");
  }
}
