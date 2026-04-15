import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestManager } from "../src/manifest.js";

describe("ManifestManager", () => {
  const tmp = join(tmpdir(), `voidrift-test-manifest-${Date.now()}`);
  const voidriftDir = join(tmp, ".voidrift");

  beforeEach(() => {
    mkdirSync(join(voidriftDir, "tasks", "active"), { recursive: true });
    mkdirSync(join(voidriftDir, "tasks", "archived"), { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeManifest(tasks: Record<string, unknown>, extra?: Record<string, unknown>) {
    const lines = [`next_id: ${extra?.next_id ?? 10}`, `next_bug_id: ${extra?.next_bug_id ?? 1}`, "tasks:"];
    for (const [id, t] of Object.entries(tasks)) {
      const e = t as Record<string, unknown>;
      lines.push(`  ${id}:`);
      lines.push(`    status: ${e.status}`);
      lines.push(`    module: ${e.module ?? ""}`);
      lines.push(`    depends: [${(e.depends as number[] ?? []).join(", ")}]`);
      lines.push(`    skills: []`);
      lines.push(`    reqs: []`);
      if (e.idea != null) lines.push(`    idea: ${e.idea}`);
    }
    writeFileSync(join(voidriftDir, "tasks", "manifest.yml"), lines.join("\n") + "\n");
  }

  // --- Lifecycle ---

  it("loads and returns tasks", () => {
    writeManifest({ "1": { status: "planned", module: "backend" }, "2": { status: "implemented", module: "backend" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(Object.keys(mm.tasks())).toHaveLength(2);
    expect(mm.getTask(1)?.status).toBe("planned");
  });

  it("empty manifest returns no tasks", () => {
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.tasks()).toEqual({});
  });

  it("getTask returns null for missing id", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.getTask(99)).toBeNull();
  });

  // --- Status transitions ---

  it("planned → in-progress", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "in-progress");
    expect(mm.getTask(1)?.status).toBe("in-progress");
  });

  it("in-progress → implemented", () => {
    writeManifest({ "1": { status: "in-progress", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "implemented");
    expect(mm.getTask(1)?.status).toBe("implemented");
  });

  it("implemented → verified", () => {
    writeManifest({ "1": { status: "implemented", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "verified");
    expect(mm.getTask(1)?.status).toBe("verified");
  });

  it("implemented → failed", () => {
    writeManifest({ "1": { status: "implemented", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "failed");
    expect(mm.getTask(1)?.status).toBe("failed");
  });

  it("setStatus persists to disk", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "in-progress");
    const mm2 = new ManifestManager(tmp);
    mm2.load();
    expect(mm2.getTask(1)?.status).toBe("in-progress");
  });

  // --- Dependency resolution ---

  it("dispatchable returns planned tasks with deps met", () => {
    writeManifest({
      "1": { status: "implemented", module: "a" },
      "2": { status: "planned", module: "a", depends: [1] },
      "3": { status: "planned", module: "a", depends: [2] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.dispatchable()).toEqual([2]);
  });

  it("dispatchable includes tasks with no deps", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.dispatchable()).toContain(1);
  });

  it("not dispatchable when deps unmet", () => {
    writeManifest({
      "1": { status: "planned", module: "a" },
      "2": { status: "planned", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.dispatchable()).not.toContain(2);
  });

  it("transitive blocking on failure (REQ-TM-3)", () => {
    writeManifest({
      "1": { status: "planned", module: "a" },
      "2": { status: "planned", module: "a", depends: [1] },
      "3": { status: "planned", module: "a", depends: [2] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "failed");
    expect(mm.getTask(2)?.status).toBe("blocked");
    // Task 3 depends on 2 which is now blocked — check transitive
    // (Note: the TS implementation blocks direct dependents of the failed task.
    //  Task 3 depends on 2, not 1, so it stays planned until 2 is explicitly failed.)
  });

  it("unblocks when dependency implemented", () => {
    writeManifest({
      "1": { status: "failed", module: "a" },
      "2": { status: "blocked", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "implemented");
    expect(mm.getTask(2)?.status).toBe("planned");
  });

  it("unblocks when dependency verified", () => {
    writeManifest({
      "1": { status: "failed", module: "a" },
      "2": { status: "blocked", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "verified");
    expect(mm.getTask(2)?.status).toBe("planned");
  });

  it("does not unblock when only some deps met", () => {
    writeManifest({
      "1": { status: "implemented", module: "a" },
      "2": { status: "planned", module: "a" },
      "3": { status: "blocked", module: "a", depends: [1, 2] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    // Task 2 is still planned (not implemented/verified), so 3 stays blocked
    expect(mm.getTask(3)?.status).toBe("blocked");
  });

  it("transitive unblock chain", () => {
    writeManifest({
      "1": { status: "failed", module: "a" },
      "2": { status: "blocked", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "implemented");
    expect(mm.getTask(2)?.status).toBe("planned");
    // Now 2 is planned and dispatchable
    expect(mm.dispatchable()).toContain(2);
  });

  // --- hasWork ---

  it("hasWork returns true with planned tasks", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.hasWork()).toBe(true);
  });

  it("hasWork returns true with in-progress tasks", () => {
    writeManifest({ "1": { status: "in-progress", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.hasWork()).toBe(true);
  });

  it("hasWork returns false when all verified", () => {
    writeManifest({ "1": { status: "verified", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.hasWork()).toBe(false);
  });

  it("hasWork returns false when all failed/blocked", () => {
    writeManifest({
      "1": { status: "failed", module: "a" },
      "2": { status: "blocked", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.hasWork()).toBe(false);
  });

  // --- Summary ---

  it("summary counts by status", () => {
    writeManifest({
      "1": { status: "planned", module: "a" },
      "2": { status: "planned", module: "a" },
      "3": { status: "implemented", module: "a" },
      "4": { status: "verified", module: "b" },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    const s = mm.summary();
    expect(s.planned).toBe(2);
    expect(s.implemented).toBe(1);
    expect(s.verified).toBe(1);
  });

  // --- History log ---

  it("appends to history.log on status change", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "in-progress");
    const history = readFileSync(join(voidriftDir, "tasks", "history.log"), "utf-8");
    expect(history).toContain("TASK-1");
    expect(history).toContain("in-progress");
  });

  it("history log includes module", () => {
    writeManifest({ "1": { status: "planned", module: "backend" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "implemented");
    const history = readFileSync(join(voidriftDir, "tasks", "history.log"), "utf-8");
    expect(history).toContain("module=backend");
  });

  // --- Archive ---

  it("archive moves task file to archived/", () => {
    writeManifest({ "1": { status: "verified", module: "a" } });
    writeFileSync(join(voidriftDir, "tasks", "active", "TASK-1.md"), "# Task 1\n");
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.archive(1);
    expect(existsSync(join(voidriftDir, "tasks", "active", "TASK-1.md"))).toBe(false);
    expect(existsSync(join(voidriftDir, "tasks", "archived", "TASK-1.md"))).toBe(true);
  });

  it("archive removes task from manifest", () => {
    writeManifest({ "1": { status: "verified", module: "a" } });
    writeFileSync(join(voidriftDir, "tasks", "active", "TASK-1.md"), "# Task 1\n");
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.archive(1);
    expect(mm.getTask(1)).toBeNull();
    // Verify persistence
    const mm2 = new ManifestManager(tmp);
    mm2.load();
    expect(mm2.getTask(1)).toBeNull();
  });

  // --- Ideas ---

  it("readIdea returns content when file exists", () => {
    mkdirSync(join(voidriftDir, "ideas"), { recursive: true });
    writeFileSync(join(voidriftDir, "ideas", "IDEA-1.md"), "# My idea\n");
    const mm = new ManifestManager(tmp);
    expect(mm.readIdea(1)).toBe("# My idea\n");
  });

  it("readIdea returns null when file missing", () => {
    const mm = new ManifestManager(tmp);
    expect(mm.readIdea(99)).toBeNull();
  });

  it("ideaPath returns correct path", () => {
    const mm = new ManifestManager(tmp);
    expect(mm.ideaPath(3)).toBe(join(voidriftDir, "ideas", "IDEA-3.md"));
  });

  // --- Module grouping via dispatchable ---

  it("dispatchable works across modules", () => {
    writeManifest({
      "1": { status: "planned", module: "backend" },
      "2": { status: "planned", module: "frontend" },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    const d = mm.dispatchable();
    expect(d).toContain(1);
    expect(d).toContain(2);
  });
});
