/**
 * Tests for REQ-P-5 (task self-containment) and REQ-P-8 (idea auto-archival).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const planSource = readFileSync(join(__dirname, "../../src/commands/plan.ts"), "utf-8");
const manifestSource = readFileSync(join(__dirname, "../../src/manifest.ts"), "utf-8");

// ---------------------------------------------------------------------------
// REQ-P-5: Task self-containment validation
// ---------------------------------------------------------------------------

describe("validateTaskSelfContainment exists and is wired (REQ-P-5)", () => {
  it("exports validateTaskSelfContainment function", () => {
    expect(planSource).toContain("export function validateTaskSelfContainment(dir: string)");
  });

  it("is called in runPlan after validateTaskACs", () => {
    const acsIdx = planSource.indexOf("validateTaskACs(d)");
    const selfIdx = planSource.indexOf("validateTaskSelfContainment(d)");
    expect(acsIdx).toBeGreaterThan(-1);
    expect(selfIdx).toBeGreaterThan(-1);
    expect(selfIdx).toBeGreaterThan(acsIdx);
  });
});

describe("required sections check (REQ-P-5 AC1/AC2)", () => {
  it("checks for User Story section", () => {
    expect(planSource).toContain("## User Story");
    expect(planSource).toContain("missing required section");
  });

  it("checks for Acceptance Criteria section", () => {
    expect(planSource).toContain("## Acceptance Criteria");
  });

  it("checks for Context section", () => {
    expect(planSource).toContain("## Context");
  });

  it("defines REQUIRED_SECTIONS constant", () => {
    expect(planSource).toContain("const REQUIRED_SECTIONS");
  });
});

describe("no shell commands in task body (REQ-P-5 AC3)", () => {
  it("defines SHELL_PATTERN for detecting shell commands", () => {
    expect(planSource).toContain("const SHELL_PATTERN");
  });

  it("pattern matches common shell invocations", () => {
    const match = planSource.match(/const SHELL_PATTERN\s*=\s*(.+);/);
    expect(match).toBeTruthy();
    const re = eval(match![1]);
    expect(re.test("$ npm install")).toBe(true);
    expect(re.test("```bash\necho hello\n```")).toBe(true);
    expect(re.test("npm run build")).toBe(true);
    expect(re.test("make test")).toBe(true);
  });

  it("warns when shell commands found", () => {
    expect(planSource).toContain("task body contains shell commands");
  });

  it("only checks body, not frontmatter", () => {
    // Body extraction: skips frontmatter
    expect(planSource).toMatch(/const body = content\.startsWith\("---\\n"\)/);
  });
});

describe("no .voidrift/ paths in files (REQ-P-5 AC4)", () => {
  it("checks files frontmatter for .voidrift/ paths", () => {
    expect(planSource).toContain('.startsWith(".voidrift/")');
  });

  it("warns when .voidrift/ path found", () => {
    expect(planSource).toContain("targets .voidrift/ path");
  });
});

// ---------------------------------------------------------------------------
// REQ-P-8: Idea auto-archival
// ---------------------------------------------------------------------------

describe("checkIdeaArchival wired into setStatus (REQ-P-8)", () => {
  it("calls checkIdeaArchival when status becomes verified", () => {
    expect(manifestSource).toContain('status === "verified" && task.idea');
    expect(manifestSource).toContain("this.checkIdeaArchival(task.idea)");
  });

  it("call is after _appendHistory", () => {
    const historyIdx = manifestSource.indexOf("this._appendHistory(id, status)");
    const archivalIdx = manifestSource.indexOf("this.checkIdeaArchival(task.idea)");
    expect(historyIdx).toBeGreaterThan(-1);
    expect(archivalIdx).toBeGreaterThan(-1);
    expect(archivalIdx).toBeGreaterThan(historyIdx);
  });

  it("checkIdeaArchival checks all idea tasks are verified", () => {
    expect(manifestSource).toContain('ideaTasks.every(t => t.status === "verified")');
  });

  it("checkIdeaArchival moves idea file to archived/", () => {
    expect(manifestSource).toContain("renameSync(ideaPath");
    expect(manifestSource).toContain('join(archiveDir, `IDEA-${ideaId}.md`)');
  });
});
