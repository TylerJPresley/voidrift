import React from "react";
import { Text } from "ink";

interface ToolCallProps {
  toolName: string;
  action?: string;
  detail?: string;
}

const TOOL_LABELS: Record<string, string> = {
  file: "File",
  shell: "Shell",
  http: "HTTP",
  skill: "Skill",
  memory: "Memory",
  session: "Session",
  analyze: "Analyze",
  ask: "Ask",
  browser: "Browser",
  process: "Process",
};

export function ToolCall({ toolName, action, detail }: ToolCallProps) {
  const label = TOOL_LABELS[toolName] ?? toolName;
  const actionStr = action ? ` ${action}` : "";
  return (
    <Text>
      <Text color="#c678dd" bold>● </Text>
      <Text color="#61afef" bold>{label}{actionStr}</Text>
      {detail ? <Text dimColor>  {detail}</Text> : null}
    </Text>
  );
}
