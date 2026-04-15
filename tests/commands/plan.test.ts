import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractModules, archSummary, parseOutlineTasks, formatTaskEntry,
  buildTaskFiles, checkReqCoverage, resolveSkill,
} from "../../src/commands/plan.js";

describe("extractModules", () => {
  const tmp = join(tmpdir(), `voidrift-test-modules-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("extracts from YAML frontmatter", () => {
    const arch = "---\nmodules:\n  - backend\n  - frontend\n---\n\n# Architecture";
    expect(extractModules(arch, tmp)).toEqual(["backend", "frontend"]);
  });

  it("falls back to arch/ directory", () => {
    mkdirSync(join(tmp, "arch"), { recursive: true });
    writeFileSync(join(tmp, "arch", "api.md"), "x");
    writeFileSync(join(tmp, "arch", "web.md"), "y");
    expect(extractModules("no frontmatter", tmp)).toEqual(["api", "web"]);
  });

  it("returns empty when no modules found", () => {
    expect(extractModules("no frontmatter", tmp)).toEqual([]);
  });
});

describe("archSummary", () => {
  it("returns full text when short", () => {
    expect(archSummary("short")).toBe("short");
  });

  it("truncates long text", () => {
    const long = "x".repeat(5000);
    const result = archSummary(long, 4000);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain("[truncated]");
  });
});

describe("parseOutlineTasks", () => {
  const tmp = join(tmpdir(), `voidrift-test-outline-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("parses YAML frontmatter tasks", () => {
    const content = `---\nmodule: backend\ntasks:\n  - id: 1\n    title: Create API\n    files:\n      - src/api.py\n    depends: []\n  - id: 2\n    title: Add auth\n    files:\n      - src/auth.py\n    depends: [1]\n---\n\n## Task 1\nDescription.`;
    writeFileSync(join(tmp, "outline.md"), content);
    const [mod, tasks] = parseOutlineTasks(join(tmp, "outline.md"));
    expect(mod).toBe("backend");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe(1);
    expect(tasks[0].title).toBe("Create API");
    expect(tasks[1].depends).toEqual([1]);
  });

  it("returns empty for missing file", () => {
    const [mod, tasks] = parseOutlineTasks(join(tmp, "nope.md"));
    expect(mod).toBe("");
    expect(tasks).toHaveLength(0);
  });
});

describe("resolveSkill", () => {
  const valid = { "BACKEND-ENG": "Backend engineering", "WEB-ENG": "Web engineering", "QUALITY-QA": "QA" };

  it("returns exact match", () => {
    expect(resolveSkill(["BACKEND-ENG"], valid)).toEqual(["BACKEND-ENG"]);
  });

  it("resolves by word overlap (REQ-P-9)", () => {
    expect(resolveSkill(["BACKEND-ENGINEERING"], valid)).toEqual(["BACKEND-ENG"]);
  });

  it("strips unresolvable skills", () => {
    expect(resolveSkill(["UNKNOWN-SKILL"], valid)).toEqual([]);
  });

  it("handles mixed valid and invalid", () => {
    expect(resolveSkill(["WEB-ENG", "BOGUS"], valid)).toEqual(["WEB-ENG"]);
  });
});

describe("buildTaskFiles", () => {
  const tmp = join(tmpdir(), `voidrift-test-tasks-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(join(tmp, "tasks", "active"), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("builds manifest from task files", () => {
    writeFileSync(join(tmp, "tasks", "active", "TASK-1.md"), "---\nid: 1\nmodule: backend\nskills: [BACKEND-ENG]\ndepends: []\nreqs: [REQ-API-1]\n---\n\n# Task 1");
    writeFileSync(join(tmp, "tasks", "active", "TASK-2.md"), "---\nid: 2\nmodule: backend\nskills: []\ndepends: [1]\nreqs: []\n---\n\n# Task 2");
    const count = buildTaskFiles(tmp, "# Reqs", "# Arch");
    expect(count).toBe(2);
    expect(existsSync(join(tmp, "tasks", "manifest.yml"))).toBe(true);
    const manifest = readFileSync(join(tmp, "tasks", "manifest.yml"), "utf-8");
    expect(manifest).toContain("planned");
  });
});

describe("checkReqCoverage", () => {
  const tmp = join(tmpdir(), `voidrift-test-coverage-${Date.now()}`);

  beforeEach(() => mkdirSync(join(tmp, "tasks", "active"), { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("warns on uncovered requirements", () => {
    writeFileSync(join(tmp, "tasks", "active", "TASK-1.md"), "reqs: [REQ-API-1]");
    const stderr: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((s: string) => { stderr.push(s); return true; }) as typeof process.stderr.write;
    checkReqCoverage(tmp, "REQ-API-1 and REQ-AUTH-1 are required");
    process.stderr.write = orig;
    expect(stderr.some(s => s.includes("REQ-AUTH-1"))).toBe(true);
  });
});
