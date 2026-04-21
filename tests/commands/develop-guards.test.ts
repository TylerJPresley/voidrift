/**
 * Tests for REQ-D-4 (git diff warning) and REQ-D-13 (read-before-write enforcement).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const devSource = readFileSync(join(__dirname, "../../src/commands/develop.ts"), "utf-8");

// ---------------------------------------------------------------------------
// REQ-D-4: Git diff warning when writes but no changes
// ---------------------------------------------------------------------------

describe("git diff warning (REQ-D-4)", () => {
  it("checks diff stats for zero changes after writes", () => {
    expect(devSource).toContain("stats.every(s => s.linesAdded === 0 && s.linesRemoved === 0)");
  });

  it("checks isGitRepo before warning", () => {
    // The warning block requires isGitRepo
    const warnIdx = devSource.indexOf("writes occurred but git diff shows no changes");
    const igrIdx = devSource.lastIndexOf("isGitRepo", warnIdx);
    expect(warnIdx).toBeGreaterThan(-1);
    expect(igrIdx).toBeGreaterThan(-1);
  });

  it("logs warning to stderr", () => {
    expect(devSource).toContain("writes occurred but git diff shows no changes");
  });

  it("warning is after computeDiffStats", () => {
    const statsIdx = devSource.indexOf("ctx.computeDiffStats()");
    const warnIdx = devSource.indexOf("writes occurred but git diff shows no changes");
    expect(statsIdx).toBeGreaterThan(-1);
    expect(warnIdx).toBeGreaterThan(statsIdx);
  });

  it("warning is before clearSnapshots", () => {
    const warnIdx = devSource.indexOf("writes occurred but git diff shows no changes");
    const clearIdx = devSource.indexOf("ctx.clearSnapshots()", warnIdx);
    expect(warnIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(warnIdx);
  });
});

// ---------------------------------------------------------------------------
// REQ-D-13: Read-before-write enforcement
// ---------------------------------------------------------------------------

describe("read-before-write enforcement (REQ-D-13)", () => {
  it("tracks files read in a Set", () => {
    expect(devSource).toContain("const filesRead = new Set<string>()");
  });

  it("records reads from file tool calls", () => {
    expect(devSource).toContain('parsed.action === "read" && parsed.path) filesRead.add(parsed.path)');
  });

  it("intercepts write to existing unread file", () => {
    expect(devSource).toContain('!filesRead.has(parsed.path) && existsSync(join(d, "..", parsed.path))');
  });

  it("intercepts edit to existing unread file", () => {
    expect(devSource).toContain('parsed.action === "write" || parsed.action === "edit"');
  });

  it("returns error message forcing read first", () => {
    expect(devSource).toContain("Read ${parsed.path} first");
    expect(devSource).toContain("file(action='read') to understand existing code before writing");
  });

  it("allows writes to new files (not on disk)", () => {
    // existsSync check means new files pass through
    expect(devSource).toContain("existsSync(join(d, \"..\", parsed.path))");
  });

  it("allows writes after reading", () => {
    // filesRead.has check means previously read files pass through
    expect(devSource).toContain("!filesRead.has(parsed.path)");
  });
});
