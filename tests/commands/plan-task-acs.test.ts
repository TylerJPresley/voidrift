/**
 * Tests for REQ-P-2: Task AC structural validation.
 *
 * AC1: ACs scoped to task files only — references outside task scope flagged.
 * AC2: ACs contain specific values — vague ACs flagged.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const planSource = readFileSync(join(__dirname, "../../src/commands/plan.ts"), "utf-8");

describe("validateTaskACs exists and is wired (REQ-P-2)", () => {
  it("exports validateTaskACs function", () => {
    expect(planSource).toContain("export function validateTaskACs(dir: string)");
  });

  it("is called in runPlan after buildTaskFiles", () => {
    const buildIdx = planSource.indexOf("buildTaskFiles(d,");
    const validateIdx = planSource.indexOf("validateTaskACs(d)");
    expect(buildIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeGreaterThan(buildIdx);
  });
});

describe("AC scope check (REQ-P-2 AC1)", () => {
  it("extracts files from YAML frontmatter", () => {
    expect(planSource).toMatch(/fm\?\.files/);
  });

  it("strips create/edit annotations from file paths", () => {
    expect(planSource).toContain('.replace(/\\s*\\(.*\\)$/, "")');
  });

  it("checks file path references in ACs against task files", () => {
    expect(planSource).toContain("AC references file outside task scope");
  });

  it("only flags paths containing slashes (real file paths)", () => {
    expect(planSource).toContain('ref.includes("/")');
  });
});

describe("AC specificity check (REQ-P-2 AC2)", () => {
  it("defines SPECIFIC_VALUE pattern for concrete values", () => {
    expect(planSource).toContain("const SPECIFIC_VALUE");
  });

  it("pattern matches backtick code", () => {
    const match = planSource.match(/const SPECIFIC_VALUE\s*=\s*(.+);/);
    expect(match).toBeTruthy();
    const re = eval(match![1]);
    expect(re.test("`someFunc()`")).toBe(true);
  });

  it("pattern matches quoted strings", () => {
    const match = planSource.match(/const SPECIFIC_VALUE\s*=\s*(.+);/);
    const re = eval(match![1]);
    expect(re.test('"api_key"')).toBe(true);
  });

  it("pattern matches numbers", () => {
    const match = planSource.match(/const SPECIFIC_VALUE\s*=\s*(.+);/);
    const re = eval(match![1]);
    expect(re.test("returns 404")).toBe(true);
  });

  it("pattern rejects vague text", () => {
    const match = planSource.match(/const SPECIFIC_VALUE\s*=\s*(.+);/);
    const re = eval(match![1]);
    expect(re.test("Configuration loading works correctly")).toBe(false);
  });

  it("flags vague ACs with warning", () => {
    expect(planSource).toContain("AC may be vague (no specific values)");
  });
});

describe("validation is warnings-only (REQ-P-2)", () => {
  it("returns warning count, does not throw", () => {
    expect(planSource).toMatch(/return warnings;/);
  });

  it("uses stderr for warnings like checkReqCoverage", () => {
    expect(planSource).toMatch(/process\.stderr\.write\(`⚠ TASK-/);
  });
});
