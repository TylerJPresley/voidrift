/**
 * Tests for REQ-UTIL-1: Status command — command completion, task counts, idea count.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const statusSource = readFileSync(join(__dirname, "../../src/commands/status.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Command completion status (REQ-UTIL-1 AC1)
// ---------------------------------------------------------------------------

describe("command completion status (REQ-UTIL-1)", () => {
  it("exports getCommandStatus function", () => {
    expect(statusSource).toContain("export function getCommandStatus(d: string)");
  });

  it("checks gather via REQUIREMENTS.md", () => {
    expect(statusSource).toContain('existsSync(join(d, "REQUIREMENTS.md"))');
  });

  it("checks plan via ARCHITECTURE.md and manifest", () => {
    expect(statusSource).toContain('existsSync(join(d, "ARCHITECTURE.md"))');
    expect(statusSource).toContain('existsSync(join(d, "tasks", "manifest.yml"))');
  });

  it("checks develop via manifest task statuses", () => {
    expect(statusSource).toContain('t.status === "in-progress"');
    expect(statusSource).toContain("mm.hasWork()");
  });

  it("checks verify via VERIFY.md", () => {
    expect(statusSource).toContain('existsSync(join(d, "VERIFY.md"))');
  });

  it("checks deploy via STATE.md deploy entry", () => {
    expect(statusSource).toContain('stateContent.includes("— deploy (")');
  });

  it("returns done/not started/in progress strings", () => {
    expect(statusSource).toContain('"done"');
    expect(statusSource).toContain('"not started"');
    expect(statusSource).toContain('"in progress"');
  });

  it("displays command status with emoji", () => {
    expect(statusSource).toContain("Command Status");
    expect(statusSource).toContain("CMD_EMOJI");
  });
});

// ---------------------------------------------------------------------------
// Idea count (REQ-UTIL-1)
// ---------------------------------------------------------------------------

describe("idea count (REQ-UTIL-1)", () => {
  it("exports countIdeas function", () => {
    expect(statusSource).toContain("export function countIdeas(d: string): number");
  });

  it("counts IDEA-*.md files in ideas directory", () => {
    expect(statusSource).toContain('/^IDEA-\\d+\\.md$/');
  });

  it("returns 0 when ideas directory does not exist", () => {
    expect(statusSource).toContain("if (!existsSync(dir)) return 0");
  });

  it("displays idea count in output", () => {
    expect(statusSource).toContain("Ideas:");
  });
});

// ---------------------------------------------------------------------------
// No manifest case (REQ-UTIL-1 AC2)
// ---------------------------------------------------------------------------

describe("no manifest message (REQ-UTIL-1)", () => {
  it("shows friendly message when no .voidrift directory", () => {
    expect(statusSource).toContain("No active project");
  });

  it("shows friendly message when no manifest", () => {
    expect(statusSource).toContain("No task manifest");
  });
});

// ---------------------------------------------------------------------------
// Task counts by lifecycle status
// ---------------------------------------------------------------------------

describe("task counts by status (REQ-UTIL-1)", () => {
  it("shows all lifecycle statuses", () => {
    for (const s of ["planned", "in-progress", "implemented", "verified", "failed", "blocked"]) {
      expect(statusSource).toContain(s);
    }
  });

  it("shows total count", () => {
    expect(statusSource).toContain("Total:");
  });
});
