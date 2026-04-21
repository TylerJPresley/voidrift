/**
 * Tests for REQ-VF-3: Doc verification can write bug reports.
 *
 * AC1: Mismatch → bug report written
 * AC2: Consistent → no bug reports
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const verifySource = readFileSync(join(__dirname, "../../src/commands/verify.ts"), "utf-8");
const builderSource = readFileSync(join(__dirname, "../../src/tools/builder.ts"), "utf-8");

// ---------------------------------------------------------------------------
// OCP exports for verify-doc tool set
// ---------------------------------------------------------------------------

describe("verify-doc tool set exports (REQ-VF-3)", () => {
  it("exports AGENT_TOOLS_DOC with file tool", () => {
    expect(verifySource).toContain('export const AGENT_TOOLS_DOC = new Set(["file"])');
  });

  it("exports AGENT_TOOL_ACTIONS_DOC with read, write, list", () => {
    expect(verifySource).toContain("AGENT_TOOL_ACTIONS_DOC");
    expect(verifySource).toMatch(/AGENT_TOOL_ACTIONS_DOC.*file.*read.*write.*list/);
  });
});

// ---------------------------------------------------------------------------
// builder.ts has verify-doc entries
// ---------------------------------------------------------------------------

describe("builder.ts verify-doc entries (REQ-VF-3)", () => {
  it("_FALLBACK_TOOLS includes verify-doc", () => {
    expect(builderSource).toContain('"verify-doc": new Set(["file"])');
  });

  it("_FALLBACK_ACTIONS includes verify-doc with write", () => {
    expect(builderSource).toMatch(/"verify-doc":\s*\{\s*file:\s*\["read",\s*"write",\s*"list"\]/);
  });

  it("cmdToModule maps verify-doc to AGENT_TOOLS_DOC", () => {
    expect(builderSource).toContain('"verify-doc": ["../commands/verify.js", "AGENT_TOOLS_DOC", "AGENT_TOOL_ACTIONS_DOC"]');
  });
});

// ---------------------------------------------------------------------------
// _runDocVerify uses verify-doc
// ---------------------------------------------------------------------------

describe("_runDocVerify uses verify-doc tool set (REQ-VF-3)", () => {
  it("calls buildLocalTools with verify-doc", () => {
    expect(verifySource).toContain('buildLocalTools("verify-doc"');
  });

  it("does not use verify-plan for doc verification", () => {
    // _runDocVerify should not use verify-plan anymore
    const fnStart = verifySource.indexOf("async function _runDocVerify");
    const fnEnd = verifySource.indexOf("}", verifySource.indexOf("try {", fnStart) + 100);
    const fnBody = verifySource.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain('buildLocalTools("verify-plan"');
  });
});

// ---------------------------------------------------------------------------
// Doc verification runs before test planning
// ---------------------------------------------------------------------------

describe("doc verification ordering (REQ-VF-3)", () => {
  it("Stage 0 doc verify runs before Stage 1 plan", () => {
    const docIdx = verifySource.indexOf("_runDocVerify(");
    const planIdx = verifySource.indexOf("Stage 1: Planning test cases");
    expect(docIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeLessThan(planIdx);
  });

  it("doc bug count included in VERIFY.md report", () => {
    expect(verifySource).toContain("Doc mismatches | ${docBugCount}");
  });

  it("doc bugs affect verdict", () => {
    expect(verifySource).toContain("docBugCount === 0");
  });
});
