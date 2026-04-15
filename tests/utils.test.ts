import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureVoidriftDir, bootRun, appendState, checkRequirementsExist,
  checkDiskSpace, getStateManifest, undoCommand,
} from "../src/utils.js";

describe("ensureVoidriftDir", () => {
  const tmp = join(tmpdir(), `voidrift-test-utils-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates .voidrift/ directory", () => {
    const d = ensureVoidriftDir();
    expect(existsSync(d)).toBe(true);
    expect(d).toBe(join(tmp, ".voidrift"));
  });

  it("is idempotent", () => {
    ensureVoidriftDir();
    ensureVoidriftDir();
    expect(existsSync(join(tmp, ".voidrift"))).toBe(true);
  });
});

describe("bootRun", () => {
  const tmp = join(tmpdir(), `voidrift-test-boot-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates log file and returns path + runId", () => {
    const [logPath, runId] = bootRun("gather");
    expect(existsSync(logPath)).toBe(true);
    expect(runId).toMatch(/^gather-\d{8}-\d{6}$/);
    expect(logPath).toContain(runId);
  });

  it("log path is under .voidrift/logs/", () => {
    const [logPath] = bootRun("plan");
    expect(logPath).toContain(join(".voidrift", "logs"));
    expect(logPath).toContain("plan-");
    expect(logPath).toMatch(/\.log$/);
  });
});

describe("appendState", () => {
  const tmp = join(tmpdir(), `voidrift-test-state-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("appends entry to STATE.md", () => {
    appendState("gather", "qwen35", "Analyzed 20 files.", [".voidrift/REQUIREMENTS.md"]);
    const content = readFileSync(join(tmp, ".voidrift", "STATE.md"), "utf-8");
    expect(content).toContain("gather (qwen35)");
    expect(content).toContain("Analyzed 20 files.");
    expect(content).toContain("created: .voidrift/REQUIREMENTS.md");
  });

  it("appends multiple entries", () => {
    appendState("gather", "m1", "First run.");
    appendState("plan", "m2", "Second run.");
    const content = readFileSync(join(tmp, ".voidrift", "STATE.md"), "utf-8");
    expect(content).toContain("gather (m1)");
    expect(content).toContain("plan (m2)");
  });
});

describe("checkRequirementsExist", () => {
  const tmp = join(tmpdir(), `voidrift-test-reqs-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns false when REQUIREMENTS.md missing", () => {
    expect(checkRequirementsExist()).toBe(false);
  });

  it("returns true when REQUIREMENTS.md exists", () => {
    writeFileSync(join(tmp, ".voidrift", "REQUIREMENTS.md"), "# Reqs\n");
    expect(checkRequirementsExist()).toBe(true);
  });
});

describe("checkDiskSpace", () => {
  const tmp = join(tmpdir(), `voidrift-test-disk-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("does not throw regardless of disk space", () => {
    expect(() => checkDiskSpace()).not.toThrow();
  });
});

describe("getStateManifest", () => {
  const tmp = join(tmpdir(), `voidrift-test-manifest-state-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns empty when no STATE.md", () => {
    expect(getStateManifest("gather")).toEqual([]);
  });

  it("parses created files from last matching command entry", () => {
    const state = [
      "## 2026-04-15T10:00:00 — gather (qwen35)",
      "Analyzed 10 files.",
      "",
      "### Files",
      "- created: .voidrift/REQUIREMENTS.md",
      "- created: .voidrift/ANALYSIS.md",
      "",
    ].join("\n");
    writeFileSync(join(tmp, ".voidrift", "STATE.md"), state);
    const files = getStateManifest("gather");
    expect(files).toEqual([".voidrift/REQUIREMENTS.md", ".voidrift/ANALYSIS.md"]);
  });

  it("returns files from last entry when multiple entries exist", () => {
    const state = [
      "## 2026-04-15T10:00:00 — gather (m1)",
      "First run.",
      "",
      "### Files",
      "- created: .voidrift/OLD.md",
      "",
      "## 2026-04-15T11:00:00 — gather (m2)",
      "Second run.",
      "",
      "### Files",
      "- created: .voidrift/NEW.md",
      "",
    ].join("\n");
    writeFileSync(join(tmp, ".voidrift", "STATE.md"), state);
    const files = getStateManifest("gather");
    expect(files).toEqual([".voidrift/NEW.md"]);
  });

  it("returns empty for non-matching command", () => {
    const state = [
      "## 2026-04-15T10:00:00 — gather (qwen35)",
      "Analyzed.",
      "",
      "### Files",
      "- created: .voidrift/REQUIREMENTS.md",
      "",
    ].join("\n");
    writeFileSync(join(tmp, ".voidrift", "STATE.md"), state);
    expect(getStateManifest("plan")).toEqual([]);
  });
});

describe("undoCommand", () => {
  const tmp = join(tmpdir(), `voidrift-test-undo-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("deletes files listed in STATE.md for the command", () => {
    const filePath = join(tmp, ".voidrift", "REQUIREMENTS.md");
    writeFileSync(filePath, "# Reqs\n");
    const state = [
      "## 2026-04-15T10:00:00 — gather (qwen35)",
      "Run.",
      "",
      "### Files",
      `- created: ${filePath}`,
      "",
    ].join("\n");
    writeFileSync(join(tmp, ".voidrift", "STATE.md"), state);
    const deleted = undoCommand("gather");
    expect(deleted).toContain(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns empty when no files to undo", () => {
    expect(undoCommand("gather")).toEqual([]);
  });

  it("handles already-deleted files gracefully", () => {
    const state = [
      "## 2026-04-15T10:00:00 — gather (qwen35)",
      "Run.",
      "",
      "### Files",
      "- created: /tmp/nonexistent-file-xyz.md",
      "",
    ].join("\n");
    writeFileSync(join(tmp, ".voidrift", "STATE.md"), state);
    expect(() => undoCommand("gather")).not.toThrow();
  });
});
