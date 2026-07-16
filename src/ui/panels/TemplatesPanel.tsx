import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { trunc } from "./utils.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function TemplatesPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const templates = { slotsByType: (_type?: string) => core.templates.slots(), resolveSlot: (s: any) => core.templates.resolve(s.key), createOverrideForSlot: (s: any, scope: any) => core.templates.createSlotOverride(s.key, scope) };
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pages = ["system", "custom"];

  const systemSlots = templates.slotsByType("template").filter(s => s.sourcePlugin !== "custom");
  
  // Custom templates from CoreAPI slots (sourcePlugin === "custom")
  const customTemplates = templates.slotsByType("template")
    .filter(s => s.sourcePlugin === "custom")
    .map(s => ({
      key: s.key,
      path: s.overridePath || `.voidrift/templates/${s.key}.md`,
      location: s.overridePath?.includes(".config/voidrift") ? "global" : "workspace",
    }));

  const isCustomPage = page === 1;
  const list = isCustomPage ? customTemplates : systemSlots;

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === "y") {
        const item = customTemplates[cursor];
        if (item) { core.templates.delete(item.key); setMessage(`Deleted: ${item.key}`); }
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
        setMessage(null);
      }
      return;
    }
    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter template id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter template id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const filePath = core.templates.create(createName, createState.scope as "workspace" | "global");
          setCreateState(null);
          setCreateName("");
          const result = core.editor.open(filePath);
          setMessage(result.success ? `Created ${createName} — editing` : `Created: ${createName} (${result.error || "set editor in config"})`);
        } else if (key.backspace || key.delete) {
          setCreateName(n => n.slice(0, -1));
        } else if (input && /^[a-z0-9-]$/.test(input)) {
          setCreateName(n => n + input);
        }
      }
      return;
    }

    if (renaming) {
      if (key.escape) { setRenaming(false); setRenameName(""); setMessage(null); return; }
      if (key.return && renameName.length > 0) {
        const item = customTemplates[cursor];
        if (item) {
          const result = core.templates.rename(item.key, renameName);
          setMessage(result.success ? `Renamed: ${item.key} → ${renameName}` : result.error || "Rename failed");
        }
        setRenaming(false);
        setRenameName("");
      } else if (key.backspace || key.delete) {
        setRenameName(n => n.slice(0, -1));
      } else if (input && /^[a-z0-9-]$/.test(input)) {
        setRenameName(n => n + input);
      }
      return;
    }

    if (detail) {
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); return; }
      if (isCustomPage) {
        if (key.return) {
          const item = customTemplates.find(t => t.key === detail);
          if (item) {
            const result = core.editor.editValidated(item.path, "frontmatter");
            setMessage(result.success ? (result.changed ? `Edited: ${core.workspace.shortenPath(item.path)}` : "No changes.") : result.error || "Failed");
          }
        }
      } else {
        if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
        if (key.downArrow) setDetailCursor(c => Math.min(2, c + 1));
        if (key.return) {
          const slot = systemSlots.find(s => s.key === detail);
          if (slot) {
            if (detailCursor === 0) {
              const resolved = templates.resolveSlot(slot);
              if (!resolved) return;
              const result = core.editor.viewReadonly(resolved.content, `${detail.replace(/\//g, "_")}.md`);
              setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "No editor configured");
            } else {
              const scope = detailCursor === 1 ? "global" : "workspace";
              const path = templates.createOverrideForSlot(slot, scope as any);
              if (path) {
                const result = core.editor.open(path);
                setMessage(result.success ? `Opened: ${core.workspace.shortenPath(path)}` : result.error || "No editor configured");
              }
            }
          }
        }
      }
      return;
    }

    if (key.escape) onClose();
    if (key.leftArrow) { setPage((p) => (p - 1 + 2) % 2); setCursor(0); setMessage(null); }
    if (key.rightArrow) { setPage((p) => (p + 1) % 2); setCursor(0); setMessage(null); }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(list.length - 1, c + 1));
    if (key.return && list[cursor]) {
      if (isCustomPage) {
        const item = customTemplates[cursor];
        if (item) {
          const result = core.editor.open(item.path);
          setMessage(result.success ? `Opened: ${core.workspace.shortenPath(item.path)}` : result.error || "No editor configured");
        }
      } else {
        const item = list[cursor];
        setDetail("key" in item ? item.key : (item as any).key);
        setDetailCursor(0);
        setMessage(null);
      }
    }
    if (input === "c" && isCustomPage) {
      setCreateState({ step: "scope" });
      setMessage("Create template — scope: (g) global  (w) workspace");
    }
    if (input === "r" && isCustomPage && customTemplates[cursor]) {
      setRenaming(true);
      setRenameName("");
      setMessage(`Rename "${customTemplates[cursor].key}" — enter new id:`);
    }
    if (key.delete && isCustomPage && customTemplates[cursor]) {
      const item = customTemplates[cursor];
      setConfirmDelete(true);
      setMessage(`Delete "${item.key}"? (y/n)`);
    }
  });

  // ─── Detail View ───
  if (detail) {
    if (isCustomPage) {
      const item = customTemplates.find(t => t.key === detail);
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
          <Text bold>Template Details: {detail}</Text>
          <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text> </Text>
          <Text dimColor>{"  "}{"File".padEnd(15)}{"Path"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text>
            <Text color="#4ec9b0">{"▸ "}</Text>
            <Text>{"Template".padEnd(15)}</Text>
            <Text dimColor>{core.workspace.shortenPath(item?.path || "")}</Text>
          </Text>
          <Text> </Text>
          <Text dimColor><Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Back</Text>
          {message && <Text color="#4ec9b0">{message}</Text>}
        </Box>
      );
    }

    const slot = systemSlots.find(s => s.key === detail);
    const resolved = slot ? templates.resolveSlot(slot) : null;
    const activeLevel = resolved?.source || "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)", scope: "default" as const },
      { level: "Global", active: activeLevel === "global", path: activeLevel === "global" ? `~/.config/voidrift/templates/${detail}.md` : undefined, scope: "global" as const },
      { level: "Workspace", active: activeLevel === "workspace", path: activeLevel === "workspace" ? `.voidrift/templates/${detail}.md` : undefined, scope: "workspace" as const },
    ];

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Template Details: {detail}</Text>
        <Text dimColor>{slot?.description}</Text>
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
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}  <Text color="#61afef" bold>esc</Text> Back</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Templates</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box>
        {pages.map((p, i) => (
          <React.Fragment key={p}>
            <Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${p} ]` : `  ${p}  `}</Text>
            {i < pages.length - 1 && <Text>  </Text>}
          </React.Fragment>
        ))}
      </Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {list.length === 0 ? (
        <Text dimColor>No {pages[page]} templates registered.</Text>
      ) : (<>
        {!isCustomPage ? (
          <Table
            columns={[
              { key: "label", label: "Label", width: 20 },
              { key: "source", label: "Source", width: 15 },
              { key: "override", label: "Override", width: 15 },
              { key: "description", label: "Description" },
            ]}
            rows={systemSlots.map(slot => {
              const resolved = templates.resolveSlot(slot);
              return { label: slot.label, source: slot.sourcePlugin, override: resolved?.source ?? "default", description: slot.description };
            })}
            cursor={cursor}
          />
        ) : (
          <>
            <Text dimColor>{"  "}{"Name".padEnd(20)}{"Location".padEnd(15)}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {customTemplates.map((t, i) => (
              <Text key={t.key}>
                <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                <Text bold color="#61afef">{trunc(t.key, 18, 20)}</Text>
                <Text>{t.location.padEnd(15)}</Text>
              </Text>
            ))}
          </>
        )}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/templates/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/templates/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>enter</Text> {isCustomPage ? "Open" : "Details"}{isCustomPage && <>  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
    </Box>
  );
}
