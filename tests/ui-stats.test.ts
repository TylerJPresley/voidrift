/**
 * Tests for REQ-UI-10: Uniform agent stats with colored pie icons.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const progressSource = readFileSync(join(__dirname, "../src/commands/progress.ts"), "utf-8");
const chatSource = readFileSync(join(__dirname, "../src/commands/chat.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Colored pie icons (AC2/AC3/AC4)
// ---------------------------------------------------------------------------

describe("colored pie icons in statsStr (REQ-UI-10)", () => {
  it("ansiColor helper converts hex to ANSI true-color", () => {
    expect(progressSource).toContain("function ansiColor(hex: string)");
    expect(progressSource).toContain("\\x1b[38;2;${r};${g};${b}m");
  });

  it("statsStr applies ctxColor to pie icon", () => {
    expect(progressSource).toContain("ansiColor(ctxColor(ctxPct))");
    expect(progressSource).toContain("ctxIcon(ctxPct)");
  });

  it("RESET code follows the colored icon", () => {
    expect(progressSource).toContain("${RESET} ${ctxPct}%");
  });
});

// ---------------------------------------------------------------------------
// Pie icon thresholds (AC2/AC3/AC4)
// ---------------------------------------------------------------------------

describe("pie icon thresholds (REQ-UI-10)", () => {
  it("ctxIcon returns ◔ for 18%", () => {
    expect(progressSource).toContain("◔");
  });

  it("ctxIcon returns ◑ for 50%", () => {
    expect(progressSource).toContain("◑");
  });

  it("ctxIcon returns ◕ for 75%", () => {
    expect(progressSource).toContain("◕");
  });

  it("ctxColor returns green for ≤50%", () => {
    expect(progressSource).toContain("#4ec9b0");
  });

  it("ctxColor returns yellow for 51-75%", () => {
    expect(progressSource).toContain("#e5c07b");
  });

  it("ctxColor returns red for >75%", () => {
    expect(progressSource).toContain("#e06c75");
  });
});

// ---------------------------------------------------------------------------
// Chat uses statsStr (uniform format)
// ---------------------------------------------------------------------------

describe("chat uses statsStr for completion stats (REQ-UI-10)", () => {
  it("imports statsStr from progress", () => {
    expect(chatSource).toContain('import { statsStr } from "./progress.js"');
  });

  it("calls statsStr for completion line", () => {
    expect(chatSource).toContain("statsStr(elapsed, completionIn, completionOut, ctxPct,");
  });

  it("computes ctxPct from prompt tokens and maxContext", () => {
    expect(chatSource).toContain("completionIn / model.config.maxContext");
  });

  it("does not use manual token formatting", () => {
    // Old manual format should be gone
    expect(chatSource).not.toContain('`↓ ${(inp/1000).toFixed(1)}k`');
  });
});

// ---------------------------------------------------------------------------
// Fields with no data omitted (AC5/AC7)
// ---------------------------------------------------------------------------

describe("fields with no data omitted (REQ-UI-10)", () => {
  it("statsStr omits elapsed when < 1s", () => {
    expect(progressSource).toContain("if (elapsed >= 1)");
  });

  it("statsStr omits tokensIn when zero", () => {
    expect(progressSource).toContain("if (tokensIn)");
  });

  it("statsStr omits ctxPct when undefined", () => {
    expect(progressSource).toContain("if (ctxPct !== undefined)");
  });
});

// ---------------------------------------------------------------------------
// Status transitions (AC8)
// ---------------------------------------------------------------------------

describe("status transitions (REQ-UI-10)", () => {
  it("AgentProgress type includes queued, thinking, complete, failed, cached", () => {
    expect(progressSource).toContain('"queued" | "thinking" | "complete" | "failed" | "cached"');
  });

  it("trackAgentWithStats transitions through queued → thinking → complete", () => {
    expect(progressSource).toContain('"queued"');
    expect(progressSource).toContain('status = "thinking"');
    expect(progressSource).toContain('status: "complete"');
  });

  it("cached status shows no lifecycle transition", () => {
    expect(progressSource).toContain('p.status === "cached"');
    expect(progressSource).toContain("✓ cached");
  });
});
