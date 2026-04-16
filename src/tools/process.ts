/**
 * Process manager for verify sub-agents (REQ-VF-8..11).
 * Spawns child processes, buffers output, provides readiness polling.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

const MAX_BUFFER_LINES = 500;

interface ProcessHandle {
  id: string;
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
  exited: boolean;
  exitCode: number | null;
}

const registry = new Map<string, ProcessHandle>();

/** Start a process and return a handle ID (REQ-VF-8). */
export function startProcess(cmd: string, env?: Record<string, string>, cwd?: string): string {
  const id = randomUUID().slice(0, 8);
  const proc = spawn("sh", ["-c", cmd], {
    cwd: cwd ?? process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handle: ProcessHandle = { id, proc, stdout: [], stderr: [], exited: false, exitCode: null };

  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
    handle.stdout.push(...lines);
    if (handle.stdout.length > MAX_BUFFER_LINES) handle.stdout.splice(0, handle.stdout.length - MAX_BUFFER_LINES);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
    handle.stderr.push(...lines);
    if (handle.stderr.length > MAX_BUFFER_LINES) handle.stderr.splice(0, handle.stderr.length - MAX_BUFFER_LINES);
  });

  proc.on("exit", (code) => { handle.exited = true; handle.exitCode = code; });

  registry.set(id, handle);
  return JSON.stringify({ handle_id: id });
}

/** Read buffered output from a running process (REQ-VF-11). */
export function readProcessOutput(handleId: string): string {
  const h = registry.get(handleId);
  if (!h) return JSON.stringify({ error: `No process with handle '${handleId}'` });
  return JSON.stringify({
    stdout: h.stdout.slice(-MAX_BUFFER_LINES).join("\n"),
    stderr: h.stderr.slice(-MAX_BUFFER_LINES).join("\n"),
    exited: h.exited,
    exit_code: h.exitCode,
  });
}

/** Stop a specific process. */
export function stopProcess(handleId: string): string {
  const h = registry.get(handleId);
  if (!h) return JSON.stringify({ error: `No process with handle '${handleId}'` });
  if (!h.exited) { try { h.proc.kill("SIGTERM"); } catch { /* */ } }
  registry.delete(handleId);
  return JSON.stringify({ stopped: handleId });
}

/** Stop all managed processes (REQ-VF-10). */
export function stopAll(): void {
  for (const [id, h] of registry) {
    if (!h.exited) { try { h.proc.kill("SIGTERM"); } catch { /* */ } }
  }
  registry.clear();
}

/** Wait for a process to be ready (REQ-VF-9). */
export function waitForReady(handleId: string, strategy: string, target: string, timeout: number): string {
  const h = registry.get(handleId);
  if (!h) return JSON.stringify({ error: `No process with handle '${handleId}'` });

  const deadline = Date.now() + timeout * 1000;

  if (strategy === "http") return _waitHttp(target, deadline, h);
  if (strategy === "port") return _waitPort(parseInt(target, 10), deadline, h);
  if (strategy === "log_pattern") return _waitLogPattern(target, deadline, h);
  return JSON.stringify({ error: `Unknown strategy: ${strategy}` });
}

function _waitHttp(url: string, deadline: number, h: ProcessHandle): string {
  // Synchronous polling loop
  while (Date.now() < deadline) {
    if (h.exited) return JSON.stringify({ error: "Process exited before ready", exit_code: h.exitCode });
    try {
      const { execSync } = require("node:child_process");
      const result = execSync(`curl -s -o /dev/null -w "%{http_code}" "${url}"`, { timeout: 2000, encoding: "utf-8" }).trim();
      if (result === "200") return JSON.stringify({ ready: true, strategy: "http", elapsed_ms: Date.now() - (deadline - 30000) });
    } catch { /* not ready yet */ }
    _sleepSync(500);
  }
  return JSON.stringify({ error: `Timeout waiting for ${url}`, strategy: "http" });
}

function _waitPort(port: number, deadline: number, h: ProcessHandle): string {
  while (Date.now() < deadline) {
    if (h.exited) return JSON.stringify({ error: "Process exited before ready", exit_code: h.exitCode });
    try {
      const { execSync } = require("node:child_process");
      execSync(`nc -z localhost ${port}`, { timeout: 1000, stdio: "pipe" });
      return JSON.stringify({ ready: true, strategy: "port" });
    } catch { /* not ready yet */ }
    _sleepSync(500);
  }
  return JSON.stringify({ error: `Timeout waiting for port ${port}`, strategy: "port" });
}

function _waitLogPattern(pattern: string, deadline: number, h: ProcessHandle): string {
  while (Date.now() < deadline) {
    if (h.exited) return JSON.stringify({ error: "Process exited before ready", exit_code: h.exitCode });
    const allOutput = [...h.stdout, ...h.stderr].join("\n");
    if (allOutput.includes(pattern)) return JSON.stringify({ ready: true, strategy: "log_pattern" });
    _sleepSync(250);
  }
  return JSON.stringify({ error: `Timeout waiting for pattern "${pattern}"`, strategy: "log_pattern" });
}

function _sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait — acceptable for short polling intervals */ }
}
