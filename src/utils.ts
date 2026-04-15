/**
 * Shared utilities for the VoidRift CLI.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, statfsSync } from "node:fs";
import { join } from "node:path";

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
