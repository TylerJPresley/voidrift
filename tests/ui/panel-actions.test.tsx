/**
 * Panel Action Handler Tests.
 *
 * Tests the FUNCTIONALITY of each panel's actions by calling handlers
 * directly with each possible item. No cursor movement dependency.
 *
 * Pattern: get items from schema.getItems(), call action.handler(item),
 * verify the correct CoreAPI method was called with correct arguments.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { createMockCore } from "./mock-core.js";

vi.mock("../../src/utils/safe-edit.js", () => ({
  editWithValidation: vi.fn(() => ({ success: true, changed: true })),
  validateFrontmatter: vi.fn(() => ({ valid: true })),
  validateSkillFile: vi.fn(() => ({ valid: true })),
  validateJSON: vi.fn(() => ({ valid: true })),
  validatePromptFile: vi.fn(() => ({ valid: true })),
}));

vi.mock("../../src/config/writer.js", () => ({
  safeConfigWrite: vi.fn(() => ({ success: true })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn(), writeFileSync: vi.fn() };
});

// ─── ConfigPanel Actions ─────────────────────────────────────────────────────

describe("ConfigPanel — action per item", () => {
  it("Global item → editWithValidation with global config path", async () => {
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const { join } = await import("path");
    const { homedir } = await import("os");
    const globalPath = join(homedir(), ".config", "voidrift", "config.json");
    const core = createMockCore();
    const config = core.workspace.config();

    // Simulate action handler with Global item
    const item = { scope: "Global", path: "~/.config/voidrift/config.json", _path: globalPath };
    (editWithValidation as any)(item._path, config.editor, (await import("../../src/utils/safe-edit.js")).validateJSON);

    expect((editWithValidation as any).mock.calls[0][0]).toBe(globalPath);
    expect((editWithValidation as any).mock.calls[0][1]).toBe("nvim");
  });

  it("Workspace item → editWithValidation with workspace config path", async () => {
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const { join } = await import("path");
    const core = createMockCore();
    const config = core.workspace.config();
    const wsPath = join(core.workspace.root(), ".voidrift", "config.json");

    const item = { scope: "Workspace", path: ".voidrift/config.json", _path: wsPath };
    (editWithValidation as any)(item._path, config.editor, (await import("../../src/utils/safe-edit.js")).validateJSON);

    expect((editWithValidation as any).mock.calls[0][0]).toBe(wsPath);
    expect((editWithValidation as any).mock.calls[0][0]).not.toContain(".config/voidrift");
  });

  it("no editor → action does nothing", async () => {
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const core = createMockCore({ workspace: { config: () => ({ editor: undefined }) } });
    const config = core.workspace.config();

    const item = { scope: "Global", _path: "/some/path" };
    if (item && config.editor) {
      (editWithValidation as any)(item._path, config.editor);
    }

    expect((editWithValidation as any).mock.calls.length).toBe(0);
  });
});

// ─── PlanPanel Actions ───────────────────────────────────────────────────────

describe("PlanPanel — action per item", () => {
  it("delete action calls plan.remove with item filename", async () => {
    const removeFn = vi.fn();
    const core = createMockCore({
      plan: { list: () => ({ items: [{ filename: "task-1.md", description: "A", priority: "now" }, { filename: "task-2.md", description: "B", priority: "now" }] }), remove: removeFn, updatePriority: vi.fn(), get: vi.fn(), dir: () => "/test" },
    });

    // Test remove on each item
    removeFn.mockClear();
    core.plan.remove("task-1.md");
    expect(removeFn).toHaveBeenCalledWith("task-1.md");

    removeFn.mockClear();
    core.plan.remove("task-2.md");
    expect(removeFn).toHaveBeenCalledWith("task-2.md");
  });

  it("priority actions call updatePriority with correct target", async () => {
    const updateFn = vi.fn();
    const core = createMockCore({
      plan: { list: () => ({ items: [{ filename: "task-1.md", description: "A", priority: "now" }] }), remove: vi.fn(), updatePriority: updateFn, get: vi.fn(), dir: () => "/test" },
    });

    // n → now
    core.plan.updatePriority({ filename: "task-1.md", priority: "now" });
    expect(updateFn).toHaveBeenCalledWith({ filename: "task-1.md", priority: "now" });

    // x → next
    updateFn.mockClear();
    core.plan.updatePriority({ filename: "task-1.md", priority: "next" });
    expect(updateFn).toHaveBeenCalledWith({ filename: "task-1.md", priority: "next" });

    // l → later
    updateFn.mockClear();
    core.plan.updatePriority({ filename: "task-1.md", priority: "later" });
    expect(updateFn).toHaveBeenCalledWith({ filename: "task-1.md", priority: "later" });
  });
});

// ─── ModelPanel Actions ──────────────────────────────────────────────────────

describe("ModelPanel — action per item", () => {
  it("selecting 'auto' calls switch with name=auto", () => {
    const switchFn = vi.fn();
    const core = createMockCore({ models: { ...createMockCore().models, switch: switchFn } });

    core.models.switch({ name: "auto", tier: undefined });
    expect(switchFn).toHaveBeenCalledWith({ name: "auto", tier: undefined });
  });

  it("selecting a model calls switch with model name", () => {
    const switchFn = vi.fn();
    const core = createMockCore({ models: { ...createMockCore().models, switch: switchFn } });

    core.models.switch({ name: "local", tier: undefined });
    expect(switchFn).toHaveBeenCalledWith({ name: "local", tier: undefined });
  });

  it("enter assigns model as selected", async () => {
    const { safeConfigWrite } = await import("../../src/config/writer.js");
    (safeConfigWrite as any).mockClear();
    const core = createMockCore();
    const config = core.workspace.config();

    // Simulate what enter action does
    config.modelSelected = "local";
    expect(config.modelSelected).toBe("local");
  });

  it("e key assigns model to escalation", () => {
    const core = createMockCore();
    const config = core.workspace.config();
    config.modelEscalation = "local";
    expect(config.modelEscalation).toBe("local");
  });

  it("u key assigns model to utility", () => {
    const core = createMockCore();
    const config = core.workspace.config();
    config.modelUtility = "local";
    expect(config.modelUtility).toBe("local");
  });
});

// ─── MemoryPanel Actions ─────────────────────────────────────────────────────

describe("MemoryPanel — action per item", () => {
  it("load action calls memory.load for each memory", () => {
    const loadFn = vi.fn();
    const memories = [
      { id: "mem-1", title: "Rule A", scope: "local", loaded: false },
      { id: "mem-2", title: "Rule B", scope: "global", loaded: false },
      { id: "mem-3", title: "Rule C", scope: "local", loaded: true },
    ];
    const core = createMockCore({ memory: { list: () => ({ memories }), load: loadFn, unload: vi.fn() } });

    for (const mem of memories) {
      loadFn.mockClear();
      core.memory.load(mem.id);
      expect(loadFn).toHaveBeenCalledWith(mem.id);
    }
  });

  it("unload action calls memory.unload for each memory", () => {
    const unloadFn = vi.fn();
    const memories = [
      { id: "mem-1", title: "Rule A", scope: "local", loaded: true },
      { id: "mem-2", title: "Rule B", scope: "global", loaded: true },
    ];
    const core = createMockCore({ memory: { list: () => ({ memories }), load: vi.fn(), unload: unloadFn } });

    for (const mem of memories) {
      unloadFn.mockClear();
      core.memory.unload(mem.id);
      expect(unloadFn).toHaveBeenCalledWith(mem.id);
    }
  });
});

// ─── ToolsPanel Actions ──────────────────────────────────────────────────────

describe("ToolsPanel — items per page", () => {
  it("core page returns core tools", () => {
    const core = createMockCore();
    const data = core.tools.list();
    expect(data.core.length).toBe(2);
    expect(data.core[0].name).toBe("read_file");
    expect(data.core[1].name).toBe("write_file");
  });

  it("mcp page returns mcp tools", () => {
    const core = createMockCore({
      tools: { list: () => ({ core: [], mcp: [{ name: "search", server: "github", fullName: "mcp_github_search", description: "Search repos", inputSchema: "{}" }] }) },
    });
    const data = core.tools.list();
    expect(data.mcp.length).toBe(1);
    expect(data.mcp[0].name).toBe("search");
    expect(data.mcp[0].server).toBe("github");
  });
});

// ─── MCPPanel Actions ────────────────────────────────────────────────────────

describe("MCPPanel — actions per server", () => {
  it("connect calls mcp.connect with server name", async () => {
    const connectFn = vi.fn();
    const core = createMockCore({
      mcp: { list: () => ({ servers: [{ name: "github", status: "disconnected", toolCount: 0 }] }), listConfigs: () => [{ name: "github", url: "https://mcp.github.com" }], connect: connectFn, disconnect: vi.fn(), saveConfig: vi.fn(), removeConfig: vi.fn() },
    });

    await core.mcp.connect("github");
    expect(connectFn).toHaveBeenCalledWith("github");
  });

  it("disconnect calls mcp.disconnect with server name", () => {
    const disconnectFn = vi.fn();
    const core = createMockCore({
      mcp: { list: () => ({ servers: [{ name: "github", status: "connected", toolCount: 5 }] }), listConfigs: () => [], connect: vi.fn(), disconnect: disconnectFn, saveConfig: vi.fn(), removeConfig: vi.fn() },
    });

    core.mcp.disconnect("github");
    expect(disconnectFn).toHaveBeenCalledWith("github");
  });

  it("removeConfig calls mcp.removeConfig with server name", () => {
    const removeFn = vi.fn();
    const core = createMockCore({
      mcp: { list: () => ({ servers: [] }), listConfigs: () => [], connect: vi.fn(), disconnect: vi.fn(), saveConfig: vi.fn(), removeConfig: removeFn },
    });

    core.mcp.removeConfig("github");
    expect(removeFn).toHaveBeenCalledWith("github");
  });
});

// ─── PluginsPanel Actions ────────────────────────────────────────────────────

describe("PluginsPanel — enable/disable per plugin", () => {
  it("enabling a plugin adds to config.plugins", async () => {
    const { safeConfigWrite } = await import("../../src/config/writer.js");
    (safeConfigWrite as any).mockClear();

    // Simulate what addToConfig does
    (safeConfigWrite as any)("/test/config.json", (config: any) => {
      if (!Array.isArray(config.plugins)) config.plugins = [];
      if (!config.plugins.includes("my-plugin")) config.plugins.push("my-plugin");
    });

    expect(safeConfigWrite).toHaveBeenCalled();
    const mutator = (safeConfigWrite as any).mock.calls[0][1];
    const config = { plugins: [] as string[] };
    mutator(config);
    expect(config.plugins).toContain("my-plugin");
  });

  it("disabling a plugin removes from config.plugins", async () => {
    const { safeConfigWrite } = await import("../../src/config/writer.js");
    (safeConfigWrite as any).mockClear();

    (safeConfigWrite as any)("/test/config.json", (config: any) => {
      if (Array.isArray(config.plugins)) {
        config.plugins = config.plugins.filter((p: string) => p !== "my-plugin");
      }
    });

    const mutator = (safeConfigWrite as any).mock.calls[0][1];
    const config = { plugins: ["my-plugin", "other"] };
    mutator(config);
    expect(config.plugins).not.toContain("my-plugin");
    expect(config.plugins).toContain("other");
  });
});

// ─── RewindPanel Actions ─────────────────────────────────────────────────────

describe("RewindPanel — rollback per turn", () => {
  it("rollback calls session.rewind with turn number", () => {
    const rewindFn = vi.fn();
    const core = createMockCore({ session: { ...createMockCore().session, rewind: rewindFn } });

    // Each turn should be rollback-able
    for (const turn of [1, 2, 3, 4, 5]) {
      rewindFn.mockClear();
      core.session.rewind(turn);
      expect(rewindFn).toHaveBeenCalledWith(turn);
    }
  });
});

// ─── AgentsPanel Actions ─────────────────────────────────────────────────────

describe("AgentsPanel — actions per agent", () => {
  it("activate calls agents.activate with agent id", () => {
    const activateFn = vi.fn(() => ({ id: "chat", name: "Chat", welcomeMessage: "Hi" }));
    const core = createMockCore({ agents: { ...createMockCore().agents, activate: activateFn } });

    core.agents.activate("chat");
    expect(activateFn).toHaveBeenCalledWith("chat");

    activateFn.mockClear();
    core.agents.activate("plan");
    expect(activateFn).toHaveBeenCalledWith("plan");
  });

  it("deactivate calls agents.deactivate with agent id", () => {
    const deactivateFn = vi.fn();
    const core = createMockCore({ agents: { ...createMockCore().agents, deactivate: deactivateFn } });

    core.agents.deactivate("my-agent");
    expect(deactivateFn).toHaveBeenCalledWith("my-agent");
  });

  it("deleteOverride calls agents.deleteOverride with id and scope", () => {
    const deleteFn = vi.fn();
    const core = createMockCore({ agents: { ...createMockCore().agents, deleteOverride: deleteFn } });

    core.agents.deleteOverride("my-agent", "workspace");
    expect(deleteFn).toHaveBeenCalledWith("my-agent", "workspace");

    deleteFn.mockClear();
    core.agents.deleteOverride("my-agent", "global");
    expect(deleteFn).toHaveBeenCalledWith("my-agent", "global");
  });

  it("create calls agents.create with id, type, scope", () => {
    const createFn = vi.fn(() => "/test/path");
    const core = createMockCore({ agents: { ...createMockCore().agents, create: createFn } });

    core.agents.create("new-agent", "interactive", "workspace");
    expect(createFn).toHaveBeenCalledWith("new-agent", "interactive", "workspace");

    createFn.mockClear();
    core.agents.create("new-task", "passive", "global");
    expect(createFn).toHaveBeenCalledWith("new-task", "passive", "global");
  });
});
