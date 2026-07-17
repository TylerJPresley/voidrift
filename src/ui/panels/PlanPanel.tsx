import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function PlanPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const planDir = core.plan.dir();

  const schema: PanelSchema = {
    id: "plan",
    title: "Plan",
    pages: ["now", "next", "later", "complete"],
    layout: {
      type: "list",
      columns: [
        { key: "description", label: "Description" },
      ],
      getItems: (page) => core.plan.list().items
        .filter(i => i.priority === page)
        .map(i => ({
          description: i.description || i.filename,
          _filename: i.filename,
        })),
      cursor: true,
    },
    detail: {
      getTitle: (item) => item._filename,
      layout: (item) => ({
        type: "scroll",
        getLines: () => {
          try {
            const plan = core.plan.get(item._filename);
            return [
              { text: `Priority:     ${plan.item.priority}`, color: "#61afef" },
              { text: `Description:  ${plan.item.description}`, color: "#61afef" },
              { text: `Rationale:    ${plan.item.rationale || "—"}`, color: "#61afef" },
              { text: "─".repeat(60) },
              { text: "" },
              ...(plan.item.body || "No details.").split("\n").map(l => ({ text: l })),
            ];
          } catch { return [{ text: "Not found." }]; }
        },
      }),
      actions: [
        { key: "n", label: "now", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "now" }); } },
        { key: "x", label: "next", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "next" }); } },
        { key: "l", label: "later", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "later" }); } },
        { key: "e", label: "Edit", handler: (item) => { if (item) core.editor.open(`${planDir}/${item._filename}`); } },
      ],
    },
    actions: [
      { key: "n", label: "now", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "now" }); } },
      { key: "x", label: "next", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "next" }); } },
      { key: "l", label: "later", handler: (item) => { if (item) core.plan.updatePriority({ filename: item._filename, priority: "later" }); } },
      { key: "r", label: "Run", handler: async (item) => { if (item) await core.session.command("run", ["plan", item._filename.replace(".md", "")]); } },
      { key: "delete", label: "Remove", handler: async (item, page, ctx) => { if (item && ctx) { const answer = await ctx.prompt(`Delete "${item._filename.replace(".md", "")}"? Type "y" to confirm`); if (answer === "y") core.plan.remove(item._filename); else ctx.setMessage("Cancelled."); } } },
    ],
    locations: [
      { label: "Plan dir", path: ".voidrift/plan/" },
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
