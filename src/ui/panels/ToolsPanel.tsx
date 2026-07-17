import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ToolsPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const agentName = core.agents.list().agents.find(a => a.active)?.name ?? "Chat";
  const toolsData = core.tools.list();

  const schema: PanelSchema = {
    id: "tools",
    title: `Tools (${agentName})`,
    pages: [`core (${toolsData.core.length})`, `mcp (${toolsData.mcp.length})`],
    layout: {
      type: "list",
      columns: [
        { key: "name", label: "Name", width: 22 },
        { key: "approval", label: "Approval", width: 12 },
        { key: "description", label: "Description" },
      ],
      getItems: (page) => {
        if (page?.startsWith("mcp")) {
          return toolsData.mcp.map(t => ({
            name: t.name,
            approval: "mcp",
            description: t.description,
            _fullName: t.fullName,
            _server: t.server,
            _schema: t.inputSchema,
          }));
        }
        return toolsData.core.map(t => ({
          name: t.name,
          approval: t.approval,
          description: t.description,
          _params: t.parameters.map((p: any) => `${p.name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`).join("\n"),
        }));
      },
      cursor: true,
    },
    detail: {
      getTitle: (item) => item.name,
      layout: (item) => ({
        type: "scroll",
        getLines: () => {
          if (item._server) {
            return [
              { text: `Name:       ${item._fullName}`, color: "#61afef" },
              { text: `Server:     ${item._server}`, color: "#61afef" },
              { text: `Description: ${item.description}`, color: "#61afef" },
              { text: "" },
              { text: "Input Schema:" },
              ...item._schema.split("\n").map((l: string) => ({ text: `  ${l}` })),
            ];
          }
          return [
            { text: `Name:        ${item.name}`, color: "#61afef" },
            { text: `Approval:    ${item.approval}`, color: "#61afef" },
            { text: `Description: ${item.description}`, color: "#61afef" },
            { text: "" },
            { text: "Parameters:" },
            ...(item._params || "none").split("\n").map((l: string) => ({ text: `  ${l}` })),
          ];
        },
      }),
    },
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
