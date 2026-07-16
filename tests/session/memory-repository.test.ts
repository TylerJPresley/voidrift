import { describe, it, expect } from "vitest";
import { MemoryRegistry } from "../../src/session/memory.js";
import { InMemoryMemoryRepository } from "../../src/session/memory-repository.js";

describe("MemoryRegistry (in-memory)", () => {
  function create(entries: Array<{ id: string; title: string; summary: string; type: "directive" | "reference"; keywords?: string[]; body: string }> = []) {
    const repo = new InMemoryMemoryRepository();
    for (const e of entries) {
      repo.add({
        id: e.id, title: e.title, summary: e.summary, type: e.type,
        context: { keywords: e.keywords ?? [] }, filePath: `(test)/${e.id}.md`,
      }, e.body);
    }
    const registry = new MemoryRegistry(repo);
    registry.index(["(test)"]);
    return registry;
  }

  it("starts empty", () => {
    const reg = create();
    expect(reg.all).toEqual([]);
    expect(reg.directives).toEqual([]);
  });

  it("indexes entries from repository", () => {
    const reg = create([
      { id: "mem-1", title: "Convention", summary: "Use snake_case", type: "directive", keywords: ["style"], body: "Always use snake_case for API fields." },
      { id: "mem-2", title: "Auth note", summary: "JWT RS256", type: "reference", keywords: ["auth", "jwt"], body: "We use RS256 JWTs with 1h expiry." },
    ]);
    expect(reg.all).toHaveLength(2);
    expect(reg.directives).toHaveLength(1);
    expect(reg.directives[0].title).toBe("Convention");
  });

  it("loadBody returns correct body", () => {
    const reg = create([
      { id: "mem-x", title: "Test", summary: "Sum", type: "reference", body: "Full body content here." },
    ]);
    expect(reg.loadBody("mem-x")).toBe("Full body content here.");
    expect(reg.loadBody("nonexistent")).toBeNull();
  });

  it("loadDirectiveBodies returns all directive bodies", () => {
    const reg = create([
      { id: "d1", title: "Dir 1", summary: "S1", type: "directive", body: "Body 1" },
      { id: "d2", title: "Dir 2", summary: "S2", type: "directive", body: "Body 2" },
      { id: "r1", title: "Ref 1", summary: "S3", type: "reference", body: "Body 3" },
    ]);
    const bodies = reg.loadDirectiveBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies).toContain("Body 1");
    expect(bodies).toContain("Body 2");
  });

  it("discover matches keywords in user input", () => {
    const reg = create([
      { id: "m1", title: "Auth", summary: "Auth stuff", type: "reference", keywords: ["auth", "login"], body: "..." },
      { id: "m2", title: "DB", summary: "Database", type: "reference", keywords: ["database", "sql"], body: "..." },
    ]);
    const results = reg.rankRelevantMemories({ focusedFiles: [], userInput: "fix the auth login flow" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("m1");
  });

  it("discover matches file extensions", () => {
    const reg = create([
      { id: "ts-mem", title: "TS", summary: "TypeScript stuff", type: "reference", keywords: [], body: "..." },
    ]);
    // Add extension trigger manually
    reg.all[0].context.extensions = [".ts"];
    const results = reg.rankRelevantMemories({ focusedFiles: ["src/main.ts"], userInput: "" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
