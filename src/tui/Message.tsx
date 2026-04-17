import React from "react";
import { Text, Box } from "ink";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { TUIMessage } from "./state.js";
import { ToolCall } from "./ToolCall.js";

interface MessageProps {
  msg: TUIMessage;
}

// Configure marked for terminal output
marked.use(markedTerminal({ reflowText: true, showSectionPrefix: false, width: (process.stdout.columns || 80) - 4 }));

/** Post-process to fix inline markdown that marked-terminal misses (e.g. inside list items) */
function fixLeftoverMd(text: string): string {
  // Bold: **text** → ANSI bold
  text = text.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[22m");
  // Inline code: `text` → ANSI yellow
  text = text.replace(/`([^`]+)`/g, "\x1b[33m$1\x1b[39m");
  return text;
}

function renderMd(text: string): string {
  try {
    const result = (marked.parse(text) as string).replace(/\n+$/, "");
    return fixLeftoverMd(result);
  } catch {
    return text;
  }
}

export function Message({ msg }: MessageProps) {
  if (msg.role === "operator") {
    return (
      <Box flexDirection="column">
        <Text> </Text>
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
    const lines = msg.text.split("\n");
    return (
      <Box flexDirection="column">
        <Text> </Text>
        {lines.map((line, i) => (
          <Text key={i}><Text color="#555555">┃ </Text><Text dimColor>{line}</Text></Text>
        ))}
      </Box>
    );
  }

  if (msg.role === "model") {
    const rendered = msg.text?.trim() ? renderMd(msg.text.trim()) : "";
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
