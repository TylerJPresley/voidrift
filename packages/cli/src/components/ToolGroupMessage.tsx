import React from "react";
import { Box } from "ink";
import { ToolMessage, type ToolCallData } from "./ToolMessage.js";

function getBorderColor(tools: ToolCallData[]): string {
  if (tools.some(t => t.status === "executing" || t.status === "pending")) return "#e5c07b";
  if (tools.some(t => t.status === "error")) return "#e06c75";
  return "#5a6aa8";
}

export function ToolGroupMessage({ tools }: { tools: ToolCallData[] }) {
  const borderColor = getBorderColor(tools);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginLeft={1}
      marginTop={1}
    >
      {tools.map(tool => (
        <ToolMessage key={tool.id} tool={tool} />
      ))}
    </Box>
  );
}
