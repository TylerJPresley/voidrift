/**
 * Shared utilities for the VoidRift CLI.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, statfsSync, statSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// System log (REQ-LOG-4, REQ-LOG-5)
// ---------------------------------------------------------------------------

const SYSTEM_LOG_MAX_BYTES = 1_048_576; // 1 MB
const SYSTEM_LOG_BACKUPS = 5;

function systemLogDir(): string {
  return join(homedir(), ".voidrift", "logs");
}

function systemLogPath(): string {
  return join(systemLogDir(), "voidrift.log");
}

/** Initialize system log at CLI startup. */
export function initSystemLog(): void {
  const dir = systemLogDir();
  mkdirSync(dir, { recursive: true });
  const p = systemLogPath();
  if (!existsSync(p)) writeFileSync(p, "", "utf-8");
}

/** Write a line to the system log with rotation. */
export function syslog(message: string): void {
  const p = systemLogPath();
  const ts = new Date().toISOString();
  const line = `${ts} ${message}\n`;
  try {
    appendFileSync(p, line, "utf-8");
    // Rotate if over max size
    try {
      const size = statSync(p).size;
      if (size > SYSTEM_LOG_MAX_BYTES) {
        // Shift backups: .5→delete, .4→.5, ... .1→.2, current→.1
        for (let i = SYSTEM_LOG_BACKUPS; i >= 1; i--) {
          const src = i === 1 ? p : `${p}.${i - 1}`;
          const dst = `${p}.${i}`;
          if (existsSync(src)) renameSync(src, dst);
        }
        writeFileSync(p, "", "utf-8");
      }
    } catch { /* rotation is best-effort */ }
  } catch { /* logging is non-fatal */ }
}

// ---------------------------------------------------------------------------
// .voidrift/ directory
// ---------------------------------------------------------------------------

export function voidriftDir(): string {
  return join(process.cwd(), ".voidrift");
}

export function ensureVoidriftDir(): string {
  const d = voidriftDir();
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// Run management
// ---------------------------------------------------------------------------

function timestamp(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function bootRun(command: string): [logPath: string, runId: string] {
  const d = ensureVoidriftDir();
  const logDir = join(d, "logs");
  mkdirSync(logDir, { recursive: true });
  const ts = timestamp();
  const runId = `${command}-${ts}`;
  const logPath = join(logDir, `${runId}.log`);
  appendFileSync(logPath, "");
  return [logPath, runId];
}

// ---------------------------------------------------------------------------
// Disk space
// ---------------------------------------------------------------------------

export function checkDiskSpace(): void {
  try {
    const stats = statfsSync(".");
    const availGb = (stats.bavail * stats.bsize) / (1024 ** 3);
    if (availGb < 1.0) {
      process.stderr.write(`⚠ Low disk space: ${availGb.toFixed(1)} GB available\n`);
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Requirements check
// ---------------------------------------------------------------------------

export function checkRequirementsExist(): boolean {
  return existsSync(join(voidriftDir(), "REQUIREMENTS.md"));
}

// ---------------------------------------------------------------------------
// STATE.md (REQ-PS-3)
// ---------------------------------------------------------------------------

export function appendState(
  cmd: string,
  modelAlias: string,
  summary: string,
  filesCreated?: string[],
  analyzedFiles?: Array<[string, string]>,
): void {
  const d = voidriftDir();
  const statePath = join(d, "STATE.md");
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "");
  const lines: string[] = [
    `## ${ts} — ${cmd} (${modelAlias})`,
    summary,
    "",
  ];
  if (analyzedFiles?.length) {
    lines.push("### Analyzed");
    for (const [fp, cat] of analyzedFiles) {
      lines.push(`- ${cat}: ${fp}`);
    }
    lines.push("");
  }
  if (filesCreated?.length) {
    lines.push("### Files");
    for (const fp of filesCreated) {
      lines.push(`- created: ${fp}`);
    }
    lines.push("");
  }
  appendFileSync(statePath, lines.join("\n") + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Undo (STATE.md manifest)
// ---------------------------------------------------------------------------

export function getStateManifest(cmd: string): string[] {
  const statePath = join(voidriftDir(), "STATE.md");
  if (!existsSync(statePath)) return [];
  const text = readFileSync(statePath, "utf-8");
  const pattern = new RegExp(`^## .+ — ${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(.+\\)$`, "gm");
  const entries = [...text.matchAll(pattern)];
  if (!entries.length) return [];
  const last = entries[entries.length - 1];
  const block = text.slice(last.index);
  const files: string[] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^- created: (.+)$/);
    if (m) files.push(m[1]);
  }
  return files;
}

export function undoCommand(cmd: string): string[] {
  const { unlinkSync } = require("node:fs");
  const files = getStateManifest(cmd);
  const deleted: string[] = [];
  for (const fp of files) {
    try {
      unlinkSync(fp);
      deleted.push(fp);
    } catch {
      // File may already be gone
    }
  }
  return deleted;
}
