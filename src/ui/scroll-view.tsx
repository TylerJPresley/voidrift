/**
 * ScrollView — fixed-height scrollable content area.
 *
 * Renders exactly `height` rows by slicing children and padding with empty lines.
 * Manages its own scroll state. Parent calls useScrollView() for the hook,
 * passes the props to <ScrollView>.
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface ScrollViewProps {
  /** Fixed number of visible rows */
  height: number;
  /** Array of content lines (strings or ReactNodes) */
  lines: React.ReactNode[];
  /** Whether this component should capture keyboard input for scrolling */
  active?: boolean;
}

export interface ScrollState {
  scroll: number;
  maxScroll: number;
  viewHeight: number;
  totalLines: number;
}

export function ScrollView({ height, lines, active = true }: ScrollViewProps) {
  const [scroll, setScroll] = useState(0);
  const maxScroll = Math.max(0, lines.length - height);

  useInput((_, key) => {
    if (!active) return;
    if (key.upArrow) setScroll(s => Math.max(0, s - 1));
    if (key.downArrow) setScroll(s => Math.min(maxScroll, s + 1));
    if (key.pageDown) setScroll(s => Math.min(maxScroll, s + height));
    if (key.pageUp) setScroll(s => Math.max(0, s - height));
  });

  const clamped = Math.min(scroll, maxScroll);
  const visible = lines.slice(clamped, clamped + height);
  const padCount = Math.max(0, height - visible.length);

  return (
    <Box flexDirection="column">
      {visible.map((line, i) => (
        <Box key={clamped + i} width="100%" height={1} overflow="hidden">
          {typeof line === "string" ? <Text wrap="truncate">{line || " "}</Text> : <Text wrap="truncate">{line}</Text>}
        </Box>
      ))}
      {Array.from({ length: padCount }, (_, i) => <Text key={`pad-${i}`}>{" "}</Text>)}
    </Box>
  );
}
