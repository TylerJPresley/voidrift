/**
 * Tests for REQ-UTIL-2 (voidrift log command) and REQ-LOG-2 (global log metadata).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCommandSection, lastLines } from "../../src/commands/log.js";

const logSource = readFileSync(join(__dirname, "../../src/commands/log.ts"), "utf-8");
const indexSource = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

// ---------------------------------------------------------------------------
// extractCommandSection
// ---------------------------------------------------------------------------

describe("extractCommandSection (REQ-UTIL-2)", () => {
  const sampleLog = [
    "--- gather-2026-04-20T08:00:00 ---",
    "first-run output alpha",
    "first-run output beta",
    "--- plan-2026-04-20T08:05:00 ---",
    "plan line 1",
    "--- gather-2026-04-20T08:10:00 ---",
    "second gather line 1",
    "second gather line 2",
    "second gather line 3",
  ].join("\n");

  it("extracts the most recent section for a command", () => {
    const section = extractCommandSection(sampleLog, "gather");
    expect(section).toContain("second gather line 1");
    expect(section).toContain("second gather line 3");
  });

  it("does not include earlier sections of the same command", () => {
    const section = extractCommandSection(sampleLog, "gather");
    expect(section).not.toContain("first-run output alpha");
  });

  it("returns empty string when command not found", () => {
    expect(extractCommandSection(sampleLog, "deploy")).toBe("");
  });

  it("extracts plan section correctly", () => {
    const section = extractCommandSection(sampleLog, "plan");
    expect(section).toContain("plan line 1");
    expect(section).not.toContain("gather");
  });
});

// ---------------------------------------------------------------------------
// lastLines
// ---------------------------------------------------------------------------

describe("lastLines (REQ-UTIL-2)", () => {
  it("returns last N lines", () => {
    const text = "a\nb\nc\nd\ne";
    expect(lastLines(text, 3)).toBe("c\nd\ne");
  });

  it("returns all lines when fewer than N", () => {
    expect(lastLines("a\nb", 10)).toBe("a\nb");
  });
});

// ---------------------------------------------------------------------------
// runLog structure (REQ-UTIL-2)
// ---------------------------------------------------------------------------

describe("runLog structure (REQ-UTIL-2)", () => {
  it("exports runLog function", () => {
    expect(logSource).toContain("export function runLog(opts: LogOptions)");
  });

  it("supports --global flag for system log", () => {
    expect(logSource).toContain("globalLogPath()");
    expect(logSource).toContain("opts.global");
  });

  it("supports --prune to delete log", () => {
    expect(logSource).toContain("opts.prune");
    expect(logSource).toContain("unlinkSync(logPath)");
  });

  it("supports --follow with watchFile", () => {
    expect(logSource).toContain("opts.follow");
    expect(logSource).toContain("watchFile(logPath");
  });

  it("errors when no .voidrift and not --global", () => {
    expect(logSource).toContain("No .voidrift/ directory");
  });

  it("defaults to 200 lines", () => {
    expect(logSource).toContain("DEFAULT_LINES = 200");
  });
});

// ---------------------------------------------------------------------------
// CLI wiring (REQ-UTIL-2)
// ---------------------------------------------------------------------------

describe("log command wired in index.ts (REQ-UTIL-2)", () => {
  it("handles log command in runHeadless", () => {
    expect(indexSource).toContain('command === "log"');
    expect(indexSource).toContain("import(\"./commands/log.js\")");
  });

  it("passes follow, prune, global options", () => {
    expect(indexSource).toContain('follow: hasFlag("follow")');
    expect(indexSource).toContain('prune: hasFlag("prune")');
    expect(indexSource).toContain('global: hasFlag("global")');
  });

  it("supports -f shorthand for follow", () => {
    expect(indexSource).toContain('args.includes("-f")');
  });

  it("appears in help text", () => {
    expect(indexSource).toContain("log [command]");
  });
});

// ---------------------------------------------------------------------------
// Global log metadata (REQ-LOG-2)
// ---------------------------------------------------------------------------

describe("global log metadata (REQ-LOG-2)", () => {
  it("startup syslog includes cwd", () => {
    expect(indexSource).toContain("cwd=${process.cwd()}");
  });

  it("startup syslog includes model", () => {
    expect(indexSource).toContain("model=${m}");
  });

  it("startup syslog includes command tag", () => {
    expect(indexSource).toContain('`[${command ?? "chat"}]');
  });

  it("exit syslog includes exit code and elapsed", () => {
    expect(indexSource).toContain("exit=${code}");
    expect(indexSource).toContain("elapsed=");
  });

  it("FATAL handler includes command and elapsed", () => {
    expect(indexSource).toContain("FATAL: ${e.message} elapsed=");
  });
});
