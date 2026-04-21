/**
 * Tests for REQ-G-4: Per-file analysis status and stage summary.
 *
 * AC1: All files cached → each shows cached status
 * AC2: Fresh files → show agent stats
 * Stage summary: total, cached, fresh breakdown
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const gatherSource = readFileSync(join(__dirname, "../../src/commands/gather.ts"), "utf-8");

// ---------------------------------------------------------------------------
// AC1: Cached files show cached status
// ---------------------------------------------------------------------------

describe("cached file status (REQ-G-4 AC1)", () => {
  it("runFileAnalysis marks cached files with cached status", () => {
    expect(gatherSource).toContain('status: "cached"');
  });

  it("cached files skip agent call", () => {
    // When cached, results[fp] = cached and continue — no agent created
    expect(gatherSource).toMatch(/if \(cached\) \{[\s\S]*?results\[fp\] = cached[\s\S]*?continue;/);
  });
});

// ---------------------------------------------------------------------------
// AC2: Fresh files show agent stats
// ---------------------------------------------------------------------------

describe("fresh file agent stats (REQ-G-4 AC2)", () => {
  it("fresh files use trackAgentWithStats for progress", () => {
    expect(gatherSource).toContain("trackAgentWithStats(agent, userMsg, fp, onUpdate)");
  });

  it("per-file status lines are created for each file", () => {
    expect(gatherSource).toContain("fileLines[f] = { update:");
  });
});

// ---------------------------------------------------------------------------
// Stage summary: total, cached, fresh breakdown
// ---------------------------------------------------------------------------

describe("stage summary breakdown (REQ-G-4)", () => {
  it("pre-counts cached files before analysis", () => {
    expect(gatherSource).toContain("cachedCount");
    expect(gatherSource).toContain("loadCachedAnalysis(d, fp, hash)) cachedCount++");
  });

  it("computes fresh count from total minus cached", () => {
    expect(gatherSource).toContain("freshCount = allFiles.length - cachedCount");
  });

  it("displays aggregate summary with total, fresh, and cached counts", () => {
    expect(gatherSource).toContain("analyzed, ${cachedCount} cached");
  });
});
