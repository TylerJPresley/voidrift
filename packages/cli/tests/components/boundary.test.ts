import { describe, it, expect } from "vitest";
import { findSafeSplitPoint, hasUnclosedFormatting } from "../../src/components/boundary.ts";

describe("hasUnclosedFormatting", () => {
  it("returns false for plain text", () => {
    expect(hasUnclosedFormatting("hello world")).toBe(false);
  });

  it("returns true for unclosed code fence", () => {
    expect(hasUnclosedFormatting("```\nsome code")).toBe(true);
  });

  it("returns false for closed code fence", () => {
    expect(hasUnclosedFormatting("```\ncode\n```")).toBe(false);
  });

  it("returns true for unclosed bold", () => {
    expect(hasUnclosedFormatting("some **bold")).toBe(true);
  });

  it("returns false for closed bold", () => {
    expect(hasUnclosedFormatting("some **bold** text")).toBe(false);
  });
});

describe("findSafeSplitPoint", () => {
  it("returns -1 for single line", () => {
    expect(findSafeSplitPoint("hello")).toBe(-1);
  });

  it("splits at blank line boundary", () => {
    const text = "paragraph one\n\nparagraph two";
    const idx = findSafeSplitPoint(text);
    expect(idx).toBeGreaterThan(0);
    expect(text.slice(0, idx).trim()).toBe("paragraph one");
  });

  it("does not split inside code fence", () => {
    const text = "```\nline 1\nline 2\n```\n\nafter";
    const idx = findSafeSplitPoint(text);
    // Should split after the code fence closes, not inside it
    expect(text.slice(0, idx)).toContain("```\nline 1\nline 2\n```");
  });
});
