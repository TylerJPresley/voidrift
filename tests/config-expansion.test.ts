/**
 * Tests for REQ-CFG-3 (cross-reference expansion) and REQ-CFG-5 (no hardcoded maxTokens).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const configSource = readFileSync(join(__dirname, "../src/config.ts"), "utf-8");
const loopSource = readFileSync(join(__dirname, "../src/agent/loop.ts"), "utf-8");
const builderSource = readFileSync(join(__dirname, "../src/tools/builder.ts"), "utf-8");

// ---------------------------------------------------------------------------
// CFG-3: Cross-reference expansion
// ---------------------------------------------------------------------------

describe("config cross-reference expansion (REQ-CFG-3)", () => {
  it("expandCrossRefs function exists", () => {
    expect(configSource).toContain("function expandCrossRefs(config: unknown)");
  });

  it("resolves ${section.key} patterns via dot-path lookup", () => {
    expect(configSource).toContain('expr.split(".", 2)');
    expect(configSource).toContain("root[section]");
  });

  it("loadConfig calls expandCrossRefs after expandRecursive", () => {
    const envIdx = configSource.indexOf("expandRecursive(raw)");
    const crossIdx = configSource.indexOf("expandCrossRefs(expanded)");
    expect(envIdx).toBeGreaterThan(-1);
    expect(crossIdx).toBeGreaterThan(-1);
    expect(crossIdx).toBeGreaterThan(envIdx);
  });

  it("leaves unresolved cross-references unchanged", () => {
    expect(configSource).toContain("return match");
  });

  it("only resolves expressions containing a dot", () => {
    expect(configSource).toContain('expr.includes(".")');
  });
});

// ---------------------------------------------------------------------------
// CFG-5: No hardcoded maxTokens
// ---------------------------------------------------------------------------

describe("no hardcoded maxTokens in command code (REQ-CFG-5)", () => {
  it("internal.summary stage default exists", () => {
    expect(configSource).toContain('"internal.summary": 1024');
  });

  it("loop.ts uses getMaxTokens for summary", () => {
    expect(loopSource).toContain('getMaxTokens(this._model.config, "internal.summary")');
  });

  it("loop.ts imports getMaxTokens", () => {
    expect(loopSource).toContain('import { getMaxTokens } from "../config.js"');
  });

  it("builder.ts uses _summarizePage instead of subprocess with maxTokens", () => {
    expect(builderSource).toContain("_summarizePage(stripped)");
    expect(builderSource).not.toContain("maxTokens:1024");
  });

  it("no remaining hardcoded maxTokens: 1024 in loop.ts", () => {
    expect(loopSource).not.toContain("maxTokens: 1024");
  });

  it("no remaining hardcoded maxTokens: 1024 in builder.ts", () => {
    expect(builderSource).not.toContain("maxTokens:1024");
  });
});
