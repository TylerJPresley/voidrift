import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRunCommand } from "../../src/tools/shell.js";
import type { BashConfig } from "../../src/config.js";

function cfg(overrides: Partial<BashConfig> = {}): BashConfig {
  return { enabled: true, allowedPatterns: [], timeout: 120, maxOutputLines: 500, ...overrides };
}

describe("createRunCommand", () => {
  const tmp = join(tmpdir(), `voidrift-test-shell-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // -- enabled / disabled --

  it("enabled runs command and returns JSON", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("echo hello"));
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exit_code).toBe(0);
  });

  it("disabled rejects all commands", () => {
    const run = createRunCommand(cfg({ enabled: false }));
    const r = JSON.parse(run("echo hello"));
    expect(r.error).toMatch(/disabled/i);
    expect(r.exit_code).toBe(-1);
  });

  // -- allowed patterns --

  it("allowed pattern permits matching command", () => {
    const run = createRunCommand(cfg({ allowedPatterns: ["echo *"] }));
    const r = JSON.parse(run("echo test"));
    expect(r.exit_code).toBe(0);
  });

  it("allowed pattern rejects non-matching command", () => {
    const run = createRunCommand(cfg({ allowedPatterns: ["pytest *"] }));
    const r = JSON.parse(run("git push --force"));
    expect(r.error).toMatch(/allowed patterns/i);
    expect(r.exit_code).toBe(-1);
  });

  // -- security classification --

  it("blocks dangerous commands (rm -rf /)", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("rm -rf /"));
    expect(r.error).toMatch(/blocked/i);
  });

  it("blocks dangerous even when pattern matches", () => {
    const run = createRunCommand(cfg({ allowedPatterns: ["rm *"] }));
    const r = JSON.parse(run("rm -rf /"));
    expect(r.error).toMatch(/blocked/i);
  });

  it("global allowed overrides classification", () => {
    const run = createRunCommand(cfg(), ["git push *"]);
    // Command will fail (no git repo) but should not be blocked
    const r = JSON.parse(run("git push --force origin main"));
    expect(r.error ?? "").not.toMatch(/blocked/i);
  });

  // -- output truncation --

  it("truncates output exceeding maxOutputLines", () => {
    const run = createRunCommand(cfg({ maxOutputLines: 5 }));
    const r = JSON.parse(run("node -e \"for(let i=0;i<20;i++) console.log('line '+i)\""));
    expect(r.exit_code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[lines.length - 1]).toMatch(/truncated/i);
    expect(lines).toHaveLength(6); // 5 content + 1 truncation message
  });

  it("no truncation within limit", () => {
    const run = createRunCommand(cfg({ maxOutputLines: 10 }));
    const r = JSON.parse(run("echo -e 'a\\nb\\nc'"));
    expect(r.stdout).not.toMatch(/truncated/i);
  });

  // -- timeout --

  it("returns non-zero exit for timed-out commands", () => {
    const run = createRunCommand(cfg({ timeout: 1 }));
    const r = JSON.parse(run("sleep 10"));
    // execSync kills the process on timeout — exit_code is non-zero
    expect(r.exit_code).not.toBe(0);
  });

  // -- exit codes --

  it("returns exit code 0 for success", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("true"));
    expect(r.exit_code).toBe(0);
  });

  it("returns non-zero exit code for failure", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("false"));
    expect(r.exit_code).not.toBe(0);
  });

  it("returns exit code for command not found", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("this-command-does-not-exist-xyz"));
    expect(r.exit_code).toBe(127);
  });

  // -- cwd --

  it("uses cwd argument", () => {
    const run = createRunCommand(cfg());
    const r = JSON.parse(run("pwd", tmp));
    expect(r.stdout.trim()).toBe(tmp);
  });

  // -- logging --

  it("logs command execution to logPath", () => {
    const logFile = join(tmp, "cmd.log");
    const run = createRunCommand(cfg(), [], logFile);
    run("echo logged");
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("CMD_EXEC");
    expect(content).toContain("echo logged");
  });
});
