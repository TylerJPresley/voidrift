import React from "react";
import { Text, Box } from "ink";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { TUIMessage } from "./state.js";
import { ToolCall } from "./ToolCall.js";

// Configure marked for terminal output
marked.use(markedTerminal({ reflowText: true, width: (process.stdout.columns || 80) - 4 }));

function renderMd(text: string): string {
  try {
    return (marked.parse(text) as string).replace(/\n+$/, "");
  } catch {
    return text;
  }
}

export function Message({ msg }: MessageProps) {
  if (msg.role === "operator") {
    return (
      <Box flexDirection="column">
        <Text dimColor>{"─".repeat(process.stdout.columns || 80)}</Text>
        {msg.text.split("\n").map((line, i) => (
          <Text key={i}><Text color="#4ec9b0">┃ </Text><Text bold color="white">{line}</Text></Text>
        ))}
      </Box>
    );
  }

  if (msg.role === "tool") {
    return <ToolCall toolName={msg.toolName ?? ""} action={msg.toolAction} detail={msg.text} />;
  }

  if (msg.role === "diff") {
    return (
      <Box flexDirection="column">
        <Text dimColor>  {msg.toolName}</Text>
        {msg.text.split("\n").map((line, i) => {
          if (line.startsWith("+")) return <Text key={i} color="#98c379">  {line}</Text>;
          if (line.startsWith("-")) return <Text key={i} color="#e06c75">  {line}</Text>;
          return <Text key={i} dimColor>  {line}</Text>;
        })}
      </Box>
    );
  }

  if (msg.role === "system") {
    return <Text dimColor italic>  {msg.text}</Text>;
  }

  if (msg.role === "model") {
    const rendered = msg.text?.trim() ? renderMd(msg.text) : "";
    const lines = rendered ? rendered.split("\n") : [];
    return (
      <Box flexDirection="column">
        <Text> </Text>
        {lines.map((line, i) => (
          <Text key={i}><Text color="#6a7ec8">┃ </Text>{line}</Text>
        ))}
        {msg.streaming && <Text><Text color="#6a7ec8">┃ </Text><Text color="#6a7ec8">█</Text></Text>}
        {!msg.streaming && msg.stats ? <Text dimColor>  · {msg.stats}</Text> : null}
      </Box>
    );
  }

  return null;
}

interface MessageProps {
  msg: TUIMessage;
}
