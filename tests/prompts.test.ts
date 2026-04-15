import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPrompt, loadTemplate, clearCache } from "../src/prompts.js";

describe("loadPrompt", () => {
  const tmp = join(tmpdir(), `voidrift-test-prompts-${Date.now()}`);
  const resourceDir = join(tmp, "resources", "prompts");

  beforeEach(() => {
    clearCache();
    mkdirSync(resourceDir, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a section from a command prompt file", () => {
    writeFileSync(join(resourceDir, "test.md"), "# Test\n\n## SECTION-A\n\nContent A\n\n## SECTION-B\n\nContent B\n");
    expect(loadPrompt("test", "SECTION-A", "/nonexistent")).toBe("Content A");
    expect(loadPrompt("test", "SECTION-B", "/nonexistent")).toBe("Content B");
  });

  it("returns empty string for missing section", () => {
    writeFileSync(join(resourceDir, "test.md"), "## ONLY\n\nHello\n");
    expect(loadPrompt("test", "MISSING", "/nonexistent")).toBe("");
  });

  it("returns empty string for missing file", () => {
    expect(loadPrompt("nonexistent", "ANY", "/nonexistent")).toBe("");
  });

  it("caches results", () => {
    writeFileSync(join(resourceDir, "cached.md"), "## SEC\n\nOriginal\n");
    expect(loadPrompt("cached", "SEC", "/nonexistent")).toBe("Original");
    // Modify file — cache should return original
    writeFileSync(join(resourceDir, "cached.md"), "## SEC\n\nModified\n");
    expect(loadPrompt("cached", "SEC", "/nonexistent")).toBe("Original");
  });

  it("preserves format variables", () => {
    writeFileSync(join(resourceDir, "fmt.md"), "## TPL\n\nHello {name}, you have {count} items.\n");
    const result = loadPrompt("fmt", "TPL", "/nonexistent");
    expect(result).toContain("{name}");
    expect(result).toContain("{count}");
  });
});

describe("loadTemplate", () => {
  const tmp = join(tmpdir(), `voidrift-test-templates-${Date.now()}`);
  const resourceDir = join(tmp, "resources", "templates");

  beforeEach(() => {
    clearCache();
    mkdirSync(resourceDir, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads template and strips frontmatter", () => {
    writeFileSync(join(resourceDir, "TEST-TEMPLATE.md"), "---\nname: test\n---\n\n# Template Body\n\nContent here.\n");
    const result = loadTemplate("TEST-TEMPLATE", "/nonexistent");
    expect(result).toBe("# Template Body\n\nContent here.");
    expect(result).not.toContain("---");
  });

  it("loads template without frontmatter", () => {
    writeFileSync(join(resourceDir, "PLAIN.md"), "# Plain\n\nNo frontmatter.\n");
    const result = loadTemplate("PLAIN", "/nonexistent");
    expect(result).toBe("# Plain\n\nNo frontmatter.");
  });

  it("is case-insensitive", () => {
    writeFileSync(join(resourceDir, "UPPER.md"), "body");
    expect(loadTemplate("upper", "/nonexistent")).toBe("body");
  });
});
