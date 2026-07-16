import React from "react";
import { Box, Text, useInput } from "ink";

export function GenericPanel({ name, onClose }: { name: string; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Text dimColor>/{name}</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
