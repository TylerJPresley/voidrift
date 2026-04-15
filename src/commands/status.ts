/**
 * Status command: task counts by lifecycle status (REQ-UI-13).
 */

import { ManifestManager } from "../manifest.js";

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
  console.log(`  Planned:      ${s.planned}`);
  console.log(`  In Progress:  ${s["in-progress"]}`);
  console.log(`  Implemented:  ${s.implemented}`);
  console.log(`  Verified:     ${s.verified}`);
  console.log(`  Failed:       ${s.failed}`);
  console.log(`  Blocked:      ${s.blocked}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Total:        ${total}\n`);
}
