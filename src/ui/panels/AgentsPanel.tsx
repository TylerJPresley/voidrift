import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { trunc } from "./utils.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function AgentsPanel({
  core,
  onClose,
}: {
  core: CoreAPI;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace"; name?: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [, refresh] = useState(0);
  const pages = ["core interactive", "core task", "custom interactive", "custom task"];

  useEffect(() => {
    return core.events.subscribe("RESOURCE_CHANGED" as any, (e: any) => {
      if (e.payload.type === "agent") refresh(n => n + 1);
    });
  }, []);

  const getList = () => {
    const all = core.agents.list().agents;
    switch (page) {
      case 0: return all.filter(a => a.type === "interactive" && a.source !== "custom");
      case 1: return all.filter(a => a.type === "task" && a.source !== "custom");
      case 2: return all.filter(a => a.type === "interactive" && a.source === "custom");
      case 3: return all.filter(a => a.type === "task" && a.source === "custom");
      default: return [];
    }
  };
  const list = getList();
  const isCustomPage = page >= 2;

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === "y") {
        if (deleteTarget) {
          core.agents.deleteFile(deleteTarget);
          core.agents.reindex();
          setMessage(`Deleted override`);
        } else {
          const agent = list[selected];
          if (agent) {
            core.agents.deleteOverride(agent.id, "workspace");
            core.agents.deleteOverride(agent.id, "global");
            core.agents.reindex();
            setMessage(`Deleted: ${agent.name}`);
          }
        }
        setConfirmDelete(false);
        setDeleteTarget(null);
      } else {
        setConfirmDelete(false);
        setDeleteTarget(null);
        setMessage(null);
      }
      return;
    }

    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter agent id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter agent id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const type = page === 2 ? "interactive" : "task";
          const path = core.agents.create(createName, type as any, createState.scope as any);
          core.agents.reindex();
          setCreateState(null);
          setCreateName("");
          const result = core.editor.open(path);
          setMessage(result.success ? `Created ${createName} — editing config` : `Created: ${createName} (${result.error || "set editor in config"})`);
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
        const agent = list[selected];
        if (agent) {
          const result = core.agents.renameAgent(agent.id, renameName);
          setMessage(result.success ? `Renamed: ${agent.id} → ${renameName}` : result.error || "Rename failed");
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
      const rows = core.agents.getOverrideCascade(detail).filter(r => r.editable);
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); core.agents.reindex(); return; }
      if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setDetailCursor(c => Math.min(rows.length - 1, c + 1));
      if (key.return && rows[detailCursor]) {
        const row = rows[detailCursor];
        if (!row.target) {
          // Default row — view built-in as read-only
          const agent = core.agents.get(detail).agent;
          const suffix = row.section === "prompt" ? "prompt.md" : "agent.json";
          let content: string;
          if (row.section === "prompt") {
            content = agent.prompt || "";
          } else {
            const copy: Record<string, unknown> = { ...agent };
            delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
            content = JSON.stringify(copy, null, 2);
          }
          const result = core.editor.viewReadonly(content, `${detail}_default_${suffix}`);
          setMessage(result.success ? `Viewing default (read-only): ${detail} ${row.section}` : result.error || "No editor configured");
        } else {
          // Scaffold override if needed, then open
          core.agents.scaffoldOverride(detail, row.target);
          core.agents.reindex();
          const result = core.editor.editValidated(row.target, row.target.endsWith(".json") ? "json" : "prompt");
          setMessage(result.success ? (result.changed ? `Edited: ${row.path || row.target}` : "No changes.") : result.error || "Failed");
        }
      }
      if (key.delete && rows[detailCursor]) {
        const row = rows[detailCursor];
        if (row.target && row.path) {
          setConfirmDelete(true);
          setDeleteTarget(row.target);
          setMessage(`Delete override ${row.path}? (y/n)`);
        }
      }
      if (confirmReset) {
        if (input === "y") {
          const row = rows[detailCursor];
          if (row?.target) {
            core.agents.resetOverride(detail, row.target);
            core.agents.reindex();
            setMessage(`Reset: ${row.path || row.target}`);
          }
          setConfirmReset(false);
        } else {
          setConfirmReset(false);
          setMessage(null);
        }
        return;
      }
      if (input === "r" && rows[detailCursor]) {
        const agent = core.agents.get(detail).agent;
        if (agent.source === "custom" && rows[detailCursor].target && rows[detailCursor].path) {
          setConfirmReset(true);
          setMessage(`Reset ${rows[detailCursor].target!.endsWith(".json") ? "config" : "prompt"} to default? (y/n)`);
        }
      }
      return;
    }

    // List view
    if (key.escape) onClose();
    if (key.leftArrow) { setPage((p) => (p - 1 + 4) % 4); setSelected(0); setMessage(null); }
    if (key.rightArrow) { setPage((p) => (p + 1) % 4); setSelected(0); setMessage(null); }
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(list.length - 1, s + 1));
    if (key.return && list[selected]) { setDetail(list[selected].id); setDetailCursor(0); setMessage(null); }
    if (input === "a" && isCustomPage && list[selected]) {
      const agent = list[selected];
      if (agent.active !== false) {
        core.agents.deactivate(agent.id);
        core.agents.reindex();
        setMessage(`Deactivated: ${agent.name}`);
      } else {
        core.agents.activate(agent.id);
        core.agents.reindex();
        setMessage(`Activated: ${agent.name}`);
      }
    }
    if (input === "c" && isCustomPage) {
      setCreateState({ step: "scope" });
      setMessage("Create agent — scope: (g) global  (w) workspace");
    }
    if (input === "r" && isCustomPage && list[selected]) {
      setRenaming(true);
      setRenameName("");
      setMessage(`Rename "${list[selected].id}" — enter new id:`);
    }
    if (key.delete && isCustomPage && list[selected]) {
      const agent = list[selected];
      setConfirmDelete(true);
      setMessage(`Delete agent "${agent.name}"? (y/n)`);
    }
  });

  // ─── Detail View ───
  if (detail) {
    const agent = core.agents.get(detail).agent;
    const allRows = core.agents.getOverrideCascade(detail);
    const editableRows = allRows.filter(r => r.editable);
    let editIdx = 0;
    const isCustomAgent = agent.source === "custom";

    const renderRow = (row: typeof allRows[0]) => {
      const idx = editIdx++;
      if (isCustomAgent) {
        return (
          <Text key={`${row.section}-${row.level}`}>
            <Text color={idx === detailCursor ? "#4ec9b0" : undefined}>{idx === detailCursor ? "▸ " : "  "}</Text>
            <Text>{row.level.padEnd(15)}</Text>
            <Text dimColor>{row.path || ""}</Text>
          </Text>
        );
      }
      return (
        <Text key={`${row.section}-${row.level}`}>
          <Text color={idx === detailCursor ? "#4ec9b0" : undefined}>{idx === detailCursor ? "▸ " : "  "}</Text>
          <Text>{row.level.padEnd(15)}</Text>
          <Text>{(row.active ? "active" : "—").padEnd(12)}</Text>
          <Text dimColor>{row.path || ""}</Text>
        </Text>
      );
    };

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Agents <Text dimColor>[{pages[page]}]</Text> <Text dimColor>›</Text> {detail}</Text>
        <Text dimColor>{agent.description}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        {isCustomAgent ? (<>
          <Text dimColor>{"  "}{"File".padEnd(15)}{"Path"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          {allRows.map(renderRow)}
        </>) : (<>
          <Text bold>Config</Text>
          <Text> </Text>
          <Text dimColor>{"Level".padEnd(17)}{"Status".padEnd(12)}{"Path"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          {allRows.filter(r => r.section === "config").map(renderRow)}
          <Text> </Text>
          <Text bold>Prompt</Text>
          <Text> </Text>
          <Text dimColor>{"Level".padEnd(17)}{"Status".padEnd(12)}{"Path"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          {allRows.filter(r => r.section === "prompt").map(renderRow)}
        </>)}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Back  │  <Text color="#61afef" bold>enter</Text> {editableRows[detailCursor]?.level === "Default" ? "View" : "Open/Create"}{isCustomAgent && <>  <Text color="#61afef" bold>r</Text> Reset  <Text color="#61afef" bold>del</Text> Delete</>}{!isCustomAgent && <>  <Text color="#61afef" bold>del</Text> Delete</>}</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Agents</Text>
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
        <Text dimColor>No {pages[page]} agents registered.</Text>
      ) : (<>
        <Table
          columns={[
            { key: "name", label: "Name", width: 20 },
            { key: "source", label: isCustomPage ? "Location" : "Source", width: 15 },
            { key: "status", label: isCustomPage ? "Active" : "Override", width: 15 },
            { key: "description", label: "Description" },
          ]}
          rows={list.map(a => ({
            name: a.name,
            source: isCustomPage ? core.agents.getLocation(a.id) : (a.source || "core"),
            status: isCustomPage ? (a.active !== false ? "yes" : "no") : (a.configOverride || "default") + "/" + (a.promptOverride || "default"),
            description: a.description || "",
          }))}
          cursor={selected}
        />
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/agents/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/agents/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>enter</Text> Details{isCustomPage && <>  <Text color="#61afef" bold>a</Text> toggle active  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
    </Box>
  );
}
