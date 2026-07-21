import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ModelPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const config = core.workspace.config();
  const models = Object.keys(config.models);
  const modelData = core.models.list();
  const selected = modelData.modelSelected;
  const escalation = config.modelEscalation || "(none)";
  const utility = config.modelUtility || "(none)";
  const background = config.modelBackground || "(default: selected)";

  const schema: PanelSchema = {
    id: "model",
    title: "Models",
    pages: ["interactive", "background"],
    layout: {
      type: "list",
      columns: [
        { key: "name", label: "Model", width: 22 },
        { key: "roles", label: "Roles", width: 10 },
        { key: "detail", label: "Provider / Model" },
      ],
      getItems: (page) => {
        const currentSelected = page === "background" ? (config.modelBackground || selected) : selected;
        return models.map(name => {
          const cfg = config.models[name];
          const roles: string[] = [];
          if (name === config.modelEscalation) roles.push("e");
          if (name === config.modelUtility) roles.push("u");
          if (name === config.modelBackground) roles.push("b");
          const label = name === currentSelected ? `✓ ${name}` : name;
          return { name: label, roles: roles.length ? roles.join(",") : "", detail: `${cfg.protocol}/${cfg.model}`, _raw: name };
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
      { key: "e", label: "Escalation", handler: (item, page, ctx) => {
        if (!item) return;
        config.modelEscalation = item._raw;
        core.models.persistTiers();
        ctx!.setMessage(`${item._raw} → escalation`);
      }},
      { key: "u", label: "Utility", handler: (item, page, ctx) => {
        if (!item) return;
        config.modelUtility = item._raw;
        core.models.persistTiers();
        ctx!.setMessage(`${item._raw} → utility`);
      }},
      { key: "x", label: "Clear", handler: (item, page, ctx) => {
        if (!item) return;
        if (config.modelEscalation === item._raw) { config.modelEscalation = undefined as any; ctx!.setMessage(`Cleared escalation`); }
        else if (config.modelUtility === item._raw) { config.modelUtility = undefined as any; ctx!.setMessage(`Cleared utility`); }
        else if (config.modelBackground === item._raw) { config.modelBackground = undefined as any; ctx!.setMessage(`Cleared background`); }
        core.models.persistTiers();
      }},
    ],
    footer: `↑↓ navigate  esc Close  │  enter Select  e Escalation  u Utility  x Clear`,
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
