/**
 * Unit tests for `isEntrypoint` (cli-blueprint.md §2).
 *
 * Covers the real install shapes the string compare got wrong: an npm bin
 * SYMLINK (argv1 is the symlink, metaUrl is the realpath) and paths containing a
 * space / `#` / `%` (fileURLToPath decodes, realpath normalises). Uses the real
 * filesystem under one fixed temp root so symlink + realpath behave as in
 * production; the root is removed after each test.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEntrypoint } from "./entrypoint.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "vr-entry-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create a file and return its realpath. */
function file(name: string): string {
  const p = path.join(root, name);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "export {};\n");
  return p;
}

describe("isEntrypoint", () => {
  it("true when argv1 is identical to the module path", () => {
    const real = file("dist/cli.js");
    expect(isEntrypoint(real, pathToFileURL(real).href)).toBe(true);
  });

  it("true when argv1 is a symlink pointing at the module (the npm bin case)", () => {
    const real = file("dist/cli.js");
    const link = path.join(root, "node_modules", ".bin", "voidrift");
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(real, link);
    // argv1 = the symlink; metaUrl = the realpath — the string compare failed here.
    expect(isEntrypoint(link, pathToFileURL(real).href)).toBe(true);
  });

  it("true for a path containing a space and `#`/`%` (URL-encoding safe)", () => {
    const real = file("a dir #1 %x/cli.js");
    // pathToFileURL percent-encodes the space/# /% ; the module runs from argv1 directly.
    expect(isEntrypoint(real, pathToFileURL(real).href)).toBe(true);
  });

  it("true for a symlink whose own path contains a space", () => {
    const real = file("dist/cli.js");
    const link = path.join(root, "a link dir", "voidrift bin");
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(real, link);
    expect(isEntrypoint(link, pathToFileURL(real).href)).toBe(true);
  });

  it("false when argv1 is a different file", () => {
    const real = file("dist/cli.js");
    const other = file("dist/other.js");
    expect(isEntrypoint(other, pathToFileURL(real).href)).toBe(false);
  });

  it("false when argv1 is undefined (imported, not run)", () => {
    const real = file("dist/cli.js");
    expect(isEntrypoint(undefined, pathToFileURL(real).href)).toBe(false);
  });

  it("false when argv1 does not exist on disk", () => {
    const real = file("dist/cli.js");
    expect(isEntrypoint(path.join(root, "missing.js"), pathToFileURL(real).href)).toBe(false);
  });
});
