import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function RewindPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const turns = core.models.stats().turns;

  const schema: PanelSchema = {
    id: "rewind",
    title: "Rewind to Turn",
    layout: {
      type: "list",
      columns: [
        { key: "turn", label: "Turn", width: 10 },
        { key: "description", label: "Description" },
      ],
      getItems: () => Array.from({ length: turns }, (_, i) => i + 1).reverse().map(t => ({
        turn: `Turn ${t}`,
        description: t === turns ? "current" : "",
        _turnNumber: String(t),
      })),
      cursor: true,
      dividers: false,
    },
    actions: [
      { key: "enter", label: "Rollback", handler: (item, page, ctx) => {
        if (item) {
          core.session.rewind(parseInt(item._turnNumber));
          ctx!.close();
        }
      }},
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
