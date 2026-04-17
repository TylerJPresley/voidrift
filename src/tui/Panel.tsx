import React from "react";
import { Box, Text } from "ink";
import type { PanelState } from "./state.js";

interface PanelProps {
  panel: PanelState;
}

export function Panel({ panel }: PanelProps) {
  const w = process.stdout.columns || 80;
  const cols = w > 60 ? 2 : 1;
  const colWidth = Math.floor((w - 6) / cols);

  // Build rows — 2-column layout for model/permission, single for settings
  const rows: Array<string[]> = [];
  if (cols === 2 && panel.type !== "settings") {
    for (let i = 0; i < panel.items.length; i += 2) {
      rows.push([
        formatItem(panel.items[i], i, panel.selectedIndex, colWidth),
        i + 1 < panel.items.length ? formatItem(panel.items[i + 1], i + 1, panel.selectedIndex, colWidth) : "",
      ]);
    }
  } else {
    for (let i = 0; i < panel.items.length; i++) {
      rows.push([formatItem(panel.items[i], i, panel.selectedIndex, w - 6)]);
    }
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{"╭─ " + panel.title + " " + "─".repeat(Math.max(0, w - panel.title.length - 5)) + "╮"}</Text>
      {rows.map((row, i) => (
        <Text key={i}>
          <Text dimColor>│ </Text>
          {row.join("  ")}
          <Text dimColor> │</Text>
        </Text>
      ))}
      <Text dimColor>│ <Text dimColor italic>{panel.hint}</Text>{" ".repeat(Math.max(0, w - panel.hint.length - 5))}<Text dimColor> │</Text></Text>
      <Text dimColor>{"╰" + "─".repeat(w - 2) + "╯"}</Text>
    </Box>
  );
}

function formatItem(item: { label: string; value: string; marker?: string }, index: number, selected: number, width: number): string {
  const prefix = index === selected ? "▸ " : "  ";
  const marker = item.marker ? ` ${item.marker}` : "";
  const text = `${prefix}${item.label}${marker}`;
  return text.padEnd(width);
}
