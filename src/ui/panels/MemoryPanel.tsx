import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function MemoryPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const schema: PanelSchema = {
    id: "memory",
    title: "Memory",
    layout: {
      type: "list",
      columns: [
        { key: "loaded", label: "Loaded", width: 8 },
        { key: "title", label: "Title" },
      ],
      getItems: () => core.memory.list().memories.map(m => ({
        loaded: m.loaded ? "●" : "",
        title: m.title,
        _id: m.id,
        _scope: m.scope,
        _filePath: m.filePath || "",
      })),
      cursor: true,
    },
    actions: [
      {
        key: "enter",
        label: "Edit",
        handler: (item) => {
          if (!item || !item._filePath) return;
          core.editor.editValidated(item._filePath, "frontmatter");
        },
      },
      {
        key: "l",
        label: "Load",
        handler: (item) => {
          if (!item) return;
          core.memory.load(item._id);
        },
      },
      {
        key: "u",
        label: "Unload",
        handler: (item) => {
          if (!item) return;
          core.memory.unload(item._id);
        },
      },
      {
        key: "delete",
        label: "Delete",
        handler: async (item, page, ctx) => {
          if (!item || !ctx) return;
          const answer = await ctx.prompt(`Delete "${item.title}"? Type "y" to confirm`);
          if (answer === "y") { core.memory.delete(item._id); ctx.refresh(); }
          else ctx.setMessage("Cancelled.");
        },
      },
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
