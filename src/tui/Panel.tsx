import React from "react";
import { Text } from "ink";
import type { PanelState } from "./state.js";

interface PanelProps {
  panel: PanelState;
}

export function Panel({ panel }: PanelProps) {
  const w = process.stdout.columns || 80;
  const border = "─".repeat(Math.max(0, w - panel.title.length - 5));

  return (
    <>
      <Text dimColor>{`╭─ ${panel.title} ${border}╮`}</Text>
      {panel.items.map((item, i) => {
        const sel = i === panel.selectedIndex;
        const prefix = sel ? " ▸ " : "   ";
        const marker = item.marker ? ` ${item.marker}` : "";
        const line = `${prefix}${item.label}${marker}`;
        return sel
          ? <Text key={i} color="#4ec9b0" bold>{line}</Text>
          : <Text key={i}>{line}</Text>;
      })}
      <Text dimColor>{`  ${panel.hint}`}</Text>
      <Text dimColor>{`╰${"─".repeat(w - 2)}╯`}</Text>
    </>
  );
}
