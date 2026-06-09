import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";

export function RewindPanel({ turns, onRewind, onClose }: { turns: number; onRewind: (turn: number) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(turns);
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.min(turns, s + 1));
    if (key.downArrow) setSelected((s) => Math.max(1, s - 1));
    if (key.return) { onRewind(selected); onClose(); }
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Rewind to Turn</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Table
        columns={[
          { key: "turn", label: "Turn", width: 10 },
          { key: "description", label: "Description" },
        ]}
        rows={Array.from({ length: turns }, (_, i) => i + 1).reverse().map(t => ({
          turn: `Turn ${t}`,
          description: t === turns ? "current" : "",
        }))}
        cursor={turns - selected}
        dividers={false}
      />
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Rollback  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
