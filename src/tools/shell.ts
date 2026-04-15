/**
 * Shell tool factory (REQ-SEC-4).
 */

import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classifyCommand } from "./security.js";
import type { BashConfig } from "../config.js";

function matchesPattern(cmd: string, pattern: string): boolean {
  const prefix = pattern.replace(/\*+$/, "").trimEnd();
  if (pattern.includes("*")) {
    const re = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return re.test(cmd) || cmd.startsWith(prefix);
  }
  return cmd === pattern;
}

function truncate(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} lines truncated)`;
}

export function createRunCommand(
  config: BashConfig,
  globalAllowed: string[] = [],
  logPath?: string,
): (cmd: string, cwd?: string) => string {
  return (cmd: string, cwd?: string): string => {
    if (!config.enabled) {
      return JSON.stringify({ error: "Shell is disabled for this command.", exit_code: -1 });
    }

    const stripped = cmd.trim();

    if (config.allowedPatterns.length) {
      if (!config.allowedPatterns.some(p => matchesPattern(stripped, p))) {
        return JSON.stringify({
          error: `Command not in allowed patterns. Allowed: ${config.allowedPatterns.join(", ")}`,
          exit_code: -1,
        });
      }
    }

    const classification = classifyCommand(cmd, globalAllowed);
    if (classification.level === "block") {
      logCmd(logPath, cmd, "block", undefined, classification.reasons);
      return JSON.stringify({ error: `Command blocked: ${classification.reasons.join("; ")}`, exit_code: -1 });
    }
    if (classification.level === "warn") {
      logCmd(logPath, cmd, "warn", undefined, classification.reasons);
    }

    const effectiveCwd = cwd || config.timeout ? undefined : undefined;
    try {
      const result = execSync(cmd, {
        cwd: cwd || undefined,
        timeout: config.timeout * 1000,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout = truncate(result, config.maxOutputLines);
      logCmd(logPath, cmd, classification.level, 0);
      return JSON.stringify({ stdout, stderr: "", exit_code: 0 });
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: string; stderr?: string; killed?: boolean; message?: string };
      if (err.killed) {
        return JSON.stringify({ error: `Command timed out after ${config.timeout}s`, exit_code: -1 });
      }
      const stdout = truncate(err.stdout ?? "", config.maxOutputLines);
      const stderr = truncate(err.stderr ?? "", config.maxOutputLines);
      const exitCode = err.status ?? 1;
      logCmd(logPath, cmd, classification.level, exitCode);
      return JSON.stringify({ stdout, stderr, exit_code: exitCode });
    }
  };
}

function logCmd(logPath: string | undefined, cmd: string, level: string, exitCode?: number, reasons?: string[]): void {
  if (!logPath) return;
  const parts = [`[CMD_EXEC cmd=${JSON.stringify(cmd)} classification=${level}`];
  if (reasons?.length) parts.push(` reasons=${JSON.stringify(reasons)}`);
  if (exitCode !== undefined) parts.push(` exit_code=${exitCode}`);
  parts.push("]");
  try { appendFileSync(logPath, parts.join("") + "\n"); } catch { /* non-fatal */ }
}
