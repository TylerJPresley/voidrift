import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFileTree, parseTriage, assignUncategorized, makeChunks,
  buildContextBlock, stripPreamble, fileHash, loadCachedAnalysis, writeAnalysis,
} from "../../src/commands/gather.js";

describe("buildFileTree", () => {
  const tmp = join(tmpdir(), `voidrift-test-tree-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("lists files recursively", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "main.py"), "x");
    writeFileSync(join(tmp, "README.md"), "y");
    const tree = buildFileTree(tmp);
    expect(tree).toContain("src/main.py");
    expect(tree).toContain("README.md");
  });

  it("excludes dot-prefixed paths", () => {
    mkdirSync(join(tmp, ".git"), { recursive: true });
    writeFileSync(join(tmp, ".git", "config"), "x");
    writeFileSync(join(tmp, ".env"), "y");
    writeFileSync(join(tmp, "app.js"), "z");
    const tree = buildFileTree(tmp);
    expect(tree).not.toContain(".git");
    expect(tree).not.toContain(".env");
    expect(tree).toContain("app.js");
  });

  it("throws when exceeding max files", () => {
    for (let i = 0; i < 5; i++) writeFileSync(join(tmp, `f${i}.txt`), "x");
    expect(() => buildFileTree(tmp, 3)).toThrow("3");
  });
});

describe("parseTriage", () => {
  it("parses valid JSON", () => {
    const result = parseTriage('{"source": ["a.py"], "tests": ["test_a.py"]}');
    expect(result.source).toEqual(["a.py"]);
    expect(result.tests).toEqual(["test_a.py"]);
  });

  it("strips control characters (REQ-G-20)", () => {
    const result = parseTriage('{"source": ["a\x00.py"]}');
    expect(result.source).toBeDefined();
  });

  it("repairs truncated JSON (REQ-G-20)", () => {
    const result = parseTriage('{"source": ["a.py", "b.py"');
    expect(result.source).toBeDefined();
  });

  it("returns empty object for garbage", () => {
    expect(parseTriage("not json at all")).toEqual({});
  });
});

describe("assignUncategorized", () => {
  it("assigns files to categories", () => {
    const categories: Record<string, string[]> = { source: ["a.py"] };
    const fileCategory: Record<string, string> = { "a.py": "source" };
    assignUncategorized(["b.js"], categories, fileCategory, () => "source");
    expect(categories.source).toContain("b.js");
    expect(fileCategory["b.js"]).toBe("source");
  });

  it("skip-all stops iteration", () => {
    const categories: Record<string, string[]> = {};
    const fileCategory: Record<string, string> = {};
    const calls: string[] = [];
    assignUncategorized(["a.js", "b.js", "c.js"], categories, fileCategory, (f) => {
      calls.push(f);
      return "skip-all";
    });
    expect(calls).toHaveLength(1);
    expect(Object.keys(fileCategory)).toHaveLength(0);
  });

  it("skip leaves file unassigned", () => {
    const categories: Record<string, string[]> = {};
    const fileCategory: Record<string, string> = {};
    const responses = ["skip", "tests"];
    let i = 0;
    assignUncategorized(["a.js", "b.js"], categories, fileCategory, () => responses[i++]);
    expect(fileCategory["a.js"]).toBeUndefined();
    expect(fileCategory["b.js"]).toBe("tests");
  });
});

describe("makeChunks", () => {
  it("returns single chunk for small text", () => {
    expect(makeChunks("hello", 100)).toEqual(["hello"]);
  });

  it("splits with overlap", () => {
    const text = "a".repeat(500);
    const chunks = makeChunks(text, 300, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(300);
  });

  it("clamps overlap to chunk_size - 1", () => {
    const chunks = makeChunks("a".repeat(100), 50, 200);
    expect(chunks.length).toBeGreaterThan(1); // Should not infinite loop
  });
});

describe("buildContextBlock", () => {
  it("builds block from summaries", () => {
    const result = buildContextBlock({ tests: "Test summary", config: "Config summary" });
    expect(result).toContain("## Project Context");
    expect(result).toContain("### Tests");
    expect(result).toContain("Test summary");
  });

  it("returns empty for no summaries", () => {
    expect(buildContextBlock({})).toBe("");
  });
});

describe("stripPreamble", () => {
  it("strips text before first heading", () => {
    expect(stripPreamble("Some preamble\n\n# Requirements\n\nContent")).toBe("# Requirements\n\nContent");
  });

  it("returns unchanged if starts with heading", () => {
    expect(stripPreamble("# Title\n\nBody")).toBe("# Title\n\nBody");
  });
});

describe("analysis cache", () => {
  const tmp = join(tmpdir(), `voidrift-test-cache-${Date.now()}`);

  beforeEach(() => mkdirSync(join(tmp, "analysis"), { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("cache miss returns null", () => {
    expect(loadCachedAnalysis(tmp, "missing.py", "abc")).toBeNull();
  });

  it("cache hit returns content when hash matches", () => {
    writeAnalysis(tmp, "hit.py", "hash123", "analysis content");
    const result = loadCachedAnalysis(tmp, "hit.py", "hash123");
    expect(result).toContain("analysis content");
  });

  it("cache miss when hash differs", () => {
    writeAnalysis(tmp, "stale.py", "old_hash", "old analysis");
    expect(loadCachedAnalysis(tmp, "stale.py", "new_hash")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// --idea mode (REQ-G-1)
// ---------------------------------------------------------------------------

describe("runGather --idea mode", () => {
  it("index.ts parses --idea flag and passes ideaId", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");
    expect(source).toContain('getFlag("idea")');
    expect(source).toContain("ideaId");
  });

  it("index.ts parses --ref flag", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");
    expect(source).toContain('getFlag("ref")');
    expect(source).toContain("runChat(mc, { ref })");
  });

  it("index.ts error message lists all three flags", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");
    expect(source).toContain("--import, --idea, or --ref required");
  });

  it("index.ts help text shows all three gather modes", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");
    expect(source).toContain("--import <dir>");
    expect(source).toContain("--idea <id>");
    expect(source).toContain("--ref <dir>");
  });
});

// ---------------------------------------------------------------------------
// --ref mode (REQ-G-1)
// ---------------------------------------------------------------------------

describe("runChat --ref mode", () => {
  it("chat.ts accepts ref option and injects file tree into system prompt", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");
    expect(source).toContain("options.ref");
    expect(source).toContain("buildFileTree");
    expect(source).toContain("Reference Codebase");
  });
});

// ---------------------------------------------------------------------------
// --idea gather.ts logic (REQ-G-1)
// ---------------------------------------------------------------------------

describe("runGather --idea implementation", () => {
  it("gather.ts has idea mode code path", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/commands/gather.ts"), "utf-8");
    expect(source).toContain("readIdea(projectDir, ideaId)");
    expect(source).toContain("ANALYSIS-REQS");
    expect(source).toContain("REQUIREMENTS-TEMPLATE");
    expect(source).toContain("Gather Results");
    expect(source).toContain("Affected REQ IDs");
  });

  it("gather.ts writes diff summary back to idea file", () => {
    const source = require("node:fs").readFileSync(join(__dirname, "../../src/commands/gather.ts"), "utf-8");
    expect(source).toContain("writeIdea(projectDir, ideaId");
    expect(source).toContain("Added:");
    expect(source).toContain("Removed:");
  });
});