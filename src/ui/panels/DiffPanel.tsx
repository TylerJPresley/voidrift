import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import type { CoreAPI } from "../../plugins/interface.js";

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  lines: string[];
}

function parseDiffByFile(rawLines: string[]): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  for (const line of rawLines) {
    if (line.startsWith("diff --git")) {
      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      const path = match ? match[1] : line;
      current = { path, additions: 0, deletions: 0, lines: [] };
      files.push(current);
    } else if (current) {
      current.lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) current.additions++;
      if (line.startsWith("-") && !line.startsWith("---")) current.deletions++;
    }
  }

  return files;
}

export function DiffPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const rawLines = useMemo(() => core.workspace.diff(), []);
  const files = useMemo(() => parseDiffByFile(rawLines), [rawLines]);
  const [cursor, setCursor] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 8;

  useInput((_, key) => {
    if (selectedFile) {
      if (key.escape) { setSelectedFile(null); return; }
      return; // ScrollView handles up/down
    }
    if (key.escape) { onClose(); return; }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(files.length - 1, c + 1));
    if (key.return && files[cursor]) setSelectedFile(files[cursor].path);
  });

  // ─── File Diff View ───
  if (selectedFile) {
    const file = files.find(f => f.path === selectedFile);
    if (!file) { setSelectedFile(null); return null; }

    const diffLines = file.lines.map((line, i) => {
      const color = line.startsWith("+") && !line.startsWith("+++") ? "green"
        : line.startsWith("-") && !line.startsWith("---") ? "red"
        : line.startsWith("@@") ? "cyan"
        : undefined;
      return <Text key={i} color={color}>{line || " "}</Text>;
    });

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Diff <Text dimColor>›</Text> {selectedFile} <Text dimColor>(+{file.additions} -{file.deletions})</Text></Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <ScrollView height={viewHeight} lines={diffLines} />
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>pgup/pgdn</Text> Page  <Text color="#61afef" bold>esc</Text> Back</Text>
      </Box>
    );
  }

  // ─── File List View ───
  if (files.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Diff</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text dimColor>No uncommitted changes.</Text>
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
      </Box>
    );
  }

  const maxPath = Math.max(...files.map(f => f.path.length), 10);
  const fileRows = files.map((f, i) => (
    <Text key={f.path}>
      <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
      <Text bold color="#61afef">{f.path.padEnd(Math.min(maxPath + 2, 50))}</Text>
      <Text color="green">{`+${f.additions}`.padEnd(6)}</Text>
      <Text color="red">{`-${f.deletions}`}</Text>
    </Text>
  ));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Diff <Text dimColor>({files.length} files)</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {fileRows}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> View diff  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
