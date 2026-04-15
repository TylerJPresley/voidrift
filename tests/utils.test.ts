import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureVoidriftDir, bootRun, appendState, checkRequirementsExist, voidriftDir } from "../src/utils.js";

describe("ensureVoidriftDir", () => {
  const tmp = join(tmpdir(), `voidrift-test-utils-${Date.now()}`);

  beforeEach(() => {
    require("node:fs").mkdirSync(tmp, { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

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
    require("node:fs").mkdirSync(tmp, { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates log file and returns path + runId", () => {
    const [logPath, runId] = bootRun("gather");
    expect(existsSync(logPath)).toBe(true);
    expect(runId).toMatch(/^gather-\d{8}-\d{6}$/);
    expect(logPath).toContain(runId);
  });
});

describe("appendState", () => {
  const tmp = join(tmpdir(), `voidrift-test-state-${Date.now()}`);

  beforeEach(() => {
    require("node:fs").mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

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
    require("node:fs").mkdirSync(join(tmp, ".voidrift"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns false when REQUIREMENTS.md missing", () => {
    expect(checkRequirementsExist()).toBe(false);
  });

  it("returns true when REQUIREMENTS.md exists", () => {
    require("node:fs").writeFileSync(join(tmp, ".voidrift", "REQUIREMENTS.md"), "# Reqs\n");
    expect(checkRequirementsExist()).toBe(true);
  });
});
