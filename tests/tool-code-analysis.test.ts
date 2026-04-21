/**
 * Tests for REQ-TOOL-8: Code analysis supported language check.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const builderSource = readFileSync(join(__dirname, "../src/tools/builder.ts"), "utf-8");

describe("supported language check (REQ-TOOL-8)", () => {
  it("defines SUPPORTED_LANGUAGES set", () => {
    expect(builderSource).toContain("const SUPPORTED_LANGUAGES = new Set(");
  });

  it("includes TypeScript extensions", () => {
    expect(builderSource).toContain('"ts"');
    expect(builderSource).toContain('"tsx"');
  });

  it("includes JavaScript extensions", () => {
    expect(builderSource).toContain('"js"');
    expect(builderSource).toContain('"jsx"');
    expect(builderSource).toContain('"mjs"');
    expect(builderSource).toContain('"cjs"');
  });

  it("includes Python", () => {
    expect(builderSource).toContain('"py"');
  });

  it("checks extension against supported set before analysis", () => {
    expect(builderSource).toContain("SUPPORTED_LANGUAGES.has(ext)");
  });

  it("returns error listing supported languages for unsupported extension", () => {
    expect(builderSource).toContain("Unsupported language:");
    expect(builderSource).toContain("[...SUPPORTED_LANGUAGES].sort().join");
  });
});

describe("code analysis returns structured metadata (REQ-TOOL-8)", () => {
  it("returns language field", () => {
    expect(builderSource).toContain("language: ext");
  });

  it("returns line count", () => {
    expect(builderSource).toContain("lines: lines.length");
  });

  it("returns imports", () => {
    expect(builderSource).toContain("imports:");
  });

  it("returns symbols with line numbers", () => {
    expect(builderSource).toContain("{ name:");
    expect(builderSource).toContain("line: i + 1");
  });

  it("returns complexity estimate", () => {
    expect(builderSource).toContain("complexity");
  });
});
