import React from "react";
import { Text, Box } from "ink";

interface FooterProps {
  modelName: string;
  contextPct: number;
  mode: string;
  cwd: string;
  branch: string;
}

export function Footer({ modelName, contextPct, mode, cwd, branch }: FooterProps) {
  const ctxColor = contextPct <= 60 ? "#4ec9b0" : contextPct <= 80 ? "#e5c07b" : "#e06c75";

  return (
    <Box>
      <Text color="#4ec9b0">voidrift</Text>
      <Text dimColor> · </Text>
      <Text color="#4ec9b0">{modelName}</Text>
      <Text dimColor> · </Text>
      <Text color={ctxColor}>◎ {contextPct}%</Text>
      {mode ? (
        <>
          <Text dimColor> · </Text>
          <Text color="#e5c07b">{mode}</Text>
        </>
      ) : null}
      <Text>  </Text>
      <Box flexGrow={1} />
      <Text color="#61afef">{cwd}</Text>
      {branch ? (
        <>
          <Text dimColor> · </Text>
          <Text color="#5c8cc8">({branch})</Text>
        </>
      ) : null}
      <Text>  </Text>
    </Box>
  );
}
