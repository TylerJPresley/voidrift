import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ModelPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const config = core.workspace.config();
  const models = Object.keys(config.models);
  const items = ["auto", ...models];
  const modelData = core.models.list();
  const interactiveSelected = modelData.modelSelected;
  const backgroundSelected = config.modelBackground || "auto";

  const schema: PanelSchema = {
    id: "model",
    title: "Models",
    pages: ["interactive", "background"],
    layout: {
      type: "list",
      columns: [
        { key: "name", label: "Model", width: 22 },
        { key: "tiers", label: "Tiers", width: 10 },
        { key: "detail", label: "Provider / Model" },
      ],
      getItems: (page) => {
        const selected = page === "background" ? backgroundSelected : interactiveSelected;
        return items.map(name => {
          if (name === "auto") {
            return { name: selected === "auto" ? "✓ auto" : "auto", tiers: "", detail: page === "background" ? "tier routing for background tasks" : "model router decides per turn", _raw: "auto" };
          }
          const cfg = config.models[name];
          const tierTags = Object.entries({ flash: config.modelTierFlash, utility: config.modelTierUtility, dense: config.modelTierDense }).filter(([, v]) => v === name).map(([k]) => k[0]).join(",");
          const label = name === selected ? `✓ ${name}` : name;
          return { name: label, tiers: tierTags ? `[${tierTags}]` : "", detail: `${cfg.protocol}/${cfg.model}`, _raw: name };
        });
      },
      cursor: true,
    },
    actions: [
      { key: "enter", label: "Select", handler: (item, page, ctx) => {
        if (!item) return;
        if (page === "background") {
          core.models.switchBackground(item._raw);
          ctx!.close();
        } else {
          core.models.switch({ name: item._raw, tier: undefined });
          ctx!.close();
        }
      }},
      { key: "f", label: "Flash", handler: (item, page, ctx) => {
        if (!item || item._raw === "auto") return;
        config.modelTierFlash = item._raw;
        core.models.persistTiers();
        ctx!.setMessage(`${item._raw} → flash`);
      }},
      { key: "u", label: "Utility", handler: (item, page, ctx) => {
        if (!item || item._raw === "auto") return;
        config.modelTierUtility = item._raw;
        core.models.persistTiers();
        ctx!.setMessage(`${item._raw} → utility`);
      }},
      { key: "d", label: "Dense", handler: (item, page, ctx) => {
        if (!item || item._raw === "auto") return;
        config.modelTierDense = item._raw;
        core.models.persistTiers();
        ctx!.setMessage(`${item._raw} → dense`);
      }},
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
