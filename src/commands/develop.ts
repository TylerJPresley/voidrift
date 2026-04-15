/**
 * Develop command: task execution (REQ-D-1..D-22).
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import type { TokenBudget } from "../agent/budget.js";
import { BudgetExhaustedError } from "../agent/budget.js";
import { ManifestManager } from "../manifest.js";
import { WriteContext } from "../tools/filesystem.js";
import { buildLocalTools } from "../tools/builder.js";
import { findSkill } from "../skills.js";
import { loadPrompt } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, checkRequirementsExist } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { captureGitSnapshot, snapshotToPromptBlock, GitCheckpointManager } from "../git.js";
import { snipOldToolResults } from "../agent/context.js";
import { clearAbort, isAbortRequested } from "../agent/abort.js";

const MAX_ESCALATIONS = 5;

export async function runDevelop(
  worker: ModelInterface,
  architect?: ModelInterface,
  tokenBudget?: TokenBudget,
): Promise<number> {
  checkDiskSpace();
  const d = ensureVoidriftDir();
  if (!checkRequirementsExist()) {
    process.stderr.write("Error: REQUIREMENTS.md not found. Run 'voidrift gather' first.\n");
    return 1;
  }

  const mm = new ManifestManager();
  if (!mm.exists()) {
    process.stderr.write("Error: No task manifest. Run 'voidrift plan' first.\n");
    return 1;
  }
  mm.load();

  // Orphaned recovery (REQ-D-16)
  for (const [id, t] of Object.entries(mm.tasks())) {
    if (t.status === "in-progress") mm.setStatus(Number(id), "planned");
  }

  if (!mm.hasWork()) { process.stderr.write("All tasks complete.\n"); return 0; }

  // Lock file (REQ-D-3)
  const lock = join(d, ".develop.lock");
  if (existsSync(lock)) {
    const pid = parseInt(readFileSync(lock, "utf-8").split("\n")[0], 10);
    try { process.kill(pid, 0); process.stderr.write(`Develop session running (PID ${pid})\n`); return 1; } catch { unlinkSync(lock); }
  }
  writeFileSync(lock, `${process.pid}\n${new Date().toISOString()}`);

  const ctx = new WriteContext({ projectDir: join(d, ".."), maxReadLines: worker.config.maxReadLines });
  clearAbort();
  const [log, runId] = bootRun("develop");
  const [tools, handlers] = buildLocalTools("develop", join(d, ".."), ctx);
  const devPrompt = loadPrompt("develop", "TASK");
  const escPrompt = loadPrompt("develop", "ESCALATION");

  // Git context (REQ-D-18)
  const snap = captureGitSnapshot(join(d, ".."));
  const gitContext = snap ? snapshotToPromptBlock(snap) : "";
  const checkpoints = snap ? new GitCheckpointManager(join(d, "..")) : null;

  let escalationCount = 0;
  const allDiffStats: Array<[number, Array<{ path: string; status: string; linesAdded: number; linesRemoved: number }>]> = [];
  const archModel = architect ?? worker;

  try {
    while (mm.hasWork()) {
      const ready = mm.dispatchable();
      if (!ready.length) break;

      for (const taskId of ready) {
        if (isAbortRequested()) break;
        tokenBudget?.checkBefore();

        mm.setStatus(taskId, "in-progress");
        checkpoints?.create(taskId, taskId);

        const taskPath = join(d, "tasks", "active", `TASK-${taskId}.md`);
        if (!existsSync(taskPath)) { mm.setStatus(taskId, "blocked"); continue; }
        const taskText = readFileSync(taskPath, "utf-8");

        // Parse skills from frontmatter
        let skillContent = "";
        if (taskText.startsWith("---\n")) {
          const end = taskText.indexOf("\n---\n", 4);
          if (end !== -1) {
            try {
              const fm = parseYaml(taskText.slice(4, end));
              for (const s of fm?.skills ?? []) {
                const sc = findSkill(String(s));
                if (sc) skillContent += `\n\n${sc}`;
              }
            } catch { /* */ }
          }
        }

        const systemCtx = loadPrompt("system", "CONTEXT");
        const system = [systemCtx, skillContent, devPrompt.replace("{task_text}", taskText).replace("{arch_context}", "").replace("{skill_content}", ""), gitContext].filter(Boolean).join("\n\n");

        ctx.setSnapshots();
        ctx.resetSessionFiles();
        let writeNudges = 0;
        let selfReviewInjected = false;

        const agent = new AgentLoop({
          model: worker, systemPrompt: system, tools, toolHandlers: handlers,
          stream: false, maxTokens: getMaxTokens(worker.config, "develop.task"),
          logPath: log, showSpinner: false, tokenBudget,
          transformContext: (msgs) => snipOldToolResults(msgs),
          beforeToolCall: (name, args) => {
            if (name === "done" && ctx.getWriteCount() === 0) {
              return "ERROR: No files written yet. Call file(action='write') before done().";
            }
            return null;
          },
          getFollowUpMessages: () => {
            if (ctx.getWriteCount() === 0 && writeNudges < 2) {
              writeNudges++;
              return [{ role: "user" as const, content: "You have not written any files yet. Call file(action='write') to implement the task." }];
            }
            return [];
          },
          getSteeringMessages: () => {
            if (ctx.getWriteCount() > 0 && !selfReviewInjected) {
              selfReviewInjected = true;
              return [{ role: "user" as const, content: "Re-read each acceptance criterion. Confirm the code satisfies it. Score confidence 0-100%. Below 90%, fix the gaps." }];
            }
            return [];
          },
        });

        try {
          await agent.send(loadPrompt("develop", "TASK-USER"));
        } catch (e) {
          if (e instanceof BudgetExhaustedError) throw e;
          ctx.rollbackSnapshots();
          mm.setStatus(taskId, "planned");
          continue;
        }

        if (ctx.getWriteCount() > 0) {
          const stats = ctx.computeDiffStats();
          if (stats.length) allDiffStats.push([taskId, stats]);
          ctx.clearSnapshots();
          mm.setStatus(taskId, "implemented");

          // Post-task file check (REQ-D-21)
          _checkTaskFiles(taskText, ctx);
        } else {
          // Retry once, then escalate
          ctx.rollbackSnapshots();
          if (escalationCount < MAX_ESCALATIONS) {
            escalationCount++;
            // Consult architect (REQ-D-6)
            const reqs = existsSync(join(d, "REQUIREMENTS.md")) ? readFileSync(join(d, "REQUIREMENTS.md"), "utf-8") : "";
            const arch = existsSync(join(d, "ARCHITECTURE.md")) ? readFileSync(join(d, "ARCHITECTURE.md"), "utf-8") : "";
            const escSystem = escPrompt.replace("{question}", "Task produced no writes").replace("{task_text}", taskText).replace("{requirements}", reqs).replace("{architecture}", arch);
            const escAgent = new AgentLoop({
              model: archModel, systemPrompt: escSystem, tools: [], toolHandlers: {},
              stream: false, maxTokens: getMaxTokens(archModel.config, "develop.escalation"), logPath: log, showSpinner: false,
            });
            try { await escAgent.send(loadPrompt("develop", "ESCALATION-USER")); } catch { /* */ }
            mm.setStatus(taskId, "planned");
          } else {
            mm.setStatus(taskId, "blocked");
          }
        }
      }
    }
  } finally {
    try { unlinkSync(lock); } catch { /* */ }
    if (checkpoints?.checkpoints.length) checkpoints.save(join(d, "checkpoints.jsonl"));
  }

  // Summary
  for (const [tid, stats] of allDiffStats) {
    const added = stats.reduce((s, x) => s + x.linesAdded, 0);
    const removed = stats.reduce((s, x) => s + x.linesRemoved, 0);
    process.stderr.write(`  TASK-${tid}: +${added} -${removed} (${stats.length} files)\n`);
  }

  appendState("develop", worker.config.alias, "completed", ctx.getSessionFiles().length ? ctx.getSessionFiles() : undefined);
  return 0;
}

function _checkTaskFiles(taskText: string, ctx: WriteContext): void {
  if (!taskText.startsWith("---\n")) return;
  const end = taskText.indexOf("\n---\n", 4);
  if (end === -1) return;
  try {
    const fm = parseYaml(taskText.slice(4, end));
    const files = (fm?.files as string[]) ?? [];
    const written = new Set(ctx.getSessionFiles());
    for (const f of files) {
      const clean = f.replace(/\s*\(create\)|\s*\(modify\)/g, "").trim();
      if (clean && !written.has(clean)) {
        process.stderr.write(`⚠ Expected file not written: ${clean}\n`);
      }
    }
  } catch { /* */ }
}
