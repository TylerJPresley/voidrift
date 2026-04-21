/**
 * Log command: view and manage project/global logs (REQ-UTIL-2).
 */

import { existsSync, readFileSync, unlinkSync, watchFile, unwatchFile, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_LINES = 200;

function projectLogPath(): string {
  return join(process.cwd(), ".voidrift", "voidrift.log");
}

function globalLogPath(): string {
  return join(homedir(), ".voidrift", "logs", "voidrift.log");
}

/** Extract the most recent section for a command from the log. */
export function extractCommandSection(content: string, command: string): string {
  const marker = `--- ${command}-`;
  let lastIdx = content.lastIndexOf(marker);
  if (lastIdx === -1) return "";
  // Find the start of the line
  const lineStart = content.lastIndexOf("\n", lastIdx - 1) + 1;
  // Find the next section marker after this one, or end of file
  const nextMarker = content.indexOf("\n--- ", lastIdx + marker.length);
  return content.slice(lineStart, nextMarker === -1 ? undefined : nextMarker);
}

/** Return the last N lines of text. */
export function lastLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(-n).join("\n");
}

export interface LogOptions {
  command?: string;
  follow?: boolean;
  prune?: boolean;
  global?: boolean;
}

export function runLog(opts: LogOptions): number {
  const logPath = opts.global ? globalLogPath() : projectLogPath();

  // Check existence
  if (!opts.global && !existsSync(join(process.cwd(), ".voidrift"))) {
    console.error("No .voidrift/ directory. Run from a project directory or use --global.");
    return 1;
  }

  // Prune
  if (opts.prune) {
    if (existsSync(logPath)) {
      unlinkSync(logPath);
      console.log(`Deleted ${logPath}`);
    } else {
      console.log("No log file to delete.");
    }
    return 0;
  }

  if (!existsSync(logPath)) {
    console.log("No log file found.");
    return 0;
  }

  // Follow mode
  if (opts.follow) {
    const content = readFileSync(logPath, "utf-8");
    // Show last few lines first
    process.stdout.write(lastLines(content, 20) + "\n");
    let size = statSync(logPath).size;
    watchFile(logPath, { interval: 500 }, () => {
      try {
        const newSize = statSync(logPath).size;
        if (newSize > size) {
          const fd = require("node:fs").openSync(logPath, "r");
          const buf = Buffer.alloc(newSize - size);
          require("node:fs").readSync(fd, buf, 0, buf.length, size);
          require("node:fs").closeSync(fd);
          process.stdout.write(buf.toString("utf-8"));
          size = newSize;
        }
      } catch { /* file may have been rotated */ }
    });
    // Keep alive until SIGINT
    process.on("SIGINT", () => { unwatchFile(logPath); process.exit(0); });
    return 0; // won't reach due to watchFile keeping process alive
  }

  // Read and display
  const content = readFileSync(logPath, "utf-8");
  const section = opts.command ? extractCommandSection(content, opts.command) : content;

  if (!section.trim()) {
    console.log(opts.command ? `No log entries for '${opts.command}'.` : "Log is empty.");
    return 0;
  }

  console.log(lastLines(section, DEFAULT_LINES));
  return 0;
}
