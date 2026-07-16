import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskRegistry } from "../../src/tasks/registry.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `voidrift-test-tasks-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("TaskRegistry", () => {
  it("registers a task and retrieves it", () => {
    const reg = new TaskRegistry(testDir);
    reg.register({ name: "my-task", description: "A task", instruction: "Do {{thing}}" });
    const task = reg.get("my-task");
    expect(task).not.toBeNull();
    expect(task!.name).toBe("my-task");
    expect(task!.instruction).toBe("Do {{thing}}");
  });

  it("lists registered tasks", () => {
    const reg = new TaskRegistry(testDir);
    reg.register({ name: "task-a", description: "A", instruction: "a" });
    reg.register({ name: "task-b", description: "B", instruction: "b" });
    const list = reg.list();
    expect(list.length).toBe(2);
    expect(list.map(t => t.name).sort()).toEqual(["task-a", "task-b"]);
  });

  it("renders template with variables", () => {
    const reg = new TaskRegistry(testDir);
    reg.register({ name: "fetch", description: "Fetch", instruction: "Fetch {{url}} save to {{output}}" });
    const rendered = reg.render("fetch", { url: "https://example.com", output: "result.md" });
    expect(rendered).toBe("Fetch https://example.com save to result.md");
  });

  it("render returns null for unknown task", () => {
    const reg = new TaskRegistry(testDir);
    expect(reg.render("nonexistent", {})).toBeNull();
  });

  it("removes a task", () => {
    const reg = new TaskRegistry(testDir);
    reg.register({ name: "removable", description: "X", instruction: "x" });
    expect(reg.remove("removable")).toBe(true);
    expect(reg.get("removable")).toBeNull();
  });

  it("remove returns false for nonexistent task", () => {
    const reg = new TaskRegistry(testDir);
    expect(reg.remove("nonexistent")).toBe(false);
  });
});
