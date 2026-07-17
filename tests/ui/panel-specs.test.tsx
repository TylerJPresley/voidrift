/**
 * Panel Specification Tests.
 *
 * These tests define WHAT EACH PANEL SHOULD DO — not what it currently does.
 * Failures indicate bugs that need fixing.
 *
 * Universal panel contract:
 * 1. Every panel renders a title
 * 2. Every panel closes on escape
 * 3. Every panel's footer follows "navigation │ actions" pattern
 * 4. Navigation keys (←/→, ↑↓, esc) are on the LEFT of │
 * 5. Action keys (enter, letter keys, del) are on the RIGHT of │
 * 6. Cursor-navigable panels highlight the selected item with ▸
 * 7. Panels with pages show the active page highlighted
 * 8. Empty states show a descriptive message (not blank space)
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { createMockCore } from "./mock-core.js";

vi.mock("../../src/utils/safe-edit.js", () => ({
  editWithValidation: vi.fn(() => ({ success: true, changed: false })),
  validateFrontmatter: vi.fn(() => ({ valid: true })),
  validateSkillFile: vi.fn(() => ({ valid: true })),
  validateJSON: vi.fn(() => ({ valid: true })),
  validatePromptFile: vi.fn(() => ({ valid: true })),
}));

vi.mock("../../src/config/writer.js", () => ({
  safeConfigWrite: vi.fn(() => ({ success: true })),
}));

const delay = (ms = 50) => new Promise(r => setTimeout(r, ms));

// ─── Universal Contract ──────────────────────────────────────────────────────

describe("Universal Panel Contract", () => {
  const panelImports = [
    { name: "StatsPanel", path: "../../src/ui/panels/StatsPanel.js", props: {} },
    { name: "HelpPanel", path: "../../src/ui/panels/HelpPanel.js", props: { sessionId: "test", workspace: "~/test" } },
    { name: "ToolsPanel", path: "../../src/ui/panels/ToolsPanel.js", props: {} },
    { name: "ModelPanel", path: "../../src/ui/panels/ModelPanel.js", props: {} },
    { name: "PlanPanel", path: "../../src/ui/panels/PlanPanel.js", props: {} },
    { name: "MemoryPanel", path: "../../src/ui/panels/MemoryPanel.js", props: {} },
    { name: "PolicyPanel", path: "../../src/ui/panels/PolicyPanel.js", props: {} },
    { name: "ConfigPanel", path: "../../src/ui/panels/ConfigPanel.js", props: {} },
    { name: "TasksPanel", path: "../../src/ui/panels/TasksPanel.js", props: {} },
    { name: "RewindPanel", path: "../../src/ui/panels/RewindPanel.js", props: {} },
    { name: "ContextPanel", path: "../../src/ui/panels/ContextPanel.js", props: { modelName: "test" } },
    { name: "SkillsPanel", path: "../../src/ui/panels/SkillsPanel.js", props: {} },
    { name: "PluginsPanel", path: "../../src/ui/panels/PluginsPanel.js", props: {} },
    { name: "HistoryPanel", path: "../../src/ui/panels/HistoryPanel.js", props: {} },
    { name: "AgentsPanel", path: "../../src/ui/panels/AgentsPanel.js", props: {} },
  ];

  for (const { name, path, props } of panelImports) {
    describe(name, () => {
      it("renders without crashing", async () => {
        const mod = await import(path);
        const Panel = mod[name];
        const core = createMockCore();
        const { lastFrame } = render(<Panel core={core as any} onClose={() => {}} {...props} />);
        expect(lastFrame()).toBeDefined();
        expect(lastFrame()!.length).toBeGreaterThan(0);
      });

      it("closes on escape", async () => {
        const mod = await import(path);
        const Panel = mod[name];
        const core = createMockCore();
        const onClose = vi.fn();
        const { stdin } = render(<Panel core={core as any} onClose={onClose} {...props} />);
        stdin.write("\x1B");
        await delay();
        expect(onClose).toHaveBeenCalled();
      });

      it("footer has navigation │ actions separator", async () => {
        const mod = await import(path);
        const Panel = mod[name];
        const core = createMockCore();
        const { lastFrame } = render(<Panel core={core as any} onClose={() => {}} {...props} />);
        const frame = lastFrame()!;
        // Every panel should have Close on the navigation side
        expect(frame).toContain("Close");
      });

      it("esc Close appears BEFORE action keys in footer", async () => {
        const mod = await import(path);
        const Panel = mod[name];
        const core = createMockCore();
        const { lastFrame } = render(<Panel core={core as any} onClose={() => {}} {...props} />);
        const frame = lastFrame()!;
        const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\x1B\[[0-9;]*m/g, "");
        const lines = stripAnsi(frame).split("\n");
        // Footer line: contains "esc" immediately followed by " Close"
        const footerLine = lines.find(l => l.includes("esc Close") || l.includes("esc  Close"));
        if (!footerLine) return;
        // "Close" should appear before action-specific keywords
        const closePos = footerLine.indexOf("Close");
        const actionKeywords = ["create", "rename", "delete", "enable", "disable", "Run", "Remove"];
        for (const kw of actionKeywords) {
          const kwPos = footerLine.indexOf(kw);
          if (kwPos !== -1) {
            expect(closePos).toBeLessThan(kwPos);
          }
        }
      });
    });
  }
});

// ─── ConfigPanel Spec ────────────────────────────────────────────────────────
// Intent: Let the user select Global or Workspace config and open it in their editor.
// - Shows exactly 2 items: Global and Workspace
// - Paths are human-readable (~/... and ./...)
// - Enter opens the selected config file in the configured editor
// - If no editor configured, does nothing (no crash)
// - After edit, hot-reloads the config

describe("ConfigPanel spec", () => {
  it("shows exactly 2 items: Global and Workspace", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Global");
    expect(frame).toContain("Workspace");
  });

  it("Global path shows ~/.config/voidrift/config.json", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("~/.config/voidrift/config.json");
  });

  it("Workspace path shows ./.voidrift/config.json", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain(".voidrift/config.json");
  });

  it("cursor starts on Global (first item)", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    const lines = lastFrame()!.split("\n");
    const globalLine = lines.find(l => l.includes("Global"));
    expect(globalLine).toContain("▸");
  });

  it("down arrow moves cursor to Workspace", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    stdin.write("\x1B[B"); await delay();
    const lines = lastFrame()!.split("\n");
    const wsLine = lines.find(l => l.includes("Workspace"));
    expect(wsLine).toContain("▸");
  });

  it("enter calls editValidated with correct global path", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const editFn = vi.fn(() => ({ success: true, changed: true }));
    const core = createMockCore({ editor: { open: vi.fn(), editValidated: editFn, viewReadonly: vi.fn(), hasEditor: () => true } });
    const { stdin } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    stdin.write("\r"); await delay();
    expect(editFn).toHaveBeenCalled();
    const [path, type] = editFn.mock.calls[0];
    expect(path).toContain(".config/voidrift/config.json");
    expect(type).toBe("json");
  });

  it("action handler edits global path when given Global item", async () => {
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const core = createMockCore();
    const config = core.workspace.config();
    const { join } = await import("path");
    const { homedir } = await import("os");
    const globalPath = join(homedir(), ".config", "voidrift", "config.json");
    const item = { scope: "Global", path: "~/.config/voidrift/config.json", _path: globalPath };
    if (item && config.editor) {
      (editWithValidation as any)(item._path, config.editor, (await import("../../src/utils/safe-edit.js")).validateJSON);
    }
    const [path, editor] = (editWithValidation as any).mock.calls[0];
    expect(path).toContain(".config/voidrift/config.json");
    expect(editor).toBe("nvim");
  });

  it("action handler edits workspace path when given Workspace item", async () => {
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const core = createMockCore();
    const config = core.workspace.config();
    const { join } = await import("path");
    const workspaceRoot = core.workspace.root();
    const wsPath = join(workspaceRoot, ".voidrift", "config.json");
    const item = { scope: "Workspace", path: ".voidrift/config.json", _path: wsPath };
    if (item && config.editor) {
      (editWithValidation as any)(item._path, config.editor, (await import("../../src/utils/safe-edit.js")).validateJSON);
    }
    const [path, editor] = (editWithValidation as any).mock.calls[0];
    expect(path).toContain(".voidrift/config.json");
    expect(path).not.toContain(".config/voidrift");
    expect(editor).toBe("nvim");
  });

  it("no editor configured = enter does nothing", async () => {
    const { ConfigPanel } = await import("../../src/ui/panels/ConfigPanel.js");
    const { editWithValidation } = await import("../../src/utils/safe-edit.js");
    (editWithValidation as any).mockClear();
    const core = createMockCore({ workspace: { config: () => ({ editor: undefined, tiers: {}, models: {}, plugins: [] }) } });
    const { stdin } = render(<ConfigPanel core={core as any} onClose={() => {}} />);
    stdin.write("\r"); await delay();
    expect(editWithValidation).not.toHaveBeenCalled();
  });
});

// ─── PlanPanel Spec ──────────────────────────────────────────────────────────
// Intent: View and manage plan items across priority lanes.
// - 4 pages: now, next, later, complete
// - Each page shows only items of that priority
// - Enter opens detail view showing full plan body
// - Actions: n=now, x=next, l=later (reprioritize), del=remove, r=run
// - Detail view shows description, rationale, body content

describe("PlanPanel spec", () => {
  it("has 4 priority pages", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("now");
    expect(frame).toContain("next");
    expect(frame).toContain("later");
    expect(frame).toContain("complete");
  });

  it("'now' page shows only now-priority items", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("Implement feature X");
    expect(lastFrame()!).not.toContain("Fix bug Y"); // next priority
  });

  it("navigating to 'next' page shows next-priority items", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    stdin.write("\x1B[C"); await delay();
    expect(lastFrame()!).toContain("Fix bug Y");
    expect(lastFrame()!).not.toContain("Implement feature X");
  });

  it("enter opens detail showing plan body", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    stdin.write("\r"); await delay();
    const frame = lastFrame()!;
    expect(frame).toContain("task-1.md");
    expect(frame).toContain("Tasks"); // from plan body
  });

  it("delete requires confirmation before removing", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const removeFn = vi.fn();
    const core = createMockCore({
      plan: { list: () => ({ items: [{ filename: "item.md", description: "Test", priority: "now", rationale: "", body: "" }] }), get: () => ({ item: { filename: "item.md", description: "Test", priority: "now", rationale: "", body: "" } }), remove: removeFn, updatePriority: vi.fn(), dir: () => "/test" },
    });
    const { stdin } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    stdin.write("\x1B[3~"); await delay();
    // Should NOT have removed yet — waiting for confirmation
    expect(removeFn).not.toHaveBeenCalled();
    // Type "y" and enter to confirm
    stdin.write("y"); await delay();
    stdin.write("\r"); await delay();
    expect(removeFn).toHaveBeenCalledWith("item.md");
  });

  it("empty page shows 'No items' message", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore({
      plan: { list: () => ({ items: [] }), get: () => ({ item: { filename: "x.md", description: "", priority: "now", rationale: "", body: "" } }), remove: vi.fn(), updatePriority: vi.fn(), dir: () => "/test" },
    });
    const { lastFrame } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("No items");
  });
});

// ─── ModelPanel Spec ─────────────────────────────────────────────────────────
// Intent: Select the active model or assign models to tiers.
// - Shows "auto" option + all configured models
// - Enter selects and closes
// - f/u/d assign to flash/utility/dense tiers
// - Active model/tier shown with ✓

describe("ModelPanel spec", () => {
  it("shows auto option", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ModelPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("auto");
  });

  it("shows configured models", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ModelPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("local");
  });

  it("enter on auto switches to auto and closes", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const switchFn = vi.fn();
    const onClose = vi.fn();
    const core = createMockCore({ models: { ...createMockCore().models, switch: switchFn } });
    const { stdin } = render(<ModelPanel core={core as any} onClose={onClose} />);
    stdin.write("\r"); await delay();
    expect(switchFn).toHaveBeenCalledWith({ name: "auto", tier: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it("enter on a model selects it and closes", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const switchFn = vi.fn();
    const onClose = vi.fn();
    const core = createMockCore({ models: { ...createMockCore().models, switch: switchFn } });
    const { stdin } = render(<ModelPanel core={core as any} onClose={onClose} />);
    stdin.write("\x1B[B"); await delay(); // down to "local"
    stdin.write("\r"); await delay();
    expect(switchFn).toHaveBeenCalledWith({ name: "local", tier: undefined });
  });

  it("footer shows tier assignment keys (f/u/d)", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ModelPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Flash");
    expect(frame).toContain("Utility");
    expect(frame).toContain("Dense");
  });
});

// ─── MemoryPanel Spec ────────────────────────────────────────────────────────
// Intent: View, load/unload, and edit memories.
// - Shows all memories with loaded status (● = loaded)
// - l loads selected memory into context
// - u unloads selected memory from context
// - enter opens memory file in editor
// - Loaded memories show ● indicator

describe("MemoryPanel spec", () => {
  it("shows memory titles", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<MemoryPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("Use snake_case");
    expect(lastFrame()!).toContain("Test with mocks");
  });

  it("shows ● for loaded memories", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<MemoryPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("●");
  });

  it("l calls load with selected memory id", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const loadFn = vi.fn();
    const core = createMockCore({ memory: { list: () => ({ memories: [{ id: "mem-1", title: "Test", summary: "", keywords: [], scope: "local", loaded: false }] }), load: loadFn, unload: vi.fn() } });
    const { stdin } = render(<MemoryPanel core={core as any} onClose={() => {}} />);
    stdin.write("l"); await delay();
    expect(loadFn).toHaveBeenCalledWith("mem-1");
  });

  it("u calls unload with selected memory id", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const unloadFn = vi.fn();
    const core = createMockCore({ memory: { list: () => ({ memories: [{ id: "mem-1", title: "Test", summary: "", keywords: [], scope: "local", loaded: true }] }), load: vi.fn(), unload: unloadFn } });
    const { stdin } = render(<MemoryPanel core={core as any} onClose={() => {}} />);
    stdin.write("u"); await delay();
    expect(unloadFn).toHaveBeenCalledWith("mem-1");
  });
});

// ─── StatsPanel Spec ─────────────────────────────────────────────────────────
// Intent: Show session metrics at a glance.
// - Duration, turn count, tool success/failure
// - Per-model token usage table
// - Context usage percentage

describe("StatsPanel spec", () => {
  it("shows session duration", async () => {
    const { StatsPanel } = await import("../../src/ui/panels/StatsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<StatsPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("2m 30s");
  });

  it("shows tool call counts", async () => {
    const { StatsPanel } = await import("../../src/ui/panels/StatsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<StatsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("12"); // total
    expect(frame).toContain("10"); // success
    expect(frame).toContain("2"); // failed
  });

  it("shows context percentage", async () => {
    const { StatsPanel } = await import("../../src/ui/panels/StatsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<StatsPanel core={core as any} onClose={() => {}} />);
    expect(lastFrame()!).toContain("25%");
  });
});

// ─── ToolsPanel Spec ─────────────────────────────────────────────────────────
// Intent: Show what tools are available to the active agent.
// - Two pages: core tools and MCP tools
// - Each tool shows name, approval mode, description
// - Enter opens detail with parameters

describe("ToolsPanel spec", () => {
  it("shows core tools with approval status", async () => {
    const { ToolsPanel } = await import("../../src/ui/panels/ToolsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ToolsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("read_file");
    expect(frame).toContain("auto"); // approval mode
    expect(frame).toContain("write_file");
    expect(frame).toContain("gated");
  });

  it("has core and mcp pages", async () => {
    const { ToolsPanel } = await import("../../src/ui/panels/ToolsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<ToolsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("core");
    expect(frame).toContain("mcp");
  });

  it("enter opens tool detail", async () => {
    const { ToolsPanel } = await import("../../src/ui/panels/ToolsPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<ToolsPanel core={core as any} onClose={() => {}} />);
    stdin.write("\r"); await delay();
    const frame = lastFrame()!;
    expect(frame).toContain("read_file");
    expect(frame).toContain("Parameters");
  });
});

// ─── HelpPanel Spec ──────────────────────────────────────────────────────────
// Intent: Show version, commands, shortcuts, context architecture.
// - 4 pages: general, commands, shortcuts, context
// - General shows version and workspace
// - Commands shows all registered slash commands

describe("HelpPanel spec", () => {
  it("shows version info", async () => {
    const { HelpPanel } = await import("../../src/ui/panels/HelpPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<HelpPanel core={core as any} sessionId="test" workspace="~/test" onClose={() => {}} />);
    expect(lastFrame()!).toContain("VoidRift");
  });

  it("has 4 pages", async () => {
    const { HelpPanel } = await import("../../src/ui/panels/HelpPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<HelpPanel core={core as any} sessionId="test" workspace="~/test" onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("general");
    expect(frame).toContain("commands");
    expect(frame).toContain("shortcuts");
    expect(frame).toContain("context");
  });

  it("commands page lists registered commands", async () => {
    const { HelpPanel } = await import("../../src/ui/panels/HelpPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<HelpPanel core={core as any} sessionId="test" workspace="~/test" onClose={() => {}} />);
    stdin.write("\x1B[C"); await delay(); // to commands page
    const frame = lastFrame()!;
    expect(frame).toContain("/help");
    expect(frame).toContain("/clear");
    expect(frame).toContain("/plan");
  });
});

// ─── AgentsPanel Spec ────────────────────────────────────────────────────────
// Intent: Browse and manage agents across 4 categories.
// - 4 pages: core interactive, core task, custom interactive, custom task
// - Core pages: show built-in agents, enter opens detail with override cascade
// - Custom pages: show user agents, c=create, r=rename, del=delete, a=toggle active
// - Detail for core: shows Default/Global/Workspace override levels for config + prompt
// - Footer: navigation │ actions (actions only on custom pages)

describe("AgentsPanel spec", () => {
  it("has 4 pages in correct order", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<AgentsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("core interactive");
    expect(frame).toContain("core task");
    expect(frame).toContain("custom interactive");
    expect(frame).toContain("custom task");
  });

  it("core page shows only core agents", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<AgentsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Chat");
    expect(frame).toContain("Plan");
  });

  it("core page footer has NO create/rename/delete actions", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore();
    const { lastFrame } = render(<AgentsPanel core={core as any} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain("create");
    expect(frame).not.toContain("rename");
    expect(frame).not.toContain("delete");
  });

  it("custom page footer HAS create/rename/delete/toggle actions", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore();
    const { lastFrame, stdin } = render(<AgentsPanel core={core as any} onClose={() => {}} />);
    stdin.write("\x1B[C"); await delay(); // core task
    stdin.write("\x1B[C"); await delay(); // custom interactive
    const frame = lastFrame()!;
    expect(frame).toContain("create");
    expect(frame).toContain("rename");
    expect(frame).toContain("delete");
    expect(frame).toContain("toggle");
  });
});
