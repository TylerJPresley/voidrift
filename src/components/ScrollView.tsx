import React from "react";
import { Box, Text } from "ink";

/**
 * A viewport-paged scroll view of pre-rendered lines (§4.10). The committed
 * output pane uses it when the user has scrolled up with `PageUp`: it shows a
 * `height`-line window ending `offset` lines above the bottom and a dim
 * `↓ N new lines` indicator while any newer content sits below the window.
 * `PageUp`/`PageDown`/`End` move the window; the App owns `offset` as view
 * state (§1.1) and clamps it.
 */
export function ScrollView({
  lines,
  offset,
  height,
  newLines,
  dim,
}: {
  /** The full set of committed display lines, oldest first. */
  lines: string[];
  /** Lines scrolled up from the bottom (0 = live bottom). */
  offset: number;
  /** Visible window height in lines. */
  height: number;
  /** Count of display LINES below the window since scrolling up — includes the
   * fragments committed while a reply streams (§4.10). */
  newLines: number;
  dim: string | undefined;
}): React.ReactElement {
  const end = Math.max(0, lines.length - offset);
  const start = Math.max(0, end - height);
  const window = lines.slice(start, end);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {window.map((line, i) => (
        <Text key={start + i}>{line === "" ? " " : line}</Text>
      ))}
      {newLines > 0 ? (
        <Text {...(dim ? { color: dim } : {})}>↓ {newLines} new line{newLines === 1 ? "" : "s"} · End to jump</Text>
      ) : null}
    </Box>
  );
}

/** The offset a `PageUp`/`PageDown` advances: one viewport page (§4.10). */
export function pageStep(height: number): number {
  return Math.max(1, height);
}

/** The offset a `Ctrl+U`/`Ctrl+D` advances: half a viewport page (§4.10). */
export function halfPageStep(height: number): number {
  return Math.max(1, Math.floor(height / 2));
}
