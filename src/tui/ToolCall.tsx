import React from "react";
import { Text } from "ink";

interface ToolCallProps {
  toolName: string;
  action?: string;
  detail?: string;
}

const ACTION_STYLES: Record<string, { color: string; label: string }> = {
  read: { color: "#61afef", label: "Read" },
  list: { color: "#61afef", label: "List" },
  write: { color: "#98c379", label: "Write" },
  edit: { color: "#56b6c2", label: "Edit" },
  delete: { color: "#e06c75", label: "Delete" },
};

const TOOL_STYLES: Record<string, { color: string; label: string }> = {
  shell: { color: "#e5c07b", label: "Shell" },
  http: { color: "#4ec9b0", label: "HTTP" },
  skill: { color: "#888888", label: "Skill" },
  memory: { color: "#888888", label: "Memory" },
  session: { color: "#888888", label: "Session" },
  analyze: { color: "#61afef", label: "Analyze" },
  ask: { color: "#e5c07b", label: "Ask" },
};

export function ToolCall({ toolName, action, detail }: ToolCallProps) {
  // File tool — use action-based styling
  if (toolName === "file" && action && ACTION_STYLES[action]) {
    const style = ACTION_STYLES[action];
    return (
      <Text>
        <Text color={style.color}>┃ </Text>
        <Text color={style.color} bold>{style.label}</Text>
        {detail ? <Text dimColor>  {detail}</Text> : null}
      </Text>
    );
  }

  // HTTP with method
  if (toolName === "http" && action) {
    return (
      <Text>
        <Text color="#4ec9b0">┃ </Text>
        <Text color="#4ec9b0" bold>HTTP {action.toUpperCase()}</Text>
        {detail ? <Text dimColor>  {detail}</Text> : null}
      </Text>
    );
  }

  // Other tools
  const style = TOOL_STYLES[toolName] ?? { color: "#888888", label: toolName };
  return (
    <Text>
      <Text color={style.color}>┃ </Text>
      <Text color={style.color} bold>{style.label}</Text>
      {detail ? <Text dimColor>  {detail}</Text> : null}
    </Text>
  );
}
