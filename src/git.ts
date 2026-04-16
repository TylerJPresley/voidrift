/**
 * Git utilities: context snapshot, bounded diff, checkpoints (REQ-D-18, REQ-GIT-4, REQ-D-20).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Git snapshot (REQ-D-18)
// ---------------------------------------------------------------------------

export interface GitSnapshot {
  branch: string;
  commits: string[];
  changedFiles: string[];
}

export function captureGitSnapshot(dir: string): GitSnapshot | null {
  try {
    const branch = git(dir, "branch --show-current").trim();
    const log = git(dir, "log --oneline -5").trim();
    const commits = log ? log.split("\n") : [];
    const status = git(dir, "status --short").trim();
    const changedFiles = status ? status.split("\n").slice(0, 20) : [];
    return { branch, commits, changedFiles };
  } catch {
    return null;
  }
}

export function snapshotToPromptBlock(snap: GitSnapshot): string {
  const lines = ["## Git Context", "", `Branch: ${snap.branch}`];
  if (snap.commits.length) {
    lines.push("", "Recent commits:");
    for (const c of snap.commits) lines.push(`  ${c}`);
  }
  if (snap.changedFiles.length) {
    lines.push("", "Uncommitted changes:");
    for (const f of snap.changedFiles) lines.push(`  ${f}`);
    if (snap.changedFiles.length >= 20) lines.push("  ... and more");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Bounded diff (REQ-GIT-4)
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tar", ".gz",
  ".pyc", ".so", ".exe", ".db", ".sqlite", ".woff", ".woff2", ".ttf", ".eot",
]);

export interface DiffResult {
  diffText: string;
  binaryFiles: string[];
  truncated: boolean;
  truncationNote: string;
}

export function getBoundedDiff(
  dir: string,
  opts: { maxDiffLines?: number; maxDiffFiles?: number; maxFileDiffLines?: number } = {},
): DiffResult {
  const maxLines = opts.maxDiffLines ?? 2000;
  const maxFiles = opts.maxDiffFiles ?? 50;
  const maxPerFile = opts.maxFileDiffLines ?? 400;

  let raw: string;
  try { raw = git(dir, "diff HEAD"); } catch { return { diffText: "", binaryFiles: [], truncated: false, truncationNote: "" }; }

  const files = raw.split(/^diff --git /m).slice(1);
  const binaryFiles: string[] = [];
  const textChunks: string[] = [];
  let totalLines = 0;
  let truncated = false;
  let truncationNote = "";

  for (let i = 0; i < files.length; i++) {
    if (i >= maxFiles) {
      truncated = true;
      truncationNote = `Showing ${maxFiles} of ${files.length} files`;
      break;
    }
    const chunk = files[i];
    const nameMatch = chunk.match(/^a\/(.+?) b\//);
    const name = nameMatch?.[1] ?? "";
    const ext = name.includes(".") ? "." + name.split(".").pop()! : "";

    if (BINARY_EXTENSIONS.has(ext.toLowerCase())) {
      binaryFiles.push(name);
      continue;
    }

    const lines = chunk.split("\n");
    if (lines.length > maxPerFile) {
      textChunks.push(lines.slice(0, maxPerFile).join("\n") + `\n[truncated: ${lines.length - maxPerFile} lines omitted from ${name}]`);
      totalLines += maxPerFile;
    } else {
      textChunks.push(chunk);
      totalLines += lines.length;
    }

    if (totalLines >= maxLines) {
      truncated = true;
      truncationNote = `Diff truncated at ${maxLines} lines`;
      break;
    }
  }

  return { diffText: textChunks.join("\ndiff --git "), binaryFiles, truncated, truncationNote };
}

// ---------------------------------------------------------------------------
// Checkpoints (REQ-D-20)
// ---------------------------------------------------------------------------

export interface Checkpoint {
  ref: string;
  taskId: number;
  turn: number;
  timestamp: string;
}

export class GitCheckpointManager {
  private _dir: string;
  checkpoints: Checkpoint[] = [];

  constructor(dir: string) { this._dir = dir; }

  create(taskId: number, turn: number): Checkpoint | null {
    try {
      const ref = git(this._dir, "stash create").trim();
      if (!ref) return null; // Clean tree
      const cp: Checkpoint = { ref, taskId, turn, timestamp: new Date().toISOString() };
      this.checkpoints.push(cp);
      return cp;
    } catch { return null; }
  }

  restore(turn: number): boolean {
    const cp = this.checkpoints.find(c => c.turn === turn);
    if (!cp) return false;
    try { git(this._dir, `checkout ${cp.ref} -- .`); return true; } catch { return false; }
  }

  save(path: string): void {
    const lines = this.checkpoints.map(c => JSON.stringify(c));
    writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  }

  load(path: string): void {
    if (!existsSync(path)) return;
    this.checkpoints = readFileSync(path, "utf-8").trim().split("\n")
      .filter(Boolean).map(l => JSON.parse(l));
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function git(dir: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: dir, timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

// ---------------------------------------------------------------------------
// Git commit helpers (REQ-GIT-1, REQ-GIT-2)
// ---------------------------------------------------------------------------

/** Stage and commit specific files. Returns true on success. */
export function gitCommit(cwd: string, files: string[], message: string): boolean {
  try {
    if (!files.length) return false;
    execSync(`git add ${files.map(f => `"${f}"`).join(" ")}`, { cwd, timeout: 10_000, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, timeout: 10_000, stdio: "pipe" });
    return true;
  } catch { return false; }
}

/** Check if cwd is a git repo. */
export function isGitRepo(cwd: string): boolean {
  try { execSync("git rev-parse --is-inside-work-tree", { cwd, timeout: 5_000, stdio: "pipe" }); return true; } catch { return false; }
}
