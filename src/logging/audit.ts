import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { EventBus } from "../events/bus.js";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  data?: unknown;
}

export interface AuditLoggerOptions {
  workspaceRoot: string;
  sessionId: string;
  globalLogDir?: string;
}

/**
 * Dual-Layer Audit Logger.
 *
 * Workspace log (.voidrift/logs/<session-id>.log):
 *   All project-related model actions — prompts, completions, tool calls,
 *   tool results, file mutations, mode changes, node transitions.
 *
 * Global log (~/.config/voidrift/logs/<session-id>.log):
 *   CLI-level actions — session start/end, errors, crashes, config loading.
 */
export class AuditLogger {
  private localFile: string;
  private globalFile: string;

  constructor(private opts: AuditLoggerOptions) {
    const localDir = join(opts.workspaceRoot, ".voidrift", "logs");
    const globalDir = opts.globalLogDir ?? join(homedir(), ".config", "voidrift", "logs");

    mkdirSync(localDir, { recursive: true });
    mkdirSync(globalDir, { recursive: true });

    this.localFile = join(localDir, `${opts.sessionId}.log`);
    this.globalFile = join(globalDir, `${opts.sessionId}.log`);
  }

  attach(bus: EventBus): () => void {
    const unsubs: Array<() => void> = [];

    // --- Workspace log: model actions ---

    unsubs.push(bus.subscribe("USER_INPUT", (e) => {
      this.local("info", "user", "input", { text: e.payload.text });
    }));

    unsubs.push(bus.subscribe("STREAM_CHUNK_RECEIVED", (e) => {
      this.local("debug", "model", "chunk", e.payload);
    }));

    unsubs.push(bus.subscribe("BEFORE_TOOL_EXECUTE", (e) => {
      this.local("info", "tool", `call:${e.payload.toolName}`, { args: e.payload.arguments });
    }));

    unsubs.push(bus.subscribe("AFTER_TOOL_EXECUTE", (e) => {
      this.local("info", "tool", `result:${e.payload.toolName}`, { status: e.payload.status, output: e.payload.output.slice(0, 500) });
    }));

    unsubs.push(bus.subscribe("TOOL_CONFIRMATION_REQUEST", (e) => {
      this.local("info", "gate", `request:${e.payload.tool}`, { args: e.payload.args, requestId: e.payload.requestId });
    }));

    unsubs.push(bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (e) => {
      this.local("info", "gate", `response:${e.payload.approved ? "approved" : "denied"}`, { requestId: e.payload.requestId });
    }));

    unsubs.push(bus.subscribe("TURN_COMPLETE", (e) => {
      this.local("info", "session", "turn_complete", { turnId: e.payload.turnId });
    }));

    unsubs.push(bus.subscribe("MODE_CHANGED", (e) => {
      this.local("info", "mode", `${e.payload.previousMode} → ${e.payload.newMode}`);
    }));

    unsubs.push(bus.subscribe("NODE_TRANSITION", (e) => {
      this.local("info", "graph", `${e.payload.fromNode} → ${e.payload.toNode}`);
    }));

    unsubs.push(bus.subscribe("FILE_CREATED", (e) => {
      this.local("info", "fs", "created", { path: e.payload.path });
    }));

    unsubs.push(bus.subscribe("FILE_MODIFIED", (e) => {
      this.local("info", "fs", "modified", { path: e.payload.path });
    }));

    unsubs.push(bus.subscribe("FILE_DELETED", (e) => {
      this.local("info", "fs", "deleted", { path: e.payload.path });
    }));

    unsubs.push(bus.subscribe("SUBAGENT_SPAWNED", (e) => {
      this.local("info", "worktree", "spawned", { id: e.payload.subagentId, path: e.payload.worktreePath });
    }));

    unsubs.push(bus.subscribe("SUBAGENT_COMPLETED", (e) => {
      this.local("info", "worktree", "completed", { id: e.payload.subagentId, status: e.payload.status });
    }));

    // --- Global log: CLI-level actions ---

    unsubs.push(bus.subscribe("SESSION_START", (e) => {
      this.global("info", "cli", "session_start", { workspaceRoot: e.payload.workspaceRoot });
    }));

    unsubs.push(bus.subscribe("SESSION_END", (e) => {
      this.global("info", "cli", "session_end", { durationMs: e.payload.sessionDurationMs, exitCode: e.payload.exitCode });
    }));

    unsubs.push(bus.subscribe("ERROR_OCCURRED", (e) => {
      this.local("error", e.payload.source ?? "unknown", e.payload.message);
      this.global("error", e.payload.source ?? "unknown", e.payload.message);
    }));

    return () => unsubs.forEach((u) => u());
  }

  /** Log model response (called directly from turn execution) */
  logModelResponse(model: string, text: string, toolCalls: unknown[], usage: unknown, timing?: { requestStart: number; firstTokenAt: number | null; endAt: number }): void {
    const prefillMs = timing?.firstTokenAt ? timing.firstTokenAt - timing.requestStart : null;
    const totalMs = timing ? timing.endAt - timing.requestStart : null;
    this.local("info", "model", "response", { model, text: text.slice(0, 1000), toolCalls, usage, prefillMs, totalMs });
  }

  /** Log the full prompt sent to the model */
  logModelPrompt(model: string, messages: Array<{ role: string; content: string }>): void {
    this.local("info", "model", "prompt", { model, messageCount: messages.length, messages });
  }

  /** Log when a file is focused with its summary */
  logFocusedFile(path: string, totalLines: number, summaryLength: number): void {
    this.local("info", "context", "focus_file", { path, totalLines, summaryTokensApprox: Math.ceil(summaryLength / 4) });
  }

  local(level: LogEntry["level"], source: string, message: string, data?: unknown): void {
    this.write(this.localFile, { timestamp: now(), level, source, message, data });
  }

  global(level: LogEntry["level"], source: string, message: string, data?: unknown): void {
    this.write(this.globalFile, { timestamp: now(), level, source, message, data });
  }

  get localLogPath(): string { return this.localFile; }
  get globalLogPath(): string { return this.globalFile; }

  private write(file: string, entry: LogEntry): void {
    try {
      appendFileSync(file, JSON.stringify(entry) + "\n");
    } catch {
      // Best effort — don't crash the harness over logging
    }
  }
}

function now(): string {
  return new Date().toISOString();
}
