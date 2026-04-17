import React from "react";
import { Box, Text } from "ink";
import type { PanelState } from "./state.js";

interface PanelProps {
  panel: PanelState;
}

export function Panel({ panel }: PanelProps) {
  const w = process.stdout.columns || 80;
  const inner = w - 4;

  return (
    <Box flexDirection="column">
      <Text dimColor>{"╭─ " + panel.title + " " + "─".repeat(Math.max(0, inner - panel.title.length - 2)) + "╮"}</Text>
      {panel.items.map((item, i) => {
        const selected = i === panel.selectedIndex;
        const prefix = selected ? "▸ " : "  ";
        const marker = item.marker ? ` ${item.marker}` : "";
        return (
          <Text key={i}>
            <Text dimColor>│ </Text>
            <Text color={selected ? "#4ec9b0" : undefined} bold={selected}>{prefix}{item.label}{marker}</Text>
            <Text dimColor> │</Text>
          </Text>
        );
      })}
      <Text dimColor>{"│ " + panel.hint.padEnd(inner) + " │"}</Text>
      <Text dimColor>{"╰" + "─".repeat(w - 2) + "╯"}</Text>
    </Box>
  );
}
