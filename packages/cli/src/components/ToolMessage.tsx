import React from "react";
import { Box, Text } from "ink";
import { ToolElapsedTime } from "./ToolElapsedTime.js";

export type ToolStatus = "pending" | "executing" | "success" | "error" | "denied";

const STATUS_ICONS: Record<ToolStatus, { icon: string; color: string }> = {
  pending: { icon: "○", color: "yellow" },
  executing: { icon: "⠹", color: "yellow" },
  success: { icon: "✓", color: "green" },
  error: { icon: "✗", color: "red" },
  denied: { icon: "⊘", color: "yellow" },
};

export interface ToolCallData {
  id: string;
  name: string;
  keyArg: string;
  status: ToolStatus;
  startTime?: number;
  elapsed?: string;
  result?: string;
  error?: string;
}

function truncateResult(result: string, maxLines: number = 6): string {
  const lines = result.split("\n");
  if (lines.length <= maxLines) return result;
  return lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`;
}

export function ToolMessage({ tool }: { tool: ToolCallData }) {
  const { icon, color } = STATUS_ICONS[tool.status];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold>{icon} </Text>
        <Text color="#61afef" bold>{tool.name}</Text>
        <Text dimColor>  {tool.keyArg}</Text>
        <Text> </Text>
        {tool.status === "executing" && tool.startTime && (
          <ToolElapsedTime startTime={tool.startTime} />
        )}
        {tool.elapsed && tool.status !== "executing" && (
          <Text dimColor>{tool.elapsed}</Text>
        )}
      </Box>
      {tool.result && tool.status === "success" && (
        <Box marginLeft={3} flexDirection="column">
          <Text dimColor>{truncateResult(tool.result)}</Text>
        </Box>
      )}
      {tool.error && (
        <Box marginLeft={3}>
          <Text color="red">{tool.error}</Text>
        </Box>
      )}
      {tool.status === "denied" && (
        <Box marginLeft={3}>
          <Text color="yellow" dimColor>Denied by user</Text>
        </Box>
      )}
    </Box>
  );
}
