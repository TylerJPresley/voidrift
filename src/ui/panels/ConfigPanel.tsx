import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ConfigPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const config = core.workspace.config();

  const schema: PanelSchema = {
    id: "config",
    title: "Configuration",
    layout: {
      type: "list",
      columns: [
        { key: "scope", label: "Scope", width: 12 },
        { key: "path", label: "Path" },
      ],
      getItems: () => [
        { scope: "Global", path: "~/.config/voidrift/config.json", _scope: "global" },
        { scope: "Workspace", path: "./.voidrift/config.json", _scope: "workspace" },
      ],
      cursor: true,
      dividers: false,
    },
    actions: [
      {
        key: "enter",
        label: "Edit",
        handler: (item) => {
          if (!item) return;
          if (!core.editor.hasEditor()) return;
          const scope = item._scope as "global" | "workspace";
          const paths = core.workspace.configPaths();
          const path = scope === "global" ? paths.global : paths.workspace;
          const result = core.editor.editValidated(path, "json");
          // Config changes apply on next restart (validated before save)
        },
      },
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
