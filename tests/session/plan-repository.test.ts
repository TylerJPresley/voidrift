import { describe, it, expect } from "vitest";
import { PlanManager } from "../../src/session/plan.js";
import { InMemoryPlanRepository } from "../../src/session/plan-repository.js";

describe("PlanManager (in-memory)", () => {
  function create() {
    const repo = new InMemoryPlanRepository();
    return new PlanManager(repo);
  }

  it("starts empty", () => {
    const pm = create();
    expect(pm.all()).toEqual([]);
    expect(pm.compileActivePlanSummary()).toBeNull();
  });

  it("adds a plan item", () => {
    const pm = create();
    const filename = pm.add("auth-refactor", "Refactor auth module", "Security debt", "now", "## Tasks\n- [ ] Extract token logic");
    expect(filename).toBe("auth-refactor.md");
    expect(pm.all()).toHaveLength(1);
    expect(pm.all()[0].description).toBe("Refactor auth module");
    expect(pm.all()[0].priority).toBe("now");
  });

  it("gets a plan item by filename", () => {
    const pm = create();
    pm.add("test-item", "Write tests", "", "next");
    const item = pm.get("test-item.md");
    expect(item).not.toBeNull();
    expect(item!.description).toBe("Write tests");
    expect(item!.priority).toBe("next");
  });

  it("returns null for missing items", () => {
    const pm = create();
    expect(pm.get("nonexistent.md")).toBeNull();
  });

  it("removes a plan item", () => {
    const pm = create();
    pm.add("to-delete", "Delete me", "", "later");
    expect(pm.remove("to-delete.md")).toBe(true);
    expect(pm.all()).toHaveLength(0);
    expect(pm.remove("to-delete.md")).toBe(false);
  });

  it("updates priority", () => {
    const pm = create();
    pm.add("move-me", "Move this", "", "later");
    expect(pm.updatePriority("move-me.md", "now")).toBe(true);
    expect(pm.get("move-me.md")!.priority).toBe("now");
  });

  it("returns false for priority update on missing item", () => {
    const pm = create();
    expect(pm.updatePriority("ghost.md", "now")).toBe(false);
  });

  it("byPriority filters correctly", () => {
    const pm = create();
    pm.add("a", "A", "", "now");
    pm.add("b", "B", "", "next");
    pm.add("c", "C", "", "now");
    pm.add("d", "D", "", "later");
    expect(pm.byPriority("now")).toHaveLength(2);
    expect(pm.byPriority("next")).toHaveLength(1);
    expect(pm.byPriority("later")).toHaveLength(1);
  });

  it("compile returns now items as context string", () => {
    const pm = create();
    pm.add("task-1", "First task", "Important", "now");
    pm.add("task-2", "Second task", "", "next");
    const compiled = pm.compileActivePlanSummary();
    expect(compiled).toContain("First task");
    expect(compiled).toContain("Important");
    expect(compiled).not.toContain("Second task");
  });

  it("loadBody returns item body", () => {
    const pm = create();
    pm.add("detailed", "Has body", "", "now", "## Details\nLots of content here");
    expect(pm.loadBody("detailed.md")).toBe("## Details\nLots of content here");
  });

  it("loadBody returns null for missing item", () => {
    const pm = create();
    expect(pm.loadBody("nope.md")).toBeNull();
  });
});
