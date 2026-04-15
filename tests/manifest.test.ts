import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestManager } from "../src/manifest.js";

describe("ManifestManager", () => {
  const tmp = join(tmpdir(), `voidrift-test-manifest-${Date.now()}`);
  const voidriftDir = join(tmp, ".voidrift");

  beforeEach(() => {
    mkdirSync(join(voidriftDir, "tasks"), { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function writeManifest(tasks: Record<string, unknown>) {
    writeFileSync(join(voidriftDir, "tasks", "manifest.yml"),
      `next_id: 10\nnext_bug_id: 1\ntasks:\n` +
      Object.entries(tasks).map(([id, t]) => {
        const e = t as Record<string, unknown>;
        return `  ${id}:\n    status: ${e.status}\n    module: ${e.module ?? ""}\n    depends: [${(e.depends as number[] ?? []).join(", ")}]\n    skills: []\n    reqs: []`;
      }).join("\n") + "\n"
    );
  }

  it("loads and returns tasks", () => {
    writeManifest({ "1": { status: "planned", module: "backend" }, "2": { status: "implemented", module: "backend" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(Object.keys(mm.tasks())).toHaveLength(2);
    expect(mm.getTask(1)?.status).toBe("planned");
  });

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

  it("setStatus transitions and saves", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "in-progress");
    expect(mm.getTask(1)?.status).toBe("in-progress");
    // Reload to verify persistence
    const mm2 = new ManifestManager(tmp);
    mm2.load();
    expect(mm2.getTask(1)?.status).toBe("in-progress");
  });

  it("transitive blocking on failure (REQ-TM-3)", () => {
    writeManifest({
      "1": { status: "implemented", module: "a" },
      "2": { status: "planned", module: "a", depends: [1] },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "failed");
    expect(mm.getTask(2)?.status).toBe("blocked");
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

  it("hasWork returns false when all verified", () => {
    writeManifest({ "1": { status: "verified", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    expect(mm.hasWork()).toBe(false);
  });

  it("summary counts by status", () => {
    writeManifest({
      "1": { status: "planned", module: "a" },
      "2": { status: "planned", module: "a" },
      "3": { status: "implemented", module: "a" },
    });
    const mm = new ManifestManager(tmp);
    mm.load();
    const s = mm.summary();
    expect(s.planned).toBe(2);
    expect(s.implemented).toBe(1);
  });

  it("appends to history.log", () => {
    writeManifest({ "1": { status: "planned", module: "a" } });
    const mm = new ManifestManager(tmp);
    mm.load();
    mm.setStatus(1, "in-progress");
    const history = readFileSync(join(voidriftDir, "tasks", "history.log"), "utf-8");
    expect(history).toContain("TASK-1");
    expect(history).toContain("in-progress");
  });
});
