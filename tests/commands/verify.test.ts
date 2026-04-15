import { describe, it, expect } from "vitest";
import { parseVerifyPlan, readArchField } from "../../src/commands/verify.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseVerifyPlan", () => {
  it("parses testable items", () => {
    const text = "# Plan\n\n### ITEM-1\n\nTest case 1\n\n### ITEM-2\n\nTest case 2\n";
    const items = parseVerifyPlan(text);
    expect(items).toHaveLength(2);
    expect(items[0].itemId).toBe("ITEM-1");
    expect(items[0].skip).toBe(false);
    expect(items[0].content).toContain("Test case 1");
  });

  it("parses skip items", () => {
    const text = "### ITEM-1 [SKIP]\n\nReason: qualitative\n\n### ITEM-2\n\nTestable\n";
    const items = parseVerifyPlan(text);
    expect(items[0].skip).toBe(true);
    expect(items[1].skip).toBe(false);
  });

  it("returns empty for no items", () => {
    expect(parseVerifyPlan("No items here")).toHaveLength(0);
  });
});

describe("readArchField", () => {
  const tmp = join(tmpdir(), `voidrift-test-arch-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("reads field from YAML frontmatter", () => {
    writeFileSync(join(tmp, "ARCHITECTURE.md"), "---\nstartup_command: uvicorn main:app\ntest_bootstrap: python seed.py\n---\n\n# Arch");
    expect(readArchField(tmp, "startup_command")).toBe("uvicorn main:app");
    expect(readArchField(tmp, "test_bootstrap")).toBe("python seed.py");
  });

  it("returns null for missing field", () => {
    writeFileSync(join(tmp, "ARCHITECTURE.md"), "---\nmodules: [a]\n---\n\n# Arch");
    expect(readArchField(tmp, "startup_command")).toBeNull();
  });

  it("returns null when no ARCHITECTURE.md", () => {
    expect(readArchField(tmp, "startup_command")).toBeNull();
  });
});
