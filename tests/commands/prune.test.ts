/**
 * Tests for REQ-UTIL-5: voidrift prune — remove ephemeral data.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pruneSource = readFileSync(join(__dirname, "../../src/commands/prune.ts"), "utf-8");
const indexSource = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Project log backup pruning (AC1)
// ---------------------------------------------------------------------------

describe("project log backup pruning (REQ-UTIL-5 AC1)", () => {
  it("prunes log backups beyond retention count", () => {
    expect(pruneSource).toContain("pruneLogBackups(logPath, retention)");
  });

  it("uses getRetention for project scope", () => {
    expect(pruneSource).toContain('getRetention("project")');
  });
});

// ---------------------------------------------------------------------------
// --all removes .voidrift/ (AC2)
// ---------------------------------------------------------------------------

describe("--all removes .voidrift/ (REQ-UTIL-5 AC2)", () => {
  it("removes entire .voidrift directory with rmSync", () => {
    expect(pruneSource).toContain("rmSync(d, { recursive: true })");
  });

  it("checks opts.all flag", () => {
    expect(pruneSource).toContain("opts.all");
  });
});

// ---------------------------------------------------------------------------
// Stale analysis cache (AC3)
// ---------------------------------------------------------------------------

describe("stale analysis cache pruning (REQ-UTIL-5 AC3)", () => {
  it("checks if source file exists for each cache entry", () => {
    expect(pruneSource).toContain("existsSync(sourcePath)");
  });

  it("removes cache entry when source is deleted", () => {
    expect(pruneSource).toContain("unlinkSync(cachePath)");
  });
});

// ---------------------------------------------------------------------------
// TTL-expired analysis cache (AC4)
// ---------------------------------------------------------------------------

describe("TTL-expired cache pruning (REQ-UTIL-5 AC4)", () => {
  it("checks mtime against TTL", () => {
    expect(pruneSource).toContain("now - mtime > ttlMs");
  });

  it("uses configured ttlDays", () => {
    expect(pruneSource).toContain("ttlDays");
    expect(pruneSource).toContain("86_400_000");
  });
});

// ---------------------------------------------------------------------------
// --global (AC5/AC6)
// ---------------------------------------------------------------------------

describe("--global pruning (REQ-UTIL-5)", () => {
  it("targets global log directory", () => {
    expect(pruneSource).toContain('join(homedir(), ".voidrift", "logs")');
  });

  it("uses getRetention for global scope", () => {
    expect(pruneSource).toContain('getRetention("global")');
  });

  it("--global --all removes all files in global log dir", () => {
    expect(pruneSource).toContain("All global logs removed");
  });
});

// ---------------------------------------------------------------------------
// No .voidrift/ error (AC7)
// ---------------------------------------------------------------------------

describe("no .voidrift/ error (REQ-UTIL-5)", () => {
  it("shows friendly error when no .voidrift and not --global", () => {
    expect(pruneSource).toContain("No .voidrift/ directory");
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

describe("prune wired in index.ts (REQ-UTIL-5)", () => {
  it("handles prune command", () => {
    expect(indexSource).toContain('command === "prune"');
    expect(indexSource).toContain("./commands/prune.js");
  });

  it("passes all and global flags", () => {
    expect(indexSource).toContain('all: hasFlag("all")');
    expect(indexSource).toContain('global: hasFlag("global")');
  });

  it("appears in help text", () => {
    expect(indexSource).toContain("prune");
  });
});
