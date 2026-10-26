/**
 * §7.1/§7.2 Panel binding (cli-blueprint.md §7.1, §7.2, panels-blueprint §5).
 *
 * Panels ship WITH the CLI (handoff §0.1): the CLI registers its own built-in
 * `PanelDeclaration`s through `register.panel`, reads `registry.panels()` as the
 * source of truth, and `bindPanels` turns each declaration into a `BoundPanel`
 * by reading its `source` DATASET slug(s) through `datasets.rows` (the core
 * shapes every row, §12.7) and binding its action `op`s to handlers. Driven by
 * the scripted real core (fakeModel + in-memory storage) so each dataset is read
 * exactly as production reads it. A plugin-registered declaration binds the same
 * way with no CLI code change.
 */
import { describe, it, expect, vi } from "vitest";
import { bindPanels, runPanelAction } from "./core-client.js";
import { registerBuiltinPanels, BUILTIN_PANELS, slashCommandsDataset } from "./panels/declarations.js";
import { makeHarness, type Harness } from "./test-harness.js";

/** Register the CLI's panels AND its own `slash-commands` dataset, as tui.tsx
 * does (§7.2) — so the Help panel's first source resolves. */
function registerCliSurfaces(harness: Harness): void {
  registerBuiltinPanels((name, def) => harness.ready.api.register.panel(name, def));
  harness.ready.api.register.dataset(
    "slash-commands",
    slashCommandsDataset(async () => {
      const r = await harness.ready.api.session.listCommands();
      return r.ok ? r.value : [];
    }),
  );
}

describe("§7.2 the CLI registers its own built-in declarations", () => {
  it("registerBuiltinPanels installs every built-in through register.panel and registry.panels() returns them", async () => {
    const harness = await makeHarness();
    registerBuiltinPanels((name, def) => harness.ready.api.register.panel(name, def));
    const entries = harness.ready.api.registry.panels();
    const names = entries.map((e) => e.key.slice("panels.".length)).sort();
    expect(new Set(names)).toEqual(new Set(Object.keys(BUILTIN_PANELS)));
  });
});

