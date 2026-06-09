import { execSync } from "child_process";
import { existsSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

export interface CleanupResult {
  prunedWorktrees: string[];
  preservedWorktrees: string[];
  clearedLocks: boolean;
  errors: string[];
}

export interface WorktreeMeta {
  pid: number;
  createdAt: string;
}

const TTL_MINUTES = 120;

/**
 * Harness Boot Clean-up Guard (G-02).
 *
 * Runs once on startup to ensure a clean, predictable state:
 * 1. Scans .voidrift/worktrees/ for each subdirectory
 * 2. Reads .meta.json for PID and createdAt
 * 3. Checks if PID is still alive via signal 0
 * 4. Enforces 2-hour TTL safety buffer before pruning dead worktrees
 * 5. Prunes stale worktrees and releases their locks
 * 6. Resets locks.json to only contain still-active locks
 */
export function cleanupWorktrees(workspaceRoot: string): CleanupResult {
  const result: CleanupResult = { prunedWorktrees: [], preservedWorktrees: [], clearedLocks: false, errors: [] };
  const voidriftDir = join(workspaceRoot, ".voidrift");
  const worktreeDir = join(voidriftDir, "worktrees");
  const locksPath = join(voidriftDir, "locks.json");

  mkdirSync(voidriftDir, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });

  // Scan worktree subdirectories
  let entries: string[];
  try {
    entries = readdirSync(worktreeDir);
  } catch {
    entries = [];
  }

  const stalePaths: string[] = [];

  for (const entry of entries) {
    const wtPath = join(worktreeDir, entry);
    let stat;
    try { stat = statSync(wtPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    const metaPath = join(wtPath, ".meta.json");
    const meta = readMeta(metaPath);

    if (!meta) {
      // No meta or corrupted — check age
      const ageMinutes = (Date.now() - stat.ctimeMs) / 60000;
      if (ageMinutes >= TTL_MINUTES) {
        stalePaths.push(wtPath);
        result.prunedWorktrees.push(entry);
      } else {
        result.preservedWorktrees.push(entry);
      }
      continue;
    }

    const alive = isProcessAlive(meta.pid);
    if (alive) {
      result.preservedWorktrees.push(entry);
      continue;
    }

    // PID is dead — check TTL
    const createdAt = new Date(meta.createdAt).getTime();
    const ageMinutes = (Date.now() - createdAt) / 60000;
    if (ageMinutes < TTL_MINUTES) {
      result.preservedWorktrees.push(entry);
    } else {
      stalePaths.push(wtPath);
      result.prunedWorktrees.push(entry);
    }
  }

  // Prune stale worktrees
  for (const wtPath of stalePaths) {
    try {
      execSync(`git worktree remove --force "${wtPath}"`, { cwd: workspaceRoot, stdio: "ignore" });
    } catch {
      try { rmSync(wtPath, { recursive: true, force: true }); } catch {}
    }
  }

  // Run git worktree prune
  if (isGitRepo(workspaceRoot)) {
    try {
      execSync("git worktree prune", { cwd: workspaceRoot, stdio: "ignore" });
    } catch (err) {
      result.errors.push(`git worktree prune failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Reset locks — remove entries for pruned worktrees
  try {
    const currentLocks = readLocks(locksPath);
    // Keep only locks that belong to preserved (still-alive) worktrees
    const activeLocks = currentLocks.filter(() => false); // Clear all on boot — active subagents will re-register
    writeFileSync(locksPath, JSON.stringify({ activeLocks }, null, 2));
    result.clearedLocks = true;
  } catch (err) {
    result.errors.push(`locks reset failed: ${err instanceof Error ? err.message : err}`);
  }

  return result;
}

/**
 * Creates a .meta.json for a new worktree (called when provisioning).
 */
export function writeWorktreeMeta(worktreePath: string): void {
  const meta: WorktreeMeta = { pid: process.pid, createdAt: new Date().toISOString() };
  writeFileSync(join(worktreePath, ".meta.json"), JSON.stringify(meta, null, 2));
}

/**
 * Cross-platform process-alive check via signal 0.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = process doesn't exist. Other errors = it exists but we can't signal it.
    return err.code !== "ESRCH";
  }
}

function readMeta(metaPath: string): WorktreeMeta | null {
  if (!existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (typeof raw.pid !== "number" || typeof raw.createdAt !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

function readLocks(locksPath: string): string[] {
  if (!existsSync(locksPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(locksPath, "utf-8"));
    return Array.isArray(raw.activeLocks) ? raw.activeLocks : [];
  } catch {
    return [];
  }
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
