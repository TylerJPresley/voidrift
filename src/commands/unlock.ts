/**
 * Unlock command: remove develop lock and kill running process (REQ-UTIL-3).
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function runUnlock(): number {
  const lock = join(process.cwd(), ".voidrift", ".develop.lock");
  if (!existsSync(lock)) {
    console.log("No lock file found.");
    return 0;
  }

  const content = readFileSync(lock, "utf-8");
  const pid = parseInt(content.split("\n")[0], 10);

  // Kill if alive
  if (pid) {
    try {
      process.kill(pid, 0); // check alive
      process.kill(pid, "SIGTERM");
      console.log(`Killed develop process (PID ${pid}).`);
    } catch {
      // Process already dead
    }
  }

  unlinkSync(lock);
  console.log("Lock removed.");
  return 0;
}
