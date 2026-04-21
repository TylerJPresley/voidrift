/**
 * Prune command: remove ephemeral data (REQ-UTIL-5).
 */

import { existsSync, readdirSync, unlinkSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getRetention } from "../config.js";

export interface PruneOptions {
  all?: boolean;
  global?: boolean;
}

function pruneLogBackups(logPath: string, keep: number): number {
  let removed = 0;
  for (let i = keep; i <= 20; i++) {
    const backup = `${logPath}.${i}`;
    if (existsSync(backup)) { unlinkSync(backup); removed++; }
  }
  return removed;
}

function pruneAnalysisCache(d: string): number {
  const analysisDir = join(d, "analysis");
  if (!existsSync(analysisDir)) return 0;
  let removed = 0;
  const projectDir = join(d, "..");

  // Load cache config
  let ttlDays = 30;
  try {
    const cfg = require("../config.js").loadConfig();
    ttlDays = cfg?.cache?.ttlDays ?? 30;
  } catch { /* */ }
  const ttlMs = ttlDays * 86_400_000;
  const now = Date.now();

  for (const f of readdirSync(analysisDir)) {
    if (!f.endsWith(".md")) continue;
    const cachePath = join(analysisDir, f);
    const sourcePath = join(projectDir, f.replace(/\.md$/, ""));

    // Stale: source file no longer exists
    if (!existsSync(sourcePath)) {
      unlinkSync(cachePath);
      removed++;
      continue;
    }

    // Expired: older than TTL
    try {
      const mtime = statSync(cachePath).mtimeMs;
      if (now - mtime > ttlMs) { unlinkSync(cachePath); removed++; }
    } catch { /* */ }
  }
  return removed;
}

export function runPrune(opts: PruneOptions): number {
  if (opts.global) {
    const globalLogDir = join(homedir(), ".voidrift", "logs");
    if (!existsSync(globalLogDir)) {
      console.log("No global logs found.");
      return 0;
    }
    if (opts.all) {
      for (const f of readdirSync(globalLogDir)) unlinkSync(join(globalLogDir, f));
      console.log("All global logs removed.");
    } else {
      const retention = getRetention("global");
      const logPath = join(globalLogDir, "voidrift.log");
      const removed = pruneLogBackups(logPath, retention);
      console.log(removed ? `Pruned ${removed} global log backup(s).` : "No global log backups to prune.");
    }
    return 0;
  }

  const d = join(process.cwd(), ".voidrift");
  if (!existsSync(d)) {
    console.error("No .voidrift/ directory. Run from a project directory or use --global.");
    return 1;
  }

  if (opts.all) {
    rmSync(d, { recursive: true });
    console.log("Removed .voidrift/ directory.");
    return 0;
  }

  // Prune project log backups
  const logPath = join(d, "voidrift.log");
  const retention = getRetention("project");
  const logRemoved = pruneLogBackups(logPath, retention);

  // Prune analysis cache
  const cacheRemoved = pruneAnalysisCache(d);

  if (logRemoved || cacheRemoved) {
    console.log(`Pruned ${logRemoved} log backup(s), ${cacheRemoved} cache entries.`);
  } else {
    console.log("Nothing to prune.");
  }
  return 0;
}
