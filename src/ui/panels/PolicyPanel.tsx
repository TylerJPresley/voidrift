import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function PolicyPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const schema: PanelSchema = {
    id: "policy",
    title: "Policy Rules",
    layout: {
      type: "list",
      columns: [
        { key: "decision", label: "Decision", width: 10 },
        { key: "tool", label: "Tool", width: 18 },
        { key: "pattern", label: "Pattern", width: 25 },
        { key: "source", label: "Source", width: 12 },
        { key: "label", label: "Label" },
      ],
      getItems: () => core.policy.list().map(r => ({
        decision: r.decision,
        tool: r.tool,
        pattern: r.pattern || "*",
        source: r.source,
        label: r.label || "",
      })),
      cursor: false,
    },
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
