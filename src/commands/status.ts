/**
 * Status command: task counts by lifecycle status (REQ-UI-13, REQ-U-1).
 */

import { ManifestManager } from "../manifest.js";

const STATUS_EMOJI: Record<string, string> = {
  planned: "⬜",
  "in-progress": "🔄",
  implemented: "🔧",
  verified: "✅",
  failed: "❌",
  blocked: "🚫",
};

export function runStatus(): void {
  const mm = new ManifestManager();
  if (!mm.exists()) {
    console.log("No active project. Run 'voidrift plan' to create tasks.");
    return;
  }
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
  console.log(`     Total:        ${total}\n`);
}
