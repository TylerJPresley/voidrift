import React from "react";
import { Text, Box } from "ink";
import type { PanelState } from "./state.js";

interface FooterProps {
  modelName: string;
  contextPct: number;
  mode: string;
  cwd: string;
  branch: string;
  panel?: PanelState | null;
}

export function Footer({ modelName, contextPct, mode, cwd, branch, panel }: FooterProps) {
  // Panel mode — replace footer content
  if (panel) {
    return (
      <Box>
        {panel.items.map((item, i) => {
          const sel = i === panel.selectedIndex;
          return (
            <React.Fragment key={i}>
              {sel ? <Text color="#4ec9b0" bold> ▸ {item.label} </Text> : <Text dimColor>  {item.label} </Text>}
              {item.marker ? <Text color="#e5c07b">{item.marker} </Text> : null}
            </React.Fragment>
          );
        })}
        <Box flexGrow={1} />
        <Text dimColor>←→ navigate · enter select · esc cancel</Text>
      </Box>
    );
  }

  // Normal footer
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
          <Text color="#c678dd">({branch})</Text>
        </>
      ) : null}
      <Text>  </Text>
    </Box>
  );
}
