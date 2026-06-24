import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Table } from "../table.js";
import { trunc } from "./utils.js";
import { openInEditor } from "../../utils/editor.js";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { AgentRegistry } from "../../agents/registry.js";
import type { VoidRiftConfig } from "../../config/loader.js";
import type { EventBus } from "../../events/bus.js";

export function AgentsPanel({
  agents,
  config,
  workspaceRoot,
  bus,
  onClose,
}: {
  agents: AgentRegistry;
  config: VoidRiftConfig;
  workspaceRoot: string;
  bus: EventBus;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace"; name?: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [, refresh] = useState(0);
  const pages = ["core interactive", "core task", "custom interactive", "custom task"];

  useEffect(() => {
    return bus.subscribe("RESOURCE_CHANGED" as any, (e: any) => {
      if (e.payload.type === "agent") refresh(n => n + 1);
    });
  }, [bus]);

  const activeId = agents.active.id;

  const getList = () => {
    switch (page) {
      case 0: return agents.listInteractive().filter(a => a.source !== "custom");
      case 1: return agents.listTask().filter(a => a.source !== "custom");
      case 2: return agents.listInteractive().filter(a => a.source === "custom");
      case 3: return agents.listTask().filter(a => a.source === "custom");
      default: return [];
    }
  };
  const list = getList();
  const isCustomPage = page >= 2;

  const getDetailRows = (agentId: string) => {
    const agent = agents.get(agentId);
    const globalDir = join(process.env.HOME || "", ".config", "voidrift", "agents", agentId);
    const wsDir = join(workspaceRoot, ".voidrift", "agents", agentId);
    const globalConfig = join(globalDir, "agent.json");
    const wsConfig = join(wsDir, "agent.json");
    const globalPrompt = join(globalDir, "prompt.md");
    const wsPrompt = join(wsDir, "prompt.md");
    const gcExists = existsSync(globalConfig);
    const wcExists = existsSync(wsConfig);
    const gpExists = existsSync(globalPrompt);
    const wpExists = existsSync(wsPrompt);
    const hasBuiltIn = agent?.source !== "custom";

    const configActive = wcExists ? "workspace" : gcExists ? "global" : "default";
    const promptActive = wpExists ? "workspace" : gpExists ? "global" : "default";

    const rows: Array<{ section: string; level: string; active: boolean; path?: string; editable: boolean; target?: string }> = [];

    if (hasBuiltIn) {
      rows.push({ section: "config", level: "Default", active: configActive === "default", path: "(built-in)", editable: true, target: undefined });
      rows.push({ section: "config", level: "Global", active: configActive === "global", path: gcExists ? globalConfig.replace(process.env.HOME || "", "~") : undefined, editable: true, target: globalConfig });
      rows.push({ section: "config", level: "Workspace", active: configActive === "workspace", path: wcExists ? wsConfig.replace(workspaceRoot, ".") : undefined, editable: true, target: wsConfig });
      rows.push({ section: "prompt", level: "Default", active: promptActive === "default", path: "(built-in)", editable: true, target: undefined });
      rows.push({ section: "prompt", level: "Global", active: promptActive === "global", path: gpExists ? globalPrompt.replace(process.env.HOME || "", "~") : undefined, editable: true, target: globalPrompt });
      rows.push({ section: "prompt", level: "Workspace", active: promptActive === "workspace", path: wpExists ? wsPrompt.replace(workspaceRoot, ".") : undefined, editable: true, target: wsPrompt });
    } else {
      // Custom agents — just show config and prompt as rows
      const configPath = gcExists ? globalConfig : wcExists ? wsConfig : undefined;
      const promptPath_ = gpExists ? globalPrompt : wpExists ? wsPrompt : undefined;
      rows.push({ section: "file", level: "Config", active: !!configPath, path: configPath ? configPath.replace(process.env.HOME || "", "~").replace(workspaceRoot, ".") : undefined, editable: true, target: configPath || wsConfig });
      rows.push({ section: "file", level: "Prompt", active: !!promptPath_, path: promptPath_ ? promptPath_.replace(process.env.HOME || "", "~").replace(workspaceRoot, ".") : undefined, editable: true, target: promptPath_ || wsPrompt });
    }
    return rows;
  };

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === "y") {
        const agent = list[selected];
        if (agent) {
          agents.deleteOverride(agent.id, "workspace", workspaceRoot);
          agents.deleteOverride(agent.id, "global", workspaceRoot);
          agents.discover(workspaceRoot);
          setMessage(`Deleted: ${agent.name}`);
        }
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
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter agent id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter agent id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const type = page === 2 ? "interactive" : "task";
          const path = agents.createAgent(createName, type as any, workspaceRoot, createState.scope as any);
          agents.discover(workspaceRoot);
          setCreateState(null);
          setCreateName("");
          if (config.editor) {
            const result = openInEditor(path, config.editor);
            agents.discover(workspaceRoot);
            setMessage(`Created ${createName} — editing config`);
          } else {
            setMessage(`Created: ${createName} (set "editor" in config)`);
          }
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
          const oldDir = agent.overridePath ? dirname(agent.overridePath) : join(workspaceRoot, ".voidrift", "agents", agent.id);
          const parentDir = dirname(oldDir);
          const newDir = join(parentDir, renameName);
          if (existsSync(oldDir) && !existsSync(newDir)) {
            renameSync(oldDir, newDir);
            agents.discover(workspaceRoot);
            setMessage(`Renamed: ${agent.id} → ${renameName}`);
          } else {
            setMessage(existsSync(newDir) ? `"${renameName}" already exists` : "Source folder not found");
          }
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
      const rows = getDetailRows(detail).filter(r => r.editable);
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); agents.discover(workspaceRoot); return; }
      if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setDetailCursor(c => Math.min(rows.length - 1, c + 1));
      if (key.return && rows[detailCursor]) {
        const row = rows[detailCursor];
        if (!row.target) {
          // Default row — view built-in as read-only temp file
          const agent = agents.get(detail!)!;
          const tmpDir = join(workspaceRoot, ".voidrift", "cache", "view");
          mkdirSync(tmpDir, { recursive: true });
          const suffix = row.section === "prompt" ? "prompt.md" : "agent.json";
          const tmpPath = join(tmpDir, `${detail}_default_${suffix}`);
          if (row.section === "prompt") {
            writeFileSync(tmpPath, agent.prompt, "utf-8");
          } else {
            const copy: Record<string, unknown> = { ...agent };
            delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
            writeFileSync(tmpPath, JSON.stringify(copy, null, 2), "utf-8");
          }
          if (config.editor) {
            const result = openInEditor(tmpPath, config.editor);
            setMessage(result.success ? `Viewing default (read-only): ${detail} ${row.section}` : result.error || "Failed");
          } else {
            setMessage(`Default written to: ${tmpPath.replace(workspaceRoot, ".")} (set "editor" in config)`);
          }
        } else {
          const target = row.target;
          mkdirSync(dirname(target), { recursive: true });
          if (!existsSync(target)) {
            const agent = agents.get(detail!)!;
            if (target.endsWith(".json")) {
              const copy: Record<string, unknown> = { ...agent };
              delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
              writeFileSync(target, JSON.stringify(copy, null, 2), "utf-8");
            } else {
              writeFileSync(target, agent.prompt, "utf-8");
            }
          }
          agents.discover(workspaceRoot);
          if (config.editor) {
            const result = openInEditor(target, config.editor);
            setMessage(result.success ? `Opened: ${target.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
          } else {
            setMessage(`Created: ${target.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
          }
        }
      }
      if (key.delete && rows[detailCursor]) {
        const row = rows[detailCursor];
        if (row.target && existsSync(row.target)) {
          unlinkSync(row.target);
          agents.discover(workspaceRoot);
          setMessage(`Deleted: ${row.target.replace(process.env.HOME || "", "~")}`);
        }
      }
      if (confirmReset) {
        if (input === "y") {
          const row = rows[detailCursor];
          if (row?.target) {
            const agentId = detail!;
            if (row.target.endsWith(".json")) {
              const defaultConfig = { id: agentId, name: agentId, description: "", type: "interactive", modelTier: "auto", tools: [] as string[], approvalMode: "prompt", allowedTools: [] as string[], active: false };
              writeFileSync(row.target, JSON.stringify(defaultConfig, null, 2), "utf-8");
            } else {
              writeFileSync(row.target, `You are ${agentId}.\n`, "utf-8");
            }
            agents.discover(workspaceRoot);
            setMessage(`Reset: ${row.target.replace(process.env.HOME || "", "~")}`);
          }
          setConfirmReset(false);
        } else {
          setConfirmReset(false);
          setMessage(null);
        }
        return;
      }
      if (input === "r" && agents.get(detail!)?.source === "custom" && rows[detailCursor]) {
        const row = rows[detailCursor];
        if (row.target && existsSync(row.target)) {
          setConfirmReset(true);
          setMessage(`Reset ${row.target.endsWith(".json") ? "config" : "prompt"} to default? (y/n)`);
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
        agents.deactivate(agent.id, workspaceRoot);
        agents.discover(workspaceRoot);
        setMessage(`Deactivated: ${agent.name}`);
      } else {
        agents.activate(agent.id, workspaceRoot);
        agents.discover(workspaceRoot);
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
    const agent = agents.get(detail);
    const allRows = getDetailRows(detail);
    const editableRows = allRows.filter(r => r.editable);
    let editIdx = 0;

    const isCustomAgent = agent?.source === "custom";
    const renderRow = (row: typeof allRows[0]) => {
      const isEditable = row.editable;
      const idx = isEditable ? editIdx++ : -1;
      if (!isEditable) {
        return (
          <Text key={`${row.section}-${row.level}`}>
            <Text>{row.level.padEnd(17)}</Text>
            <Text>{(row.active ? "active" : "—").padEnd(12)}</Text>
            <Text dimColor>{row.path || ""}</Text>
          </Text>
        );
      }
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
        <Text dimColor>{agent?.description}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
        {agent?.source === "custom" ? (<>
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
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {editableRows[detailCursor]?.level === "Default" ? "View" : "Open/Create"}  <Text color="#61afef" bold>esc</Text> Back{isCustomAgent && <>  │  <Text color="#61afef" bold>r</Text> Reset  <Text color="#61afef" bold>del</Text> Delete</>}{!isCustomAgent && <>  │  <Text color="#61afef" bold>del</Text> Delete</>}</Text>
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
          rows={list.map(a => {
            const globalDir = join(process.env.HOME || "", ".config", "voidrift", "agents", a.id);
            const wsDir = join(workspaceRoot, ".voidrift", "agents", a.id);
            const configOverride = existsSync(join(wsDir, "agent.json")) ? "workspace" : existsSync(join(globalDir, "agent.json")) ? "global" : "default";
            const promptOverride = existsSync(join(wsDir, "prompt.md")) ? "workspace" : existsSync(join(globalDir, "prompt.md")) ? "global" : "default";
            return {
              name: a.name,
              source: isCustomPage ? (existsSync(join(workspaceRoot, ".voidrift", "agents", a.id)) ? "workspace" : "global") : (a.source || "core"),
              status: isCustomPage ? (a.active !== false ? "yes" : "no") : configOverride + "/" + promptOverride,
              description: a.description || "",
            };
          })}
          cursor={selected}
        />
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/agents/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/agents/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close{isCustomPage && <>  │  <Text color="#61afef" bold>a</Text> toggle active  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
    </Box>
  );
}