describe("§7.1 bindPanels against the real core", () => {
  it("binds the built-in set to BoundPanels whose getItems resolve from datasets", async () => {
    const harness = await makeHarness();
    registerCliSurfaces(harness);
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());

    expect(new Set(Object.keys(registry))).toEqual(new Set(Object.keys(BUILTIN_PANELS)));
    for (const [name, panel] of Object.entries(registry)) {
      expect(Array.isArray(panel.getItems()), name).toBe(true);
    }
    // Compliance is one list; its rows carry the `_section` field (pin 8).
    const compliance = registry["compliance"]!.getItems();
    expect(compliance.some((r) => (r as { _section?: string })._section === "status")).toBe(true);
    // The Memory panel is TABBED: Stored (delete) and Suggestions (approve/reject).
    const memPages = registry["memory"]!.pages!;
    expect(memPages.map((p) => p.key)).toEqual(["stored", "suggestions"]);
    expect(Object.keys(memPages[0]!.actions!)).toEqual(["d"]);
    expect(Object.keys(memPages[1]!.actions!)).toEqual(["a", "r"]);
    // Sessions is selectable (it declares a detail view) with a relative-time column.
    expect(registry["sessions"]!.detail).toBeDefined();
    expect(registry["sessions"]!.columns.find((c) => c.key === "lastActiveAt")?.format).toBe("relative-time");
    // Stats is read-only: no actions, no detail → no cursor (pin 3).
    expect(registry["stats"]!.actions).toBeUndefined();
    expect(registry["stats"]!.detail).toBeUndefined();
  });

  it("the Help panel lists the CLI's built-in commands with descriptions, not blank rows (§7.2, pin 9)", async () => {
    const harness = await makeHarness();
    registerCliSurfaces(harness);
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    const rows = registry["help"]!.getItems() as { name: string; description: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const help = rows.find((r) => r.name === "/help");
    expect(help?.description).toBe("Show the command list");
    expect(rows.every((r) => typeof r.name === "string" && r.name.startsWith("/"))).toBe(true);
  });

  it("the Help panel folds a plugin-registered command in beside the built-ins (§7.2, §7.3)", async () => {
    const harness = await makeHarness();
    harness.ready.api.register.command("deploy", "deploy the app", async () => undefined);
    registerCliSurfaces(harness);
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    const rows = registry["help"]!.getItems() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("/deploy");
    expect(rows.map((r) => r.name)).toContain("/help");
  });

  it("columns default from the dataset fields when a declaration omits them (pin 2)", async () => {
    const harness = await makeHarness();
    // A plugin panel that names an existing dataset and declares NO columns.
    harness.ready.api.register.panel("defaulted", { title: "Defaulted", source: "models" });
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    const cols = registry["defaulted"]!.columns.map((c) => c.key);
    expect(cols).toEqual(["name", "model", "protocol", "active"]);
  });

  it("a Memory suggestions action calls exactly one CoreAPI op against the selected row (§1.1)", async () => {
    const harness = await makeHarness();
    const approve = vi.spyOn(harness.ready.api.memory.suggestions, "approve");
    const reject = vi.spyOn(harness.ready.api.memory.suggestions, "reject");
    registerCliSurfaces(harness);
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());

    const row = { kind: "suggestion", title: "note", detail: "pending", id: "s1" };
    const suggestions = registry["memory"]!.pages!.find((p) => p.key === "suggestions")!;
    await suggestions.actions!["a"]!.handler?.(row);
    await suggestions.actions!["r"]!.handler?.(row);
    expect(approve).toHaveBeenCalledWith("s1");
    expect(reject).toHaveBeenCalledWith("s1");
  });

  it("the Memory stored page's delete action calls memory.delete with the row id, and declares confirm (§7.2, pin 6)", async () => {
    const harness = await makeHarness();
    const del = vi.spyOn(harness.ready.api.memory, "delete");
    registerCliSurfaces(harness);
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    const stored = registry["memory"]!.pages!.find((p) => p.key === "stored")!;
    expect(stored.actions!["d"]!.confirm).toBe("Delete this memory entry?");
    await stored.actions!["d"]!.handler?.({ id: "m9", kind: "note", title: "x" });
    expect(del).toHaveBeenCalledWith("m9");
  });

  it("a THIRD-PARTY plugin's panel is listed and renders rows with no CLI change", async () => {
    const harness = await makeHarness();
    await harness.ready.api.session.create();
    // A plugin dataset + a panel sourced from it — the exact first-party mechanism.
    harness.ready.api.register.dataset("my-data", {
      description: "plugin data",
      fields: [{ key: "name", label: "Name" }],
      rows: async () => [{ name: "alpha", id: "s9" }],
    });
    harness.ready.api.register.panel("my-stuff", {
      title: "My Stuff",
      source: "my-data",
      columns: [{ key: "name", label: "Name", width: 18 }],
      actions: { x: { label: "approve", op: "memory.suggestions.approve" } },
    });

    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    expect(registry["my-stuff"]).toBeDefined();
    expect(registry["my-stuff"]!.title).toBe("My Stuff");
    const rows = registry["my-stuff"]!.getItems();
    expect(rows.length).toBe(1);
    expect((rows[0] as { name?: unknown }).name).toBe("alpha");

    const approve = vi.spyOn(harness.ready.api.memory.suggestions, "approve");
    expect(Object.keys(registry["my-stuff"]!.actions!)).toEqual(["x"]);
    await registry["my-stuff"]!.actions!["x"]!.handler?.({ id: "s9" });
    expect(approve).toHaveBeenCalledWith("s9");
  });

  it("an unknown dataset source binds to an empty snapshot (inline error at render), never a throw (§7.1)", async () => {
    const harness = await makeHarness();
    harness.ready.api.register.panel("ghost", { title: "Ghost", source: "no-such-dataset", columns: [{ key: "x", label: "X" }] });
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    expect(registry["ghost"]!.getItems()).toEqual([]);
  });

  it("the MCP panel REFRESHES on RESOURCE_CHANGED and is not a one-shot snapshot (§7.1, pin 10)", async () => {
    const harness = await makeHarness();
    registerCliSurfaces(harness);
    // The CLI reads rows through `datasets.rows` (the core shapes them, §12.7).
    // Drive that seam so we observe the panel re-reading it after an event — the
    // stale-panel bug was that the CLI read once at open.
    const rowsSpy = vi.spyOn(harness.ready.api.datasets, "rows");
    rowsSpy.mockImplementation(async (name: string) =>
      name === "mcp"
        ? ({ ok: true, value: [{ name: "judge", status: "disconnected", toolCount: 0, detail: "", server: "judge" }] } as never)
        : ({ ok: true, value: [] } as never),
    );
    const registry = await bindPanels(harness.ready.api, harness.ready.api.registry.panels());
    const first = registry["mcp"]!.getItems() as { name: string; status: string }[];
    expect(first.find((r) => r.name === "judge")?.status).toBe("disconnected");
    // The server connects in the background and the core emits RESOURCE_CHANGED.
    rowsSpy.mockImplementation(async (name: string) =>
      name === "mcp"
        ? ({ ok: true, value: [
            { name: "judge", status: "connected", toolCount: 1, detail: "", server: "judge" },
            { name: "  mcp_judge_t", status: "pending", toolCount: "", detail: "pending — new tool", server: "judge" },
          ] } as never)
        : ({ ok: true, value: [] } as never),
    );
    harness.emit("RESOURCE_CHANGED", { path: "mcp:judge", type: "mcp" });
    await new Promise((r) => setTimeout(r, 10));
    const after = registry["mcp"]!.getItems() as { name: string; status: string; detail: string }[];
    expect(after.find((r) => r.name === "judge")?.status).toBe("connected");
    const toolRow = after.find((r) => r.name.trim() === "mcp_judge_t");
    expect(toolRow?.status).toBe("pending");
    expect(toolRow?.detail).toContain("new tool");
  });

  it("runPanelAction routes mcp.approve to the row's server, never an id (§7.2)", async () => {
    const harness = await makeHarness();
    const approve = vi.spyOn(harness.ready.api.mcp, "approve").mockResolvedValue({ ok: true, value: {} } as never);
    await runPanelAction(harness.ready.api, "mcp.approve", { name: "  mcp_judge_t", status: "pending", server: "judge" });
    expect(approve).toHaveBeenCalledWith("judge");
  });
});

