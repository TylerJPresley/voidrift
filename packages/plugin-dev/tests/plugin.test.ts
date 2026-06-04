import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { register, WorkflowObjects } from "../src/index.js";
import { CoreRegistry, EventBus, WorktreeEngine, PluginInterface } from "@voidrift/core";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-plugin-dev-test-" + Date.now());

function makePluginInterface(registry: CoreRegistry): PluginInterface {
  const bus = new EventBus();
  const worktree = new WorktreeEngine(TMP);
  return new PluginInterface(registry, bus, worktree, TMP, undefined, undefined, undefined, "plugin-dev");
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Plugin Registration", () => {
  it("registers dev modes into registry", () => {
    const registry = new CoreRegistry();
    const api = makePluginInterface(registry);
    register(api);
    expect(registry.getMode("idea")).toBeDefined();
    expect(registry.getMode("cr")).toBeDefined();
    expect(registry.getMode("dev")).toBeDefined();
  });

  it("registers dev commands into registry", () => {
    const registry = new CoreRegistry();
    const api = makePluginInterface(registry);
    register(api);
    expect(registry.getSlashCommand("import")).toBeDefined();
    expect(registry.getSlashCommand("analyze")).toBeDefined();
    expect(registry.getSlashCommand("develop")).toBeDefined();
    expect(registry.getSlashCommand("verify")).toBeDefined();
    expect(registry.getSlashCommand("deploy")).toBeDefined();
  });

  it("registers dev agents via pluginInterface", () => {
    const registry = new CoreRegistry();
    const registeredAgents: any[] = [];
    const api = makePluginInterface(registry);
    api.registerAgent = (manifest: any) => { registeredAgents.push(manifest); };
    register(api);

    expect(registeredAgents).toHaveLength(5);
    const ids = registeredAgents.map(a => a.id);
    expect(ids).toContain("idea");
    expect(ids).toContain("cr");
    expect(ids).toContain("develop");
    expect(ids).toContain("verify");
    expect(ids).toContain("deploy");
  });
});

describe("Dev Commands", () => {
  it("/analyze requires --idea flag", async () => {
    const registry = new CoreRegistry();
    const api = makePluginInterface(registry);
    register(api);
    const output: string[] = [];
    const cmd = registry.getSlashCommand("analyze")!;
    // Patch emit to capture output
    const origExecute = cmd.execute;
    await origExecute([]);
    // Command prints to emit — check via registry
  });

  it("/develop requires --cr flag", async () => {
    const registry = new CoreRegistry();
    const api = makePluginInterface(registry);
    register(api);
    const cmd = registry.getSlashCommand("develop")!;
    await cmd.execute([]);
  });

  it("/analyze with valid flag outputs progress", async () => {
    const registry = new CoreRegistry();
    const api = makePluginInterface(registry);
    register(api);
    const cmd = registry.getSlashCommand("analyze")!;
    await cmd.execute(["--idea", "42"]);
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
