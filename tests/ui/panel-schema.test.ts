import { describe, it, expect } from "vitest";
import type { PanelSchema, ActionContext } from "../../src/ui/panel-schema.js";

describe("PanelSchema", () => {
  it("defines a valid list panel", () => {
    const schema: PanelSchema = {
      id: "test",
      title: "Test Panel",
      layout: {
        type: "list",
        columns: [
          { key: "name", label: "Name", width: 20 },
          { key: "value", label: "Value" },
        ],
        getItems: () => [
          { name: "item1", value: "val1" },
          { name: "item2", value: "val2" },
        ],
        cursor: true,
      },
    };
    expect(schema.layout.type).toBe("list");
    const items = (schema.layout as any).getItems();
    expect(items).toHaveLength(2);
  });

  it("defines a valid text panel with pages", () => {
    const schema: PanelSchema = {
      id: "help",
      title: "Help",
      pages: ["general", "commands"],
      layout: {
        type: "text",
        getContent: (page) => page === "general" ? "Welcome" : "Commands here",
      },
    };
    expect(schema.pages).toHaveLength(2);
    expect((schema.layout as any).getContent("general")).toBe("Welcome");
  });

  it("defines actions with prompt capability", async () => {
    let captured = "";
    const schema: PanelSchema = {
      id: "crud",
      title: "CRUD Panel",
      layout: { type: "list", columns: [{ key: "name", label: "Name" }], getItems: () => [], cursor: true },
      actions: [
        {
          key: "c",
          label: "Create",
          handler: async (item, page, ctx) => {
            const name = await ctx!.prompt("Enter name:");
            if (name) captured = name;
          },
        },
      ],
    };

    // Simulate: action handler calls prompt, gets resolved
    const mockCtx: ActionContext = {
      close: () => {},
      refresh: () => {},
      setMessage: () => {},
      prompt: async (placeholder) => "test-input",
    };

    await schema.actions![0].handler(undefined, undefined, mockCtx);
    expect(captured).toBe("test-input");
  });

  it("defines detail view with actions", () => {
    const schema: PanelSchema = {
      id: "detail-test",
      title: "Detail Test",
      layout: { type: "list", columns: [{ key: "id", label: "ID" }], getItems: () => [{ id: "1" }], cursor: true },
      detail: {
        getTitle: (item) => `Item ${item.id}`,
        layout: { type: "keyvalue", getEntries: () => [{ label: "ID", value: "1" }] },
        actions: [
          { key: "d", label: "Delete", handler: (item) => {} },
        ],
      },
    };
    expect(schema.detail!.getTitle({ id: "42" })).toBe("Item 42");
    expect(schema.detail!.actions).toHaveLength(1);
  });

  it("defines scroll layout", () => {
    const schema: PanelSchema = {
      id: "logs",
      title: "Logs",
      layout: {
        type: "scroll",
        getLines: () => [
          { text: "Line 1", color: "green" },
          { text: "Line 2" },
        ],
      },
    };
    expect((schema.layout as any).getLines()).toHaveLength(2);
  });

  it("defines locations", () => {
    const schema: PanelSchema = {
      id: "located",
      title: "Located",
      layout: { type: "text", getContent: () => "content" },
      locations: [
        { label: "Workspace", path: ".voidrift/thing/" },
        { label: "Global", path: "~/.config/voidrift/thing/" },
      ],
    };
    expect(schema.locations).toHaveLength(2);
  });
});
