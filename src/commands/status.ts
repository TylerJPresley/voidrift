/**
 * Status command: command completion, task counts, idea count (REQ-UTIL-1).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ManifestManager } from "../manifest.js";
import { voidriftDir } from "../utils.js";

const STATUS_EMOJI: Record<string, string> = {
  planned: "⬜",
  "in-progress": "🔄",
  implemented: "🔧",
  verified: "✅",
  failed: "❌",
  blocked: "🚫",
};

export function getCommandStatus(d: string): Record<string, string> {
  const status: Record<string, string> = {};

  // gather: done if REQUIREMENTS.md exists
  status.gather = existsSync(join(d, "REQUIREMENTS.md")) ? "done" : "not started";

  // plan: done if ARCHITECTURE.md + manifest exist
  status.plan = existsSync(join(d, "ARCHITECTURE.md")) && existsSync(join(d, "tasks", "manifest.yml")) ? "done" : "not started";

  // develop: check manifest task statuses
  const mm = new ManifestManager();
  if (mm.exists()) {
    mm.load();
    const tasks = Object.values(mm.tasks());
    if (tasks.some(t => t.status === "in-progress")) status.develop = "in progress";
    else if (tasks.length && !mm.hasWork()) status.develop = "done";
    else status.develop = "not started";
  } else {
    status.develop = "not started";
  }

  // verify: done if VERIFY.md exists
  status.verify = existsSync(join(d, "VERIFY.md")) ? "done" : "not started";

  // deploy: done if STATE.md contains a deploy entry
  const statePath = join(d, "STATE.md");
  if (existsSync(statePath)) {
    const stateContent = readFileSync(statePath, "utf-8");
    status.deploy = stateContent.includes("— deploy (") ? "done" : "not started";
  } else {
    status.deploy = "not started";
  }

  return status;
}

export function countIdeas(d: string): number {
  const dir = join(d, "ideas");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => /^IDEA-\d+\.md$/.test(f)).length;
}

const CMD_EMOJI: Record<string, string> = { done: "✅", "in progress": "🔄", "not started": "⬜" };

export function runStatus(): void {
  const d = voidriftDir();

  if (!existsSync(d)) {
    console.log("No active project. Run 'voidrift plan' to create tasks.");
    return;
  }

  // Command completion
  const cmdStatus = getCommandStatus(d);
  console.log("\n  Command Status");
  console.log("  ─────────────────────────────────────");
  for (const [cmd, st] of Object.entries(cmdStatus)) {
    const emoji = CMD_EMOJI[st] ?? "⬜";
    console.log(`  ${emoji} ${cmd.padEnd(14)} ${st}`);
  }

  // Task counts
  const mm = new ManifestManager();
  if (mm.exists()) {
    mm.load();
    const s = mm.summary();
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    console.log("\n  Task Status");
    console.log("  ─────────────────────────────────────");
    for (const [status, count] of Object.entries(s)) {
      const emoji = STATUS_EMOJI[status] ?? "  ";
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      console.log(`  ${emoji} ${label.padEnd(14)} ${count}`);
    }
    console.log(`  ─────────────────────────────────────`);
    console.log(`     Total:        ${total}`);
  } else {
    console.log("\n  No task manifest. Run 'voidrift plan' to create tasks.");
  }

  // Idea count
  const ideas = countIdeas(d);
  if (ideas > 0) console.log(`\n  💡 Ideas:        ${ideas}`);
  console.log();
}
