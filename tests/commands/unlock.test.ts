/**
 * Tests for REQ-UTIL-3: voidrift unlock — remove develop lock and kill running process.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const unlockSource = readFileSync(join(__dirname, "../../src/commands/unlock.ts"), "utf-8");
const indexSource = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

describe("runUnlock (REQ-UTIL-3)", () => {
  it("exports runUnlock function", () => {
    expect(unlockSource).toContain("export function runUnlock(): number");
  });

  it("checks for .develop.lock file", () => {
    expect(unlockSource).toContain(".develop.lock");
    expect(unlockSource).toContain("existsSync(lock)");
  });

  it("reads PID from lock file", () => {
    expect(unlockSource).toContain('parseInt(content.split("\\n")[0], 10)');
  });

  it("kills process with SIGTERM if alive", () => {
    expect(unlockSource).toContain('process.kill(pid, "SIGTERM")');
  });

  it("checks if process is alive before killing", () => {
    expect(unlockSource).toContain("process.kill(pid, 0)");
  });

  it("removes lock file", () => {
    expect(unlockSource).toContain("unlinkSync(lock)");
  });

  it("handles no lock file gracefully", () => {
    expect(unlockSource).toContain("No lock file found");
  });
});

describe("unlock wired in index.ts (REQ-UTIL-3)", () => {
  it("handles unlock command", () => {
    expect(indexSource).toContain('command === "unlock"');
    expect(indexSource).toContain("./commands/unlock.js");
  });

  it("appears in help text", () => {
    expect(indexSource).toContain("unlock");
  });
});