describe("§7.3 bootCore registers the CLI commands docs", () => {
  it("docs/commands.md equals renderCommandsDoc() byte for byte (drift guard)", async () => {
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { renderCommandsDoc } = await import("./commands-doc.js");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = __filename.split("/").slice(0, -1).join("/");
    const projectRoot = __dirname.split("/").slice(0, -1).join("/");
    const docsPath = `${projectRoot}/docs/commands.md`;
    
    const generated = renderCommandsDoc();
    const onDisk = readFileSync(docsPath, "utf-8");
    
    expect(onDisk, "docs/commands.md is stale — run npm run gen:docs").toBe(generated);
  });

  it("bootCore registers cli/commands through register.docs without throwing", async () => {
    const { bootCore } = await import("./core-client.js");
    const { hermeticTmp } = await import("./test-hermetic.js");
    const { InMemorySessionRepository } = await import("@voidrift/core");
    const { fakeModel } = await import("@langchain/core/testing");
    const { AIMessage } = await import("@langchain/core/messages");

    // Boot a real core with bootCore in a hermetic temp workspace.
    const workspaceRoot = hermeticTmp("bootCore-docs");
    const model = fakeModel().respond(new AIMessage("ok"));
    const ready = await bootCore({
      workspaceRoot,
      configOverrides: {
        models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000 } },
        modelSelected: "test",
      },
      chatModelFactory: () => model,
      sessionRepository: new InMemorySessionRepository(),
      installSignalHandlers: false,
    });

    // Create a session and send one turn to trigger a model call with the head.
    const session = await ready.api.session.create({});
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const sessionId = session.value.id;

    // Send a message to trigger a model call with the head.
    await ready.api.session.send(sessionId, { input: "test", approvalMode: "policy_only" });

    // The model.calls contain the full message history with the head.
    // Assert the head includes the cli/commands manual entry.
    expect(model.calls.length).toBeGreaterThan(0);
    const firstCall = model.calls[0]!;
    const headMessages = firstCall.messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");

    // The Manual section lists each manual with id, summary, and readWhen
    const expectedManualLine = "- cli/commands:";
    expect(headMessages).toContain(expectedManualLine);
  });
});
