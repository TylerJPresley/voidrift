import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { WorktreeEngine } from "../worktree/engine.js";
import type { EventBus } from "../events/bus.js";

export interface DevelopResult {
  crId: string;
  tasksSpawned: number;
  tasksQueued: number;
}

/**
 * /develop --cr <id>
 *
 * Reads the CR file, extracts linked tasks and focusedFiles,
 * spawns engineer subagents in isolated worktrees via WorktreeEngine.
 * Disjoint tasks run in parallel, overlapping tasks queue.
 */
export async function developCR(
  crId: string,
  workspaceRoot: string,
  worktree: WorktreeEngine,
  execute: (worktreePath: string, taskContent: string) => Promise<"success" | "failed">
): Promise<DevelopResult> {
  const crPath = join(workspaceRoot, ".voidrift", "changes", `CR-${crId}.md`);
  if (!existsSync(crPath)) throw new Error(`CR-${crId} not found at ${crPath}`);

  // Read CR to get focusedFiles
  const crContent = readFileSync(crPath, "utf-8");
  const filesMatch = crContent.match(/focusedFiles:\s*\[([^\]]*)\]/);
  const focusedFiles = filesMatch
    ? filesMatch[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean)
    : [];

  // Find linked tasks
  const tasksDir = join(workspaceRoot, ".voidrift", "tasks");
  const tasks = existsSync(tasksDir)
    ? readdirSync(tasksDir)
        .filter((f) => f.startsWith("TASK-") && f.endsWith(".md"))
        .map((f) => {
          const content = readFileSync(join(tasksDir, f), "utf-8");
          const taskCr = content.match(/cr:\s*(\S+)/)?.[1];
          const taskFile = content.match(/file:\s*(\S+)/)?.[1];
          return { file: f, crId: taskCr, targetFile: taskFile, content };
        })
        .filter((t) => t.crId === crId || t.crId === `CR-${crId}`)
    : [];

  // If no tasks found, use focusedFiles directly
  const targets = tasks.length > 0
    ? tasks.map((t) => ({ files: t.targetFile ? [t.targetFile] : focusedFiles, content: t.content }))
    : [{ files: focusedFiles, content: crContent }];

  let spawned = 0;
  let queued = 0;

  for (const target of targets) {
    const task = await worktree.schedule(target.files, async (wtPath) => {
      return execute(wtPath, target.content);
    });
    if (task.status === "queued") queued++;
    else spawned++;
  }

  return { crId, tasksSpawned: spawned, tasksQueued: queued };
}
