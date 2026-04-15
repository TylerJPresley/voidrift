import React from "react";
import { Text, Box } from "ink";
import type { TUIMessage } from "./state.js";
import { ToolCall } from "./ToolCall.js";

interface MessageProps {
  msg: TUIMessage;
}

export function Message({ msg }: MessageProps) {
  if (msg.role === "operator") {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text dimColor>{"─".repeat(72)}</Text>
        {msg.text.split("\n").map((line, i) => (
          <Text key={i}><Text color="#4ec9b0">┃ </Text><Text bold color="white">{line}</Text></Text>
        ))}
        <Text> </Text>
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
    return (
      <Box flexDirection="column">
        {msg.text.split("\n").map((line, i) => (
          <Text key={i}><Text color="#6a7ec8">┃ </Text><Text color="#d4d4d4">{line}</Text></Text>
        ))}
        {msg.streaming && <Text><Text color="#6a7ec8">┃ </Text><Text color="#6a7ec8">█</Text></Text>}
        {msg.stats && (
          <>
            <Text> </Text>
            <Text dimColor>  · {msg.stats}</Text>
          </>
        )}
        <Text> </Text>
      </Box>
    );
  }

  return null;
}
