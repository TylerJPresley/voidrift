import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPrompt, loadTemplate, clearCache, resolvePrompt, buildSystemPrompt } from "../src/prompts.js";

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

describe("resolvePrompt (REQ-ARCH-18)", () => {
  it("replaces all variables from the map", () => {
    const result = resolvePrompt("Hello {name}, you have {count} items.", { name: "Alice", count: "3" });
    expect(result).toBe("Hello Alice, you have 3 items.");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = resolvePrompt("{x} and {x}", { x: "val" });
    expect(result).toBe("val and val");
  });

  it("raises on unresolved variables", () => {
    expect(() => resolvePrompt("Hello {name}, {missing_var}!", { name: "Bob" }))
      .toThrow("Unresolved template variable(s): {missing_var}");
  });

  it("raises listing all unresolved variables", () => {
    expect(() => resolvePrompt("{a} {b} {c}", {}))
      .toThrow("{a}");
  });

  it("does not flag JSON-like braces or markdown", () => {
    // {UpperCase}, {"key": ...}, {0}, {123} should NOT be flagged
    const result = resolvePrompt('Use {name} with {"key": "value"} and {Type}', { name: "test" });
    expect(result).toBe('Use test with {"key": "value"} and {Type}');
  });

  it("returns unchanged string when no variables present", () => {
    expect(resolvePrompt("No variables here.", {})).toBe("No variables here.");
  });
});

describe("buildSystemPrompt (REQ-ARCH-19)", () => {
  it("joins all 4 layers in order", () => {
    const result = buildSystemPrompt("L1-framework", "L2-skill", "L3-stage", "L4-context");
    expect(result).toBe("L1-framework\n\nL2-skill\n\nL3-stage\n\nL4-context");
  });

  it("framework context is always first", () => {
    const result = buildSystemPrompt("framework", "skill", "stage");
    expect(result.startsWith("framework")).toBe(true);
  });

  it("filters out empty/undefined layers", () => {
    const result = buildSystemPrompt("L1", undefined, "L3");
    expect(result).toBe("L1\n\nL3");
  });

  it("handles all layers empty except framework", () => {
    const result = buildSystemPrompt("L1");
    expect(result).toBe("L1");
  });

  it("accepts multiple injected context values", () => {
    const result = buildSystemPrompt("L1", undefined, "L3", "ctx-a", "ctx-b");
    expect(result).toBe("L1\n\nL3\n\nctx-a\n\nctx-b");
  });
});

describe("no hardcoded prompt strings (REQ-ARCH-18)", () => {
  it("ask.ts uses loadPrompt instead of hardcoded string", async () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/ask.ts"), "utf-8");
    expect(source).not.toContain('"Answer concisely."');
    expect(source).toContain('loadPrompt("chat", "ASK")');
  });

  it("gather.ts uses loadPrompt for chunk merge", async () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/gather.ts"), "utf-8");
    expect(source).not.toContain('"Merge these partial analyses');
    expect(source).toContain('loadPrompt("gather", "CHUNK-MERGE")');
  });

  it("builder.ts uses _summarizePage for web content extraction", async () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/tools/builder.ts"), "utf-8");
    expect(source).not.toContain('"Summarize the following web page');
    expect(source).not.toContain('"Summarize in');
    expect(source).toContain("_summarizePage(stripped)");
  });
});

describe("framework context loaded once per command (REQ-ARCH-19)", () => {
  it("gather.ts loads system CONTEXT once and passes to stages", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/gather.ts"), "utf-8");
    // L1 loaded once at command level
    expect(source).toContain('const frameworkContext = loadPrompt("system", "CONTEXT")');
    // Passed to stage functions
    expect(source).toContain("runTriage(frameworkContext,");
    expect(source).toContain("runFileAnalysis(frameworkContext,");
    expect(source).toContain("runGeneratedAnalysis(frameworkContext,");
    expect(source).toContain("runConsolidation(frameworkContext,");
  });

  it("plan.ts loads system CONTEXT once", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/plan.ts"), "utf-8");
    expect(source).toContain('const frameworkContext = loadPrompt("system", "CONTEXT")');
    expect(source).toContain("buildSystemPrompt(frameworkContext,");
  });

  it("develop.ts loads system CONTEXT once at command level", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/develop.ts"), "utf-8");
    expect(source).toContain('const frameworkContext = loadPrompt("system", "CONTEXT")');
    expect(source).toContain("buildSystemPrompt(frameworkContext,");
    // Should NOT load per-task
    expect(source).not.toContain('const systemCtx = loadPrompt("system", "CONTEXT")');
  });

  it("verify.ts loads system CONTEXT once", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/verify.ts"), "utf-8");
    expect(source).toContain('const frameworkContext = loadPrompt("system", "CONTEXT")');
    expect(source).toContain("buildSystemPrompt(frameworkContext,");
    // Should NOT have inline loadPrompt("system", "CONTEXT") in prompt construction
    expect(source).not.toContain('[loadPrompt("system", "CONTEXT")');
  });

  it("deploy.ts loads system CONTEXT once", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/commands/deploy.ts"), "utf-8");
    expect(source).toContain('const frameworkContext = loadPrompt("system", "CONTEXT")');
    expect(source).toContain("buildSystemPrompt(frameworkContext,");
  });
});
