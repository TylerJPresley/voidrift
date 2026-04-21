/**
 * Tests for REQ-LOG-4: Error summary by category at command completion.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const errorsSource = readFileSync(join(__dirname, "../src/errors.ts"), "utf-8");
const loopSource = readFileSync(join(__dirname, "../src/agent/loop.ts"), "utf-8");
const gatherSource = readFileSync(join(__dirname, "../src/commands/gather.ts"), "utf-8");
const planSource = readFileSync(join(__dirname, "../src/commands/plan.ts"), "utf-8");
const developSource = readFileSync(join(__dirname, "../src/commands/develop.ts"), "utf-8");
const verifySource = readFileSync(join(__dirname, "../src/commands/verify.ts"), "utf-8");
const deploySource = readFileSync(join(__dirname, "../src/commands/deploy.ts"), "utf-8");

// ---------------------------------------------------------------------------
// formatSummary shows recoverability (AC1)
// ---------------------------------------------------------------------------

describe("formatSummary with recoverability (REQ-LOG-4)", () => {
  it("shows recoverable label when all recoverable", () => {
    expect(errorsSource).toContain("(recoverable)");
  });

  it("shows fatal count when some are fatal", () => {
    expect(errorsSource).toContain("fatal)");
  });

  it("groups by category", () => {
    expect(errorsSource).toContain("Object.entries(cats).sort()");
  });
});

// ---------------------------------------------------------------------------
// Shared tracker (module-level singleton)
// ---------------------------------------------------------------------------

describe("shared ErrorTracker (REQ-LOG-4)", () => {
  it("exports getSharedTracker", () => {
    expect(errorsSource).toContain("export function getSharedTracker()");
  });

  it("exports resetSharedTracker", () => {
    expect(errorsSource).toContain("export function resetSharedTracker()");
  });

  it("exports displayErrorSummary", () => {
    expect(errorsSource).toContain("export function displayErrorSummary(");
  });
});

// ---------------------------------------------------------------------------
// AgentLoop records errors
// ---------------------------------------------------------------------------

describe("AgentLoop records errors (REQ-LOG-4)", () => {
  it("accepts errorTracker option", () => {
    expect(loopSource).toContain("errorTracker?: import");
  });

  it("auto-uses shared tracker when none provided", () => {
    expect(loopSource).toContain("getSharedTracker()");
  });

  it("records API errors during retry", () => {
    expect(loopSource).toContain('_errorTracker?.record("api"');
  });

  it("records tool execution errors", () => {
    expect(loopSource).toContain('_errorTracker?.record("tool", "execution"');
  });

  it("records missing tool handler errors", () => {
    expect(loopSource).toContain('_errorTracker?.record("tool", "no_handler"');
  });

  it("records context-length errors", () => {
    expect(loopSource).toContain('_errorTracker?.record("context"');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle commands wire tracker
// ---------------------------------------------------------------------------

describe("lifecycle commands wire error tracker (REQ-LOG-4)", () => {
  for (const [name, source] of [
    ["gather", gatherSource],
    ["plan", planSource],
    ["develop", developSource],
    ["verify", verifySource],
    ["deploy", deploySource],
  ] as const) {
    it(`${name} calls resetSharedTracker`, () => {
      expect(source).toContain("resetSharedTracker()");
    });

    it(`${name} calls displayErrorSummary`, () => {
      expect(source).toContain("displayErrorSummary(");
    });
  }
});
