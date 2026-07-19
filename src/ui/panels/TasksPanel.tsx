import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function TasksPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const schema: PanelSchema = {
    id: "tasks",
    title: "Background Tasks",
    layout: {
      type: "list",
      columns: [
        { key: "id", label: "ID", width: 16 },
        { key: "type", label: "Type", width: 12 },
        { key: "status", label: "Status", width: 12 },
        { key: "instruction", label: "Instruction" },
      ],
      getItems: () => core.workspace.tasks().map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        instruction: t.instruction.slice(0, 60),
        _output: t.output || "",
      })),
      cursor: true,
    },
    detail: {
      getTitle: (item) => item.id,
      layout: (item) => ({
        type: "scroll",
        getLines: () => {
          const task = core.workspace.tasks().find(t => t.id === item.id);
          if (!task) return [{ text: "Task not found." }];
          const lines = [
            { text: `ID:          ${task.id}`, color: "#61afef" },
            { text: `Type:        ${task.type}`, color: "#61afef" },
            { text: `Status:      ${task.status}`, color: "#61afef" },
            { text: `Instruction: ${task.instruction.slice(0, 100)}`, color: "#61afef" },
            { text: "─".repeat(60) },
            { text: "" },
            { text: "Output:" },
          ];
          const output = task.output || "(no output yet)";
          for (const line of output.split("\n")) {
            lines.push({ text: line });
          }
          return lines;
        },
      }),
      actions: [
        { key: "k", label: "Kill all", handler: (item, page, ctx) => { core.workspace.killTasks(); ctx?.refresh(); } },
      ],
    },
    actions: [
      { key: "k", label: "Kill all", handler: (item, page, ctx) => { core.workspace.killTasks(); ctx?.refresh(); } },
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
