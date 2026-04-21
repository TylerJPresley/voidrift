/**
 * Tests for REQ-UTIL-8: voidrift rollback — list/restore develop checkpoints.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rollbackSource = readFileSync(join(__dirname, "../../src/commands/rollback.ts"), "utf-8");
const indexSource = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

// ---------------------------------------------------------------------------
// List checkpoints (AC1)
// ---------------------------------------------------------------------------

describe("list checkpoints (REQ-UTIL-8 AC1)", () => {
  it("loads checkpoints from checkpoints.jsonl", () => {
    expect(rollbackSource).toContain("mgr.load(cpPath)");
    expect(rollbackSource).toContain("checkpoints.jsonl");
  });

  it("displays task ID and timestamp", () => {
    expect(rollbackSource).toContain("cp.taskId");
    expect(rollbackSource).toContain("cp.timestamp");
  });

  it("shows friendly message when no checkpoints", () => {
    expect(rollbackSource).toContain("No checkpoints available");
  });
});

// ---------------------------------------------------------------------------
// Restore checkpoint (AC2)
// ---------------------------------------------------------------------------

describe("restore checkpoint (REQ-UTIL-8 AC2)", () => {
  it("calls mgr.restore(turn)", () => {
    expect(rollbackSource).toContain("mgr.restore(turn)");
  });

  it("reports success on restore", () => {
    expect(rollbackSource).toContain("Restored working tree to checkpoint");
  });

  it("reports error when checkpoint not found", () => {
    expect(rollbackSource).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Git requirement
// ---------------------------------------------------------------------------

describe("git requirement (REQ-UTIL-8)", () => {
  it("checks isGitRepo before proceeding", () => {
    expect(rollbackSource).toContain("isGitRepo(projectDir)");
  });

  it("errors when not a git repo", () => {
    expect(rollbackSource).toContain("Not a git repository");
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

describe("rollback wired in index.ts (REQ-UTIL-8)", () => {
  it("handles rollback command", () => {
    expect(indexSource).toContain('command === "rollback"');
    expect(indexSource).toContain("./commands/rollback.js");
  });

  it("parses turn argument", () => {
    expect(indexSource).toContain("parseInt(args[1], 10)");
  });

  it("appears in help text", () => {
    expect(indexSource).toContain("rollback [turn]");
  });
});
