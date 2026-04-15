import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryManager } from "../src/memory.js";

describe("MemoryManager", () => {
  const tmp = join(tmpdir(), `voidrift-test-memory-${Date.now()}`);
  const globalDir = join(tmp, "global");

  beforeEach(() => {
    mkdirSync(join(tmp, "project", ".voidrift"), { recursive: true });
    mkdirSync(join(globalDir, "memory"), { recursive: true });
    process.env.VOIDRIFT_HOME = globalDir;
  });

  afterEach(() => {
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("write and read", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    mm.write("STACK", "Python + FastAPI", "Project tech stack");
    const content = mm.read("STACK");
    expect(content).toContain("Python + FastAPI");
  });

  it("project overrides global", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    // Write global
    mm.write("PREF", "global value", "global", "global");
    // Write project
    mm.write("PREF", "project value", "project");
    expect(mm.read("PREF")).toContain("project value");
  });

  it("delete removes entry", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    mm.write("TEMP", "temporary");
    mm.delete("TEMP");
    expect(mm.read("TEMP")).toBeNull();
  });

  it("list returns all entries", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    mm.write("A", "content a", "Entry A");
    mm.write("B", "content b", "Entry B");
    const entries = mm.list();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.name).sort()).toEqual(["A", "B"]);
  });

  it("buildIndex returns formatted string", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    mm.write("STACK", "Python", "Tech stack");
    const index = mm.buildIndex();
    expect(index).toContain("## Memory");
    expect(index).toContain("STACK");
    expect(index).toContain("Tech stack");
  });

  it("buildIndex returns empty for no entries", () => {
    const mm = new MemoryManager(join(tmp, "project"));
    expect(mm.buildIndex()).toBe("");
  });
});
