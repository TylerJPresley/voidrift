import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function PromptsPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const prompts = { list: () => core.prompts.list().prompts.map(p => ({ key: p.key, label: p.label, description: p.description, sourcePlugin: p.source })), resolve: (key: string) => { try { const r = core.prompts.get(key); return { body: r.content, source: r.source }; } catch { return null; } }, createOverride: (key: string, scope: any) => core.prompts.createOverride(key, scope) };
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const entries = prompts.list();

  useInput((_, key) => {
    if (detail) {
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); return; }
      if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setDetailCursor(c => Math.min(2, c + 1));
      if (key.return) {
        if (detailCursor === 0) {
          // View default (built-in) — read-only
          const resolved = prompts.resolve(detail!);
          if (!resolved) return;
          const result = core.editor.viewReadonly(resolved.body, `${detail!.replace(/\//g, "_")}_prompt.md`);
          setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "No editor configured");
        } else {
          const scope = detailCursor === 1 ? "global" : "workspace";
          const path = prompts.createOverride(detail!, scope as any);
          if (path) {
            const result = core.editor.editValidated(path, "prompt");
            setMessage(result.success ? (result.changed ? `Edited: ${core.workspace.shortenPath(path)}` : "No changes.") : result.error || "Failed");
          }
        }
      }
      return;
    }

    if (key.escape) onClose();
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(entries.length - 1, c + 1));
    if (key.return && entries[cursor]) { setDetail(entries[cursor].key); setDetailCursor(0); setMessage(null); }
  });

  // ─── Detail View ───
  if (detail) {
    const entry = entries.find(e => e.key === detail);
    const resolved = prompts.resolve(detail);
    const wsPath = `.voidrift/prompts/${detail}.md`;
    const globalPath = `~/.config/voidrift/prompts/${detail}.md`;
    const activeLevel = resolved?.source || "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)" },
      { level: "Global", active: activeLevel === "global", path: activeLevel === "global" ? globalPath : undefined },
      { level: "Workspace", active: activeLevel === "workspace", path: activeLevel === "workspace" ? wsPath : undefined },
    ];

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Prompt Details: {detail}</Text>
        <Text dimColor>{entry?.description}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text dimColor>{"Level".padEnd(17)}{"Status".padEnd(12)}{"Path"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {rows.map((row, idx) => (
          <Text key={row.level}>
            <Text color={idx === detailCursor ? "#4ec9b0" : undefined}>{idx === detailCursor ? "▸ " : "  "}</Text>
            <Text>{row.level.padEnd(15)}</Text>
            <Text>{(row.active ? "active" : "—").padEnd(12)}</Text>
            <Text dimColor>{row.path || ""}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Back  │  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Prompts</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {entries.length === 0 ? (
        <Text dimColor>No prompts registered.</Text>
      ) : (<>
        <Table
          columns={[
            { key: "label", label: "Label", width: 20 },
            { key: "source", label: "Source", width: 15 },
            { key: "override", label: "Override", width: 15 },
            { key: "description", label: "Description" },
          ]}
          rows={entries.map(entry => {
            const resolved = prompts.resolve(entry.key);
            return { label: entry.label, source: entry.sourcePlugin, override: resolved?.source || "default", description: entry.description || "" };
          })}
          cursor={cursor}
        />
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/prompts/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/prompts/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>enter</Text> Details</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}
