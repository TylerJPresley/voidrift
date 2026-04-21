/**
 * Tests for REQ-TOOL-4: Operator confirmation before HTTP fetch and summarization.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const builderSource = readFileSync(join(__dirname, "../src/tools/builder.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Operator confirmation (AC1)
// ---------------------------------------------------------------------------

describe("operator confirmation before fetch (REQ-TOOL-4 AC1)", () => {
  it("_chatHttpGet accepts askFn parameter", () => {
    expect(builderSource).toContain("askFn?: (question: string, options?: string[]) => string");
  });

  it("calls askFn with Allow/Deny options before fetch", () => {
    expect(builderSource).toContain('askFn(`Fetch ${url}?`, ["Allow", "Deny"])');
  });

  it("returns error when operator denies", () => {
    expect(builderSource).toContain("Fetch denied by operator");
  });

  it("passes askFn from opts to _chatHttpGet", () => {
    expect(builderSource).toContain("opts?.askFn)");
  });
});

// ---------------------------------------------------------------------------
// Summarization (AC2)
// ---------------------------------------------------------------------------

describe("summarization instead of raw content (REQ-TOOL-4 AC2)", () => {
  it("uses _summarizePage for content extraction", () => {
    expect(builderSource).toContain("_summarizePage(stripped)");
  });

  it("_summarizePage extracts title from first line", () => {
    expect(builderSource).toContain("**${lines[0]}**");
  });

  it("limits body to 2000 chars", () => {
    expect(builderSource).toContain(".slice(0, 2000)");
  });

  it("indicates when content was summarized", () => {
    expect(builderSource).toContain("Summarized from");
  });

  it("does not use subprocess for summarization", () => {
    // The old broken subprocess approach should be gone
    expect(builderSource).not.toContain("a.send(process.argv[1])");
  });
});

// ---------------------------------------------------------------------------
// Cache (AC3)
// ---------------------------------------------------------------------------

describe("cache skips re-prompt (REQ-TOOL-4 AC3)", () => {
  it("cache check is before confirmation prompt", () => {
    const cacheIdx = builderSource.indexOf("cache.has(url)");
    const askIdx = builderSource.indexOf("askFn(`Fetch");
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeGreaterThan(cacheIdx);
  });

  it("cache hit returns immediately", () => {
    expect(builderSource).toContain("if (cache.has(url)) return cache.get(url)!");
  });
});

// ---------------------------------------------------------------------------
// Error handling (AC4)
// ---------------------------------------------------------------------------

describe("fetch failure returns error (REQ-TOOL-4 AC4)", () => {
  it("catch block returns error description", () => {
    expect(builderSource).toContain("Fetch failed for ${url}");
  });
});
