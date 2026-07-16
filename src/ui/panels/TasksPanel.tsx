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
      })),
      cursor: false,
    },
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
