import React from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import { execSync } from "child_process";

export function DiffPanel({ workspaceRoot, onClose }: { workspaceRoot: string; onClose: () => void }) {
  const rawLines = React.useMemo(() => {
    try {
      const raw = execSync("git diff --no-color", { cwd: workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return raw ? raw.split("\n") : [];
    } catch { return []; }
  }, []);

  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 7;

  useInput((_, key) => { if (key.escape) onClose(); });

  const lines = rawLines.length === 0
    ? [<Text key="empty" dimColor>No uncommitted changes.</Text>]
    : rawLines.map((line, i) => {
        const color = line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : line.startsWith("@@") ? "cyan" : undefined;
        return <Text key={i} color={color}>{line || " "}</Text>;
      });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Diff <Text dimColor>({rawLines.length} lines)</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <ScrollView height={viewHeight} lines={lines} />
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>pgup/pgdn</Text> Page  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
