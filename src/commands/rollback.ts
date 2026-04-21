/**
 * Rollback command: list/restore develop checkpoints (REQ-UTIL-8).
 */

import { join } from "node:path";
import { GitCheckpointManager, isGitRepo } from "../git.js";

export function runRollback(turn?: number): number {
  const projectDir = process.cwd();
  const d = join(projectDir, ".voidrift");
  const cpPath = join(d, "checkpoints.jsonl");

  if (!isGitRepo(projectDir)) {
    console.error("Not a git repository.");
    return 1;
  }

  const mgr = new GitCheckpointManager(projectDir);
  mgr.load(cpPath);

  if (!mgr.checkpoints.length) {
    console.log("No checkpoints available.");
    return 0;
  }

  // List mode
  if (turn == null) {
    console.log("\n  Available checkpoints:");
    console.log("  " + "─".repeat(50));
    for (const cp of mgr.checkpoints) {
      console.log(`    Turn ${String(cp.turn).padEnd(4)} TASK-${String(cp.taskId).padEnd(6)} ${cp.timestamp}`);
    }
    console.log();
    return 0;
  }

  // Restore mode
  if (mgr.restore(turn)) {
    console.log(`Restored working tree to checkpoint at turn ${turn}.`);
    return 0;
  }
  console.error(`Checkpoint at turn ${turn} not found.`);
  return 1;
}
