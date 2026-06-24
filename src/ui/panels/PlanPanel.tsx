import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import { openInEditor } from "../../utils/editor.js";
import { join } from "path";
import type { PlanManager } from "../../session/plan.js";
import type { VoidRiftConfig } from "../../config/loader.js";

export function PlanPanel({ planManager, config, onClose }: { planManager: PlanManager; config: VoidRiftConfig; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pages = ["now", "next", "later"] as const;
  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 12;

  const items = planManager.byPriority(pages[page]);

  useInput((ch, key) => {
    if (detail) {
      if (key.escape) { setDetail(null); return; }
      if (ch === "e" && config.editor) {
        openInEditor(join(planManager.dir, detail), config.editor);
        refresh(n => n + 1);
        return;
      }
      if (ch === "n") { planManager.updatePriority(detail, "now"); refresh(n => n + 1); return; }
      if (ch === "x") { planManager.updatePriority(detail, "next"); refresh(n => n + 1); return; }
      if (ch === "l") { planManager.updatePriority(detail, "later"); refresh(n => n + 1); return; }
      return;
    }
    if (key.escape) onClose();
    if (key.leftArrow) { setPage(p => (p - 1 + 3) % 3); setCursor(0); }
    if (key.rightArrow) { setPage(p => (p + 1) % 3); setCursor(0); }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));
    if (key.return && items[cursor]) { setDetail(items[cursor].filename); }
    if (ch === "n" && items[cursor]) { planManager.updatePriority(items[cursor].filename, "now"); refresh(n => n + 1); }
    if (ch === "x" && items[cursor]) { planManager.updatePriority(items[cursor].filename, "next"); refresh(n => n + 1); }
    if (confirmDelete) {
      if (ch === "y") {
        planManager.remove(items[cursor].filename); refresh(n => n + 1);
        setConfirmDelete(false); setMessage(null);
      } else {
        setConfirmDelete(false); setMessage(null);
      }
      return;
    }
    if (ch === "l" && items[cursor]) { planManager.updatePriority(items[cursor].filename, "later"); refresh(n => n + 1); }
    if (key.delete && items[cursor]) { setConfirmDelete(true); setMessage(`Delete "${items[cursor].filename.replace(".md","")}"? (y/n)`); }
  });

  if (detail) {
    const item = planManager.get(detail);
    if (!item) { setDetail(null); return null; }
    const maxWidth = (process.stdout.columns || 80) - 4;
    const wrapLine = (line: string): string[] => {
      if (line.length <= maxWidth) return [line];
      const wrapped: string[] = [];
      for (let i = 0; i < line.length; i += maxWidth) {
        wrapped.push(line.slice(i, i + maxWidth));
      }
      return wrapped;
    };
    const bodyLines = item.body
      ? item.body.split("\n").flatMap(wrapLine).map((line, i) => <Text key={i}>{line || " "}</Text>)
      : [<Text key="empty" dimColor>No details.</Text>];
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Plan <Text dimColor>[{item.priority}]</Text> <Text dimColor>›</Text> {item.filename}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text><Text color="#61afef">{"Priority:".padEnd(14)}</Text>{item.priority}</Text>
        <Text><Text color="#61afef">{"Description:".padEnd(14)}</Text>{item.description}</Text>
        <Text><Text color="#61afef">{"Rationale:".padEnd(14)}</Text>{item.rationale || "—"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <ScrollView height={viewHeight} lines={bodyLines} />
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>esc</Text> Back  │  <Text color="#61afef" bold>n</Text> now  <Text color="#61afef" bold>x</Text> next  <Text color="#61afef" bold>l</Text> later  <Text color="#61afef" bold>e</Text> Edit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Plan</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box>{pages.map((name, i) => (<React.Fragment key={name}><Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${name} ]` : `  ${name}  `}</Text>{i < pages.length - 1 && <Text>  </Text>}</React.Fragment>))}</Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {items.length === 0
        ? <Text dimColor>No items.</Text>
        : items.map((item, i) => (
            <Text key={item.filename}>
              <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
              <Text bold color={i === cursor ? "#4ec9b0" : "#61afef"}>{item.description || item.filename}</Text>
            </Text>
          ))
      }
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> Tab  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>n</Text> now  <Text color="#61afef" bold>x</Text> next  <Text color="#61afef" bold>l</Text> later  <Text color="#61afef" bold>del</Text> Remove</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}
