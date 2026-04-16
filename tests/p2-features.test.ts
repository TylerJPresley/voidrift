/**
 * Tests for P2 features: system log, ErrorTracker, git helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorTracker } from "../src/errors.js";
import { gitCommit, isGitRepo } from "../src/git.js";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// ErrorTracker
// ---------------------------------------------------------------------------

describe("ErrorTracker", () => {
  it("records events and counts by category", () => {
    const t = new ErrorTracker();
    t.record("api", "RateLimit", "429 Too Many Requests");
    t.record("api", "Timeout", "Request timed out");
    t.record("tool", "WriteError", "Permission denied");
    expect(t.count).toBe(3);
    expect(t.summaryByCategory()).toEqual({ api: 2, tool: 1 });
  });

  it("toStateDict returns structured summary", () => {
    const t = new ErrorTracker();
    t.record("context", "ContextLength", "Exceeded limit");
    const d = t.toStateDict();
    expect(d.total).toBe(1);
    expect(d.categories.context).toBe(1);
  });

  it("formatSummary returns empty string when no errors", () => {
    const t = new ErrorTracker();
    expect(t.formatSummary()).toBe("");
  });

  it("formatSummary lists categories", () => {
    const t = new ErrorTracker();
    t.record("api", "Error", "msg");
    t.record("filesystem", "Error", "msg");
    const s = t.formatSummary();
    expect(s).toContain("api: 1");
    expect(s).toContain("filesystem: 1");
  });

  it("writeJsonl writes to .errors.jsonl", () => {
    const t = new ErrorTracker();
    t.record("parse", "JSONError", "Invalid JSON", { taskId: "TASK-1", recoverable: false });
    const dir = join(tmpdir(), `voidrift-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, "test.log");
    writeFileSync(logPath, "");
    t.writeJsonl(logPath);
    const errPath = join(dir, "test.errors.jsonl");
    expect(existsSync(errPath)).toBe(true);
    const { readFileSync } = require("node:fs");
    const line = JSON.parse(readFileSync(errPath, "utf-8").trim());
    expect(line.category).toBe("parse");
    expect(line.taskId).toBe("TASK-1");
    expect(line.recoverable).toBe(false);
    rmSync(dir, { recursive: true });
  });

  it("events are readonly", () => {
    const t = new ErrorTracker();
    t.record("api", "Error", "msg");
    expect(t.events.length).toBe(1);
    expect(t.events[0].category).toBe("api");
  });
});

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

describe("git helpers", () => {
  it("isGitRepo returns true for a git repo", () => {
    // The voidrift project itself is a git repo
    expect(isGitRepo(process.cwd())).toBe(true);
  });

  it("isGitRepo returns false for non-repo", () => {
    expect(isGitRepo(tmpdir())).toBe(false);
  });

  it("gitCommit returns false with empty files", () => {
    expect(gitCommit(process.cwd(), [], "test")).toBe(false);
  });
});
