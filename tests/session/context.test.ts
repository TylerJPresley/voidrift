import { describe, it, expect } from "vitest";
import { ContextManager } from "../../src/session/context.js";

describe("ContextManager", () => {
  it("initializes with agent, orbit, drift, and void partitions", () => {
    const ctx = new ContextManager("You are an engineer.", "src/\n  index.ts");
    const s = ctx.context;
    expect(s.agent.activePersona).toBe("You are an engineer.");
    expect(s.orbit.workspaceCodeMap).toContain("src/");
    expect(s.void.messages).toHaveLength(0);
  });

  it("focuses files with LRU eviction at max 3", () => {
    const ctx = new ContextManager("", "");
    ctx.focusFile("a.ts", "summary-a", 100);
    ctx.focusFile("b.ts", "summary-b", 200);
    ctx.focusFile("c.ts", "summary-c", 300);
    ctx.focusFile("d.ts", "summary-d", 400);
    const paths = ctx.context.drift.focusedFiles.map((f) => f.path);
    expect(paths).toEqual(["b.ts", "c.ts", "d.ts"]);
  });

  it("re-focusing a file moves it to end", () => {
    const ctx = new ContextManager("", "");
    ctx.focusFile("a.ts", "summary-a", 100);
    ctx.focusFile("b.ts", "summary-b", 200);
    ctx.focusFile("a.ts", "summary-a-updated", 100, [50, 100]);
    const paths = ctx.context.drift.focusedFiles.map((f) => f.path);
    expect(paths).toEqual(["b.ts", "a.ts"]);
    expect(ctx.context.drift.focusedFiles[1].summary).toBe("summary-a-updated");
    expect(ctx.context.drift.focusedFiles[1].readRanges).toEqual([[50, 100]]);
  });

  it("adds messages with timestamps", () => {
    const ctx = new ContextManager("", "");
    ctx.addMessage({ role: "user", content: "hello" });
    expect(ctx.getMessages()).toHaveLength(1);
    expect(ctx.getMessages()[0].timestamp).toBeTypeOf("number");
  });

  it("manages memory load/unload", () => {
    const ctx = new ContextManager("", "");
    ctx.loadMemory("lesson 1");
    ctx.loadMemory("lesson 2");
    expect(ctx.context.orbit.activeMemory).toHaveLength(2);
    ctx.unloadMemory(0);
    expect(ctx.context.orbit.activeMemory).toEqual(["lesson 2"]);
  });

  it("evicts files when cumulative summary token count exceeds budget", () => {
    const ctx = new ContextManager("", "");
    const largeSummaryA = "a".repeat(16000); // 4000 tokens
    const largeSummaryB = "b".repeat(16000); // 4000 tokens
    const largeSummaryC = "c".repeat(8000);  // 2000 tokens

    ctx.focusFile("a.ts", largeSummaryA, 100, undefined, 3, 8000);
    ctx.focusFile("b.ts", largeSummaryB, 200, undefined, 3, 8000);
    expect(ctx.context.drift.focusedFiles.map(f => f.path)).toEqual(["a.ts", "b.ts"]);

    // This should push cumulative size to ~10,000 tokens, triggers LRU eviction of a.ts
    ctx.focusFile("c.ts", largeSummaryC, 300, undefined, 3, 8000);
    expect(ctx.context.drift.focusedFiles.map(f => f.path)).toEqual(["b.ts", "c.ts"]);
  });
});
