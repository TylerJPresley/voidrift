import React from "react";
import { Box, Text } from "ink";
import type { PanelState } from "./state.js";

interface PanelProps {
  panel: PanelState;
}

export function Panel({ panel }: PanelProps) {
  const w = process.stdout.columns || 80;
  const border = "─".repeat(Math.max(0, w - panel.title.length - 5));

  const lines: string[] = [];
  lines.push(`╭─ ${panel.title} ${border}╮`);
  for (let i = 0; i < panel.items.length; i++) {
    const item = panel.items[i];
    const sel = i === panel.selectedIndex;
    const prefix = sel ? " ▸ " : "   ";
    const marker = item.marker ? ` ${item.marker}` : "";
    lines.push(`${prefix}${item.label}${marker}`);
  }
  lines.push(`  ${panel.hint}`);
  lines.push(`╰${"─".repeat(w - 2)}╯`);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={`panel-${i}`} color={i > 0 && i <= panel.items.length && i - 1 === panel.selectedIndex ? "#4ec9b0" : "#888888"}>{line}</Text>
      ))}
    </Box>
  );
}
