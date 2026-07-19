import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function RoutinesPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const schema: PanelSchema = {
    id: "routines",
    title: "Routines",
    layout: {
      type: "list",
      columns: [
        { key: "name", label: "Name", width: 22 },
        { key: "description", label: "Description" },
      ],
      getItems: () => core.routines.list().map(r => ({
        name: r.filename.replace(".md", ""),
        description: r.description,
        _filename: r.filename,
      })),
      cursor: true,
    },
    detail: {
      getTitle: (item) => item.name,
      layout: (item) => ({
        type: "scroll",
        getLines: () => {
          try {
            const routine = core.routines.get(item._filename);
            return [
              { text: `Description:  ${routine.description}`, color: "#61afef" },
              { text: "─".repeat(60) },
              { text: "" },
              ...(routine.body || "No steps defined.").split("\n").map(l => ({ text: l })),
            ];
          } catch { return [{ text: "Not found." }]; }
        },
      }),
      actions: [
        { key: "r", label: "Run", handler: async (item, page, ctx) => {
          if (item) {
            ctx?.close();
            core.events.emit("USER_INPUT", { text: `/run routine ${item.name}` });
          }
        }},
        { key: "e", label: "Edit", handler: (item) => {
          if (item) core.editor.open(`${core.routines.dir()}/${item._filename}`);
        }},
        { key: "delete", label: "Delete", handler: async (item, page, ctx) => {
          if (item && ctx) {
            const answer = await ctx.prompt(`Delete "${item.name}"? Type "y" to confirm`);
            if (answer === "y") { core.routines.remove(item._filename); ctx.refresh(); }
            else ctx.setMessage("Cancelled.");
          }
        }},
      ],
    },
    actions: [
      { key: "r", label: "Run", handler: async (item, page, ctx) => {
        if (item) {
          ctx?.close();
          core.events.emit("USER_INPUT", { text: `/run routine ${item.name}` });
        }
      }},
      { key: "c", label: "Create", handler: async (item, page, ctx) => {
        if (!ctx) return;
        const name = await ctx.prompt("Routine name (lower-case, hyphens):");
        if (!name) return;
        core.routines.add(name, "");
        core.editor.open(`${core.routines.dir()}/${name}.md`);
        ctx.refresh();
      }},
      { key: "delete", label: "Delete", handler: async (item, page, ctx) => {
        if (item && ctx) {
          const answer = await ctx.prompt(`Delete "${item.name}"? Type "y" to confirm`);
          if (answer === "y") { core.routines.remove(item._filename); ctx.refresh(); }
          else ctx.setMessage("Cancelled.");
        }
      }},
    ],
    locations: [
      { label: "Workspace", path: ".voidrift/routines/" },
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
