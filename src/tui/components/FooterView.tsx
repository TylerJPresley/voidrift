import React from "react";
import { Text, Box } from "ink";
import type { FooterRegion } from "../regions/FooterRegion.js";
import { useRegion } from "../useRegion.js";
import { ctxIcon, ctxColor as getCtxColor } from "../../commands/progress.js";

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
  const ctxColorVal = getCtxColor(region.contextPct);
  const govTokensK = (region.governanceTokens / 1000).toFixed(1).replace(/\.0$/, "");
  const govMaxK = (region.governanceMax / 1000).toFixed(0);
  const showGov = region.mode !== "/bare" && region.governanceMax > 0;
  return (
    <Box>
      <Text color="#4ec9b0">voidrift</Text>
      <Text dimColor> · </Text>
      <Text color="#4ec9b0">{region.modelName}</Text>
      <Text dimColor> · </Text>
      <Text color={ctxColorVal}>{ctxIcon(region.contextPct)} {region.contextPct}%</Text>
      <Text dimColor> · </Text>
      <Text color="#e5c07b">{region.mode || "/chat"}</Text>
      {showGov ? (<Text dimColor> 🛡  {govTokensK}k/{govMaxK}k</Text>) : null}
      <Text>  </Text>
      <Box flexGrow={1} />
      <Text color="#61afef">{region.cwd}</Text>
      {region.branch ? (<><Text dimColor> · </Text><Text color="#c678dd">({region.branch})</Text></>) : null}
      <Text>  </Text>
    </Box>
  );
}
