import React from "react";
import { Text, Box } from "ink";
import type { FooterRegion } from "../regions/FooterRegion.js";
import { useRegion } from "../useRegion.js";

export function FooterView({ region }: { region: FooterRegion }) {
  useRegion(region);

  // Panel mode — footer becomes interactive selector
  if (region.panel) {
    const p = region.panel;
    return (
      <Box>
        {p.items.map((item, i) => {
          const sel = i === p.selectedIndex;
          return (
            <React.Fragment key={i}>
              {sel
                ? <Text color="#4ec9b0" bold> ▸ {item.label} </Text>
                : <Text dimColor>  {item.label} </Text>}
              {item.marker ? <Text color="#e5c07b">{item.marker} </Text> : null}
            </React.Fragment>
          );
        })}
        <Box flexGrow={1} />
        <Text dimColor>{p.hint || "←→ · enter · esc"}</Text>
      </Box>
    );
  }

  // Normal status bar
  const ctxColor = region.contextPct <= 60 ? "#4ec9b0" : region.contextPct <= 80 ? "#e5c07b" : "#e06c75";
  return (
    <Box>
      <Text color="#4ec9b0">voidrift</Text>
      <Text dimColor> · </Text>
      <Text color="#4ec9b0">{region.modelName}</Text>
      <Text dimColor> · </Text>
      <Text color={ctxColor}>◎ {region.contextPct}%</Text>
      {region.mode ? (<><Text dimColor> · </Text><Text color="#e5c07b">{region.mode}</Text></>) : null}
      <Text>  </Text>
      <Box flexGrow={1} />
      <Text color="#61afef">{region.cwd}</Text>
      {region.branch ? (<><Text dimColor> · </Text><Text color="#c678dd">({region.branch})</Text></>) : null}
      <Text>  </Text>
    </Box>
  );
}
