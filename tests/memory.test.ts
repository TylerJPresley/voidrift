import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryManager } from "../src/memory.js";

describe("MemoryManager", () => {
  const tmp = join(tmpdir(), `voidrift-test-memory-${Date.now()}`);
  const projectDir = join(tmp, "project");
  const globalDir = join(tmp, "global");

  beforeEach(() => {
    mkdirSync(join(projectDir, ".voidrift"), { recursive: true });
    mkdirSync(join(globalDir, "memory"), { recursive: true });
    process.env.VOIDRIFT_HOME = globalDir;
  });

  afterEach(() => {
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  // --- Basic read/write ---

  it("write and read roundtrip", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("STACK", "Python + FastAPI", "Project tech stack");
    const content = mm.read("STACK");
    expect(content).toContain("Python + FastAPI");
  });

  it("read returns null for missing entry", () => {
    const mm = new MemoryManager(projectDir);
    expect(mm.read("NONEXISTENT")).toBeNull();
  });

  // --- Two-layer resolution ---

  it("project overrides global", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("PREF", "global value", "global", "global");
    mm.write("PREF", "project value", "project");
    expect(mm.read("PREF")).toContain("project value");
  });

  it("read falls through to global when project has no match", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("GLOBAL-ONLY", "from global layer", "Global entry", "global");
    const content = mm.read("GLOBAL-ONLY");
    expect(content).not.toBeNull();
    expect(content).toContain("from global layer");
  });

  it("list shows both project and global entries", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("PROJ-ENTRY", "content", "Project thing", "project");
    mm.write("GLOB-ENTRY", "content", "Global thing", "global");
    const entries = mm.list();
    const names = entries.map(e => e.name);
    expect(names).toContain("PROJ-ENTRY");
    expect(names).toContain("GLOB-ENTRY");
  });

  it("list deduplicates: project wins over global with same name", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("SHARED", "global", "Global ver", "global");
    mm.write("SHARED", "project", "Project ver", "project");
    const entries = mm.list();
    const shared = entries.filter(e => e.name === "SHARED");
    expect(shared).toHaveLength(1);
    expect(shared[0].layer).toBe("project");
  });

  // --- Delete ---

  it("delete removes entry", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("TEMP", "temporary");
    mm.delete("TEMP");
    expect(mm.read("TEMP")).toBeNull();
  });

  it("delete from project scope only", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("BOTH", "global val", "desc", "global");
    mm.write("BOTH", "project val", "desc", "project");
    mm.delete("BOTH", "project");
    // Global should still be readable
    const content = mm.read("BOTH");
    expect(content).toContain("global val");
  });

  it("delete from global scope only", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("BOTH", "global val", "desc", "global");
    mm.write("BOTH", "project val", "desc", "project");
    mm.delete("BOTH", "global");
    // Project should still be readable
    const content = mm.read("BOTH");
    expect(content).toContain("project val");
  });

  // --- Index ---

  it("buildIndex returns formatted string with entries", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("STACK", "Python", "Tech stack");
    const index = mm.buildIndex();
    expect(index).toContain("## Memory");
    expect(index).toContain("STACK");
    expect(index).toContain("Tech stack");
  });

  it("buildIndex returns empty for no entries", () => {
    const mm = new MemoryManager(projectDir);
    expect(mm.buildIndex()).toBe("");
  });

  it("write generates MEMORY.md index file", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("AUTH", "JWT RS256", "Auth approach");
    const indexPath = join(projectDir, ".voidrift", "memory", "MEMORY.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("AUTH");
    expect(content).toContain("Auth approach");
  });

  it("delete updates MEMORY.md index file", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("KEEP", "keep this", "Keeper");
    mm.write("REMOVE", "remove this", "Remover");
    mm.delete("REMOVE");
    const indexPath = join(projectDir, ".voidrift", "memory", "MEMORY.md");
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("KEEP");
    expect(content).not.toContain("REMOVE");
  });

  it("list returns entries with correct layer attribution", () => {
    const mm = new MemoryManager(projectDir);
    mm.write("P", "proj", "Project entry", "project");
    mm.write("G", "glob", "Global entry", "global");
    const entries = mm.list();
    const p = entries.find(e => e.name === "P");
    const g = entries.find(e => e.name === "G");
    expect(p?.layer).toBe("project");
    expect(g?.layer).toBe("global");
  });
});
