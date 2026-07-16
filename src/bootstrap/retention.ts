/**
 * Retention Cleanup — background purge of old cache, sessions, and logs.
 *
 * Runs on startup (non-blocking). Applies two thresholds (whichever hits first):
 * - maxAgeDays: remove files/dirs older than N days
 * - maxSessions: keep at most N sessions (oldest first)
 *
 * Targets:
 * - .voidrift/cache/ — tool output, web, clipboard, view, tasks
 * - .voidrift/sessions/ — persisted session state
 * - .voidrift/logs/ — audit logs
 */
import { readdirSync, statSync, rmSync, existsSync } from "fs";
import { join } from "path";

export interface RetentionConfig {
  maxCacheAgeDays: number;
  maxSessionCount: number;
  maxLogAgeDays: number;
}

export interface RetentionResult {
  prunedCache: number;
  prunedSessions: number;
  prunedLogs: number;
}

/**
 * Run retention cleanup. Non-blocking — call without await.
 */
export function runRetention(workspaceRoot: string, config: RetentionConfig): RetentionResult {
  const result: RetentionResult = { prunedCache: 0, prunedSessions: 0, prunedLogs: 0 };

  if (config.maxCacheAgeDays === 0 && config.maxSessionCount === 0 && config.maxLogAgeDays === 0) return result;

  const now = Date.now();

  // 1. Cache — purge files older than maxCacheAgeDays
  const cacheDir = join(workspaceRoot, ".voidrift", "cache");
  if (existsSync(cacheDir)) {
    const maxAgeMs = config.maxCacheAgeDays > 0 ? config.maxCacheAgeDays * 24 * 60 * 60 * 1000 : Infinity;
    result.prunedCache = pruneByAge(cacheDir, now, maxAgeMs);
  }

  // 2. Sessions — purge by count only (oldest first)
  const sessionsDir = join(workspaceRoot, ".voidrift", "sessions");
  if (existsSync(sessionsDir) && config.maxSessionCount > 0) {
    result.prunedSessions = pruneSessions(sessionsDir, now, Infinity, config.maxSessionCount);
  }

  // 3. Logs — purge by age
  const logsDir = join(workspaceRoot, ".voidrift", "logs");
  if (existsSync(logsDir)) {
    const maxAgeMs = config.maxLogAgeDays > 0 ? config.maxLogAgeDays * 24 * 60 * 60 * 1000 : Infinity;
    result.prunedLogs = pruneByAge(logsDir, now, maxAgeMs);
  }

  return result;
}

/**
 * Recursively remove files/directories older than maxAgeMs.
 */
function pruneByAge(dir: string, now: number, maxAgeMs: number): number {
  let pruned = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        const age = now - stat.mtimeMs;
        if (age > maxAgeMs) {
          rmSync(fullPath, { recursive: true, force: true });
          pruned++;
        }
      } catch {}
    }
  } catch {}
  return pruned;
}

/**
 * Prune sessions by age and count (whichever removes more).
 */
function pruneSessions(dir: string, now: number, maxAgeMs: number, maxSessions: number): number {
  let pruned = 0;
  try {
    const entries = readdirSync(dir)
      .map(name => {
        const fullPath = join(dir, name);
        try {
          const stat = statSync(fullPath);
          return { name, fullPath, mtime: stat.mtimeMs };
        } catch { return null; }
      })
      .filter(Boolean) as Array<{ name: string; fullPath: string; mtime: number }>;

    // Sort oldest first
    entries.sort((a, b) => a.mtime - b.mtime);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const age = now - entry.mtime;
      const exceedsAge = maxAgeMs !== Infinity && age > maxAgeMs;
      const exceedsCount = maxSessions > 0 && (entries.length - pruned) > maxSessions;

      if (exceedsAge || exceedsCount) {
        rmSync(entry.fullPath, { recursive: true, force: true });
        pruned++;
      }
    }
  } catch {}
  return pruned;
}
