import React from "react";
import { Box, Text, useInput } from "ink";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { sanitize } from "../render/theme.js";
import type { WorkerRow } from "../state.js";

/** A worker stream line (§7.2) for the selected worker's live output. */
export interface WorkerStreamLine {
  workerId: string;
  text: string;
}

function statusGlyph(status: string, glyphs: Glyphs): string {
  switch (status) {
    case "running":
      return "●";
    case "succeeded":
    case "merged":
    case "reviewed":
      return glyphs.dot;
    case "failed":
    case "aborted":
      return glyphs.failure;
    case "needs_review":
      return "⏸";
    default:
      return "·";
  }
}

/**
 * The agent monitor (§6.3). Numbers workers 1..N, reflects WORKER_STATUS_CHANGED,
 * shows a permission banner for a worker needing approval, and renders the
 * selected worker's stream. `Escape` closes; number keys select a worker;
 * `Enter` resolves a pending worker's approval through the single-action dialog.
 */
export function AgentMonitor({
  workers,
  selected,
  streamLines,
  onSelect,
  onResolve,
  onClose,
  theme,
  glyphs,
}: {
  workers: WorkerRow[];
  selected: number;
  streamLines: WorkerStreamLine[];
  onSelect: (index: number) => void;
  onResolve: (workerId: string) => void;
  onClose: () => void;
  theme: ThemeTokens;
  glyphs: Glyphs;
}): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "g")) {
      onClose();
      return;
    }
    if (key.return) {
      const w = workers[selected];
      if (w && w.status === "needs_review") onResolve(w.workerId);
      return;
    }
    const n = Number.parseInt(input, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= workers.length) onSelect(n - 1);
  });

  const pending = workers.find((w) => w.status === "needs_review");
  const sel = workers[selected];

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text {...(theme.accent ? { color: theme.accent } : {})}>
        Agents ({workers.length} workers)
      </Text>
      {workers.map((w, i) => (
        <Text key={w.workerId} {...(i === selected && theme.accent ? { color: theme.accent } : {})}>
          {i + 1} {statusGlyph(w.status, glyphs)} {sanitize(w.workerId)} {sanitize(w.status)}
          {w.tool ? ` ⚙ ${sanitize(w.tool)}` : ""}
          {w.status === "needs_review" ? ` ${glyphs.warn}` : ""}
        </Text>
      ))}
      {pending ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>
          worker {workers.indexOf(pending) + 1} needs permission — Enter to resolve
        </Text>
      ) : null}
      {sel ? (
        <Box flexDirection="column">
          <Text {...(theme.dim ? { color: theme.dim } : {})}>[{selected + 1}] live output</Text>
          {streamLines
            .filter((l) => l.workerId === sel.workerId)
            .map((l, i) => (
              <Text key={i}>{sanitize(l.text)}</Text>
            ))}
        </Box>
      ) : null}
    </Box>
  );
}
