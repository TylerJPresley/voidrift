import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerPlugin, WorkflowObjects } from "../src/index.js";
import { CoreRegistry } from "@voidrift/core";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-plugin-dev-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Plugin Registration", () => {
  it("registers dev modes into registry", () => {
    const registry = new CoreRegistry();
    registerPlugin(registry, TMP, () => {});
    expect(registry.getMode("idea")).toBeDefined();
    expect(registry.getMode("cr")).toBeDefined();
    expect(registry.getMode("dev")).toBeDefined();
  });

  it("registers dev commands into registry", () => {
    const registry = new CoreRegistry();
    registerPlugin(registry, TMP, () => {});
    expect(registry.getSlashCommand("import")).toBeDefined();
    expect(registry.getSlashCommand("analyze")).toBeDefined();
    expect(registry.getSlashCommand("develop")).toBeDefined();
    expect(registry.getSlashCommand("verify")).toBeDefined();
    expect(registry.getSlashCommand("deploy")).toBeDefined();
  });

  it("returns WorkflowObjects instance", () => {
    const registry = new CoreRegistry();
    const wf = registerPlugin(registry, TMP, () => {});
    expect(wf).toBeInstanceOf(WorkflowObjects);
  });
});

describe("Dev Commands", () => {
  it("/analyze requires --idea flag", async () => {
    const registry = new CoreRegistry();
    const output: string[] = [];
    registerPlugin(registry, TMP, (t) => output.push(t));
    await registry.getSlashCommand("analyze")!.execute([]);
    expect(output[0]).toContain("Usage");
  });

  it("/develop requires --cr flag", async () => {
    const registry = new CoreRegistry();
    const output: string[] = [];
    registerPlugin(registry, TMP, (t) => output.push(t));
    await registry.getSlashCommand("develop")!.execute([]);
    expect(output[0]).toContain("Usage");
  });

  it("/analyze with valid flag outputs progress", async () => {
    const registry = new CoreRegistry();
    const output: string[] = [];
    registerPlugin(registry, TMP, (t) => output.push(t));
    await registry.getSlashCommand("analyze")!.execute(["--idea", "42"]);
    expect(output[0]).toContain("IDEA-42");
  });
});

describe("Workflow Objects", () => {
  it("saves and retrieves ideas", () => {
    const wf = new WorkflowObjects(TMP);
    wf.saveIdea("1", "Feature X", "Build feature X with Y approach.");
    const idea = wf.getIdea("1");
    expect(idea).not.toBeNull();
    expect(idea!.title).toBe("Feature X");
    expect(idea!.content).toContain("Y approach");
  });

  it("lists ideas", () => {
    const wf = new WorkflowObjects(TMP);
    wf.saveIdea("1", "First", "content");
    wf.saveIdea("2", "Second", "content");
    const ideas = wf.listIdeas();
    expect(ideas).toHaveLength(2);
  });

  it("saves and lists CRs with focusedFiles", () => {
    const wf = new WorkflowObjects(TMP);
    wf.saveCR("1", "Add auth", ["src/auth.ts", "src/middleware.ts"], "Implement JWT auth.");
    const crs = wf.listCRs();
    expect(crs).toHaveLength(1);
    expect(crs[0].focusedFiles).toContain("src/auth.ts");
  });

  it("saves and lists tasks linked to CR", () => {
    const wf = new WorkflowObjects(TMP);
    wf.saveTask("1", "CR-1", "src/auth.ts", "Add login handler");
    wf.saveTask("2", "CR-1", "src/middleware.ts", "Add JWT middleware");
    wf.saveTask("3", "CR-2", "src/other.ts", "Unrelated task");

    const tasks = wf.listTasks("CR-1");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].file).toBe("src/auth.ts");
  });

  it("returns empty arrays for non-existent directories", () => {
    const wf = new WorkflowObjects(join(TMP, "empty"));
    expect(wf.listIdeas()).toEqual([]);
    expect(wf.listCRs()).toEqual([]);
    expect(wf.listTasks()).toEqual([]);
  });

  it("getIdea returns null for non-existent idea", () => {
    const wf = new WorkflowObjects(TMP);
    expect(wf.getIdea("999")).toBeNull();
  });
});
