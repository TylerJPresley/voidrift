import React from "react";
import { Text, Box } from "ink";
import type { TUIState } from "./state.js";
import { ctxIcon, ctxColor as getCtxColor } from "../commands/progress.js";

interface FooterProps {
  state: TUIState;
}

export function Footer({ state }: FooterProps) {
  const { panel } = state;

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
        <Text dimColor>←→ · enter · esc</Text>
      </Box>
    );
  }

  // Normal footer
  const { modelName, contextPct, mode, cwd, branch } = state;

  return (
    <Box>
      <Text color="#4ec9b0">voidrift</Text>
      <Text dimColor> · </Text>
      <Text color="#4ec9b0">{modelName}</Text>
      <Text dimColor> · </Text>
      <Text color={getCtxColor(contextPct)}>{ctxIcon(contextPct)} {contextPct}%</Text>
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
