import { describe, it, expect } from "vitest";
import { RoutineManager } from "../../src/session/routine.js";
import { InMemoryRoutineRepository } from "../../src/session/routine-repository.js";

describe("RoutineManager (in-memory)", () => {
  function create() {
    const repo = new InMemoryRoutineRepository();
    return new RoutineManager(repo);
  }

  it("starts empty", () => {
    const rm = create();
    expect(rm.all()).toEqual([]);
  });

  it("has a dir property from repository", () => {
    const rm = create();
    expect(rm.dir).toBe("(memory)");
  });

  it("adds a routine item", () => {
    const rm = create();
    const filename = rm.add("daily-checklist", "Daily checklist", "Review PRs and deploy");
    expect(filename).toBe("daily-checklist.md");
    expect(rm.all()).toHaveLength(1);
  });

  it("adds a routine with empty body", () => {
    const rm = create();
    const filename = rm.add("standup", "Daily standup");
    expect(filename).toBe("standup.md");
    const item = rm.get("standup.md");
    expect(item).not.toBeNull();
    expect(item!.body).toBe("");
  });

  it("adds a routine with description only", () => {
    const rm = create();
    rm.add("review", "Code review checklist", "");
    const item = rm.get("review.md");
    expect(item!.description).toBe("Code review checklist");
    expect(item!.body).toBe("");
  });

  it("gets a routine by filename", () => {
    const rm = create();
    rm.add("deploy", "Deploy checklist", "Run tests then deploy");
    const item = rm.get("deploy.md");
    expect(item).not.toBeNull();
    expect(item!.description).toBe("Deploy checklist");
    expect(item!.body).toBe("Run tests then deploy");
  });

  it("returns null for missing routine", () => {
    const rm = create();
    expect(rm.get("nonexistent.md")).toBeNull();
  });

  it("removes a routine", () => {
    const rm = create();
    rm.add("to-remove", "Remove me");
    expect(rm.all()).toHaveLength(1);
    expect(rm.remove("to-remove.md")).toBe(true);
    expect(rm.all()).toHaveLength(0);
  });

  it("remove returns false for missing routine", () => {
    const rm = create();
    expect(rm.remove("ghost.md")).toBe(false);
  });

  it("lists multiple routines", () => {
    const rm = create();
    rm.add("first", "First routine");
    rm.add("second", "Second routine", "Some body");
    rm.add("third", "Third routine");

    const all = rm.all();
    expect(all).toHaveLength(3);
    expect(all.map(r => r.filename)).toContain("first.md");
    expect(all.map(r => r.filename)).toContain("second.md");
    expect(all.map(r => r.filename)).toContain("third.md");
  });

  it("preserves body content through add and get", () => {
    const rm = create();
    const body = "## Checklist\n- [ ] Step 1\n- [ ] Step 2\n- [ ] Step 3";
    rm.add("checklist", "Daily checklist", body);

    const item = rm.get("checklist.md");
    expect(item!.body).toBe(body);
  });

  it("overwrites existing routine with same name", () => {
    const rm = create();
    rm.add("task", "Original", "Original body");
    rm.add("task", "Updated", "Updated body");

    expect(rm.all()).toHaveLength(1);
    const item = rm.get("task.md");
    expect(item!.description).toBe("Updated");
    expect(item!.body).toBe("Updated body");
  });
});