import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table, type TableRow } from "../table.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function PluginsPanel({
  core,
  onClose,
}: {
  core: CoreAPI;
  onClose: () => void;
}) {
  const plugins = { list: () => core.plugins.list() };
  const registry = { listSlashCommandHooks: () => core.session.listCommands() };
  const agents = { get: (id: string) => { try { return core.agents.get(id).agent; } catch { return undefined; } } };
  const workspaceRoot = core.workspace.root();
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  const allPlugins = plugins.list();

  useInput((ch, key) => {
    if (key.escape) {
      if (detail) { setDetail(null); setPage(0); setMessage(null); }
      else onClose();
      return;
    }
    if (detail) {
      const pageCount = 3;
      if (key.leftArrow) setPage(pg => (pg - 1 + pageCount) % pageCount);
      if (key.rightArrow) setPage(pg => (pg + 1) % pageCount);
      return;
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(allPlugins.length - 1, c + 1));
    if (key.return && allPlugins[cursor]) { setDetail(allPlugins[cursor].id); setPage(0); setMessage(null); }
    if (ch === "e" && allPlugins[cursor]) { core.plugins.enable(allPlugins[cursor].id, "workspace"); setMessage(`Enabled ${allPlugins[cursor].id} — restart to apply`); forceRender(n => n + 1); }
    if (ch === "d" && allPlugins[cursor]) { core.plugins.disable(allPlugins[cursor].id); setMessage(`Disabled ${allPlugins[cursor].id} — restart to apply`); forceRender(n => n + 1); }
  });

  // ─── Detail View ───
  if (detail) {
    const p = allPlugins.find(pl => pl.id === detail)!;
    const pages = ["general", "commands", "agents"];
    const cmds = registry.listSlashCommandHooks().filter(c => c.source === p.id);
    const scope = core.plugins.getScope(p.id);

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Plugins <Text dimColor>›</Text> {p.id}</Text>
        <Text dimColor>{p.description}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Box>
          {pages.map((pg, i) => <Text key={pg} bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${pg} ]` : `  ${pg}  `}  </Text>)}
        </Box>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        {page === 0 && <>
          <Text><Text color="#61afef">{"Name:".padEnd(16)}</Text>{p.name}</Text>
          <Text><Text color="#61afef">{"Version:".padEnd(16)}</Text>{p.version}</Text>
          <Text><Text color="#61afef">{"Author:".padEnd(16)}</Text>{p.author || <Text dimColor>—</Text>}</Text>
          <Text><Text color="#61afef">{"License:".padEnd(16)}</Text>{p.license || <Text dimColor>—</Text>}</Text>
          <Text><Text color="#61afef">{"Homepage:".padEnd(16)}</Text>{p.homepage || <Text dimColor>—</Text>}</Text>
          <Text><Text color="#61afef">{"Scope:".padEnd(16)}</Text>{scope}</Text>
          <Text><Text color="#61afef">{"Status:".padEnd(16)}</Text>{p.active ? <Text color="green">active</Text> : <Text color="red">inactive</Text>}</Text>
          <Text> </Text>
          <Text bold>Contributions</Text>
          <Text>  <Text color="#61afef">{String(p.commands.length).padEnd(3)}</Text>commands</Text>
          <Text>  <Text color="#61afef">{String(p.agents.length).padEnd(3)}</Text>agents</Text>
          <Text>  <Text color="#61afef">{String(p.modes.length).padEnd(3)}</Text>modes</Text>
          <Text>  <Text color="#61afef">{String(p.templates.length).padEnd(3)}</Text>templates</Text>
          <Text>  <Text color="#61afef">{String(p.skills.length).padEnd(3)}</Text>skills</Text>
        </>}
        {page === 1 && <>
          {cmds.length === 0 ? <Text dimColor>No commands registered.</Text> : (<>
            <Text dimColor>{"  "}{"Command".padEnd(20)}{"Description"}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {cmds.map(c => (
              <Text key={c.name}>  <Text color="#c678dd">{("/" + c.name).padEnd(20)}</Text><Text dimColor>{c.description}</Text></Text>
            ))}
          </>)}
        </>}
        {page === 2 && <>
          {p.agents.length === 0 ? <Text dimColor>No agents registered.</Text> : (<>
            <Text dimColor>{"  "}{"Agent".padEnd(20)}{"Description"}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {p.agents.map(a => {
              const manifest = agents.get(a);
              return <Text key={a}>  <Text color="#61afef">{a.padEnd(20)}</Text><Text dimColor>{manifest?.description || ""}</Text></Text>;
            })}
          </>)}
        </>}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>esc</Text> back</Text>
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Plugins</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {allPlugins.length === 0 ? (
        <Text dimColor>No plugins discovered.</Text>
      ) : (<>
        <Table
          columns={[
            { key: "name", label: "Name", width: 20 },
            { key: "scope", label: "Scope", width: 15 },
            { key: "description", label: "Description" },
          ]}
          rows={allPlugins.map(p => {
            const scope = core.plugins.getScope(p.id);
            return { name: p.id, scope, description: p.description, _prefix: p.active ? "● " : "○ ", _prefixColor: p.active ? "green" : scope !== "available" ? "yellow" : "red" } as TableRow;
          })}
          cursor={cursor}
        />
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/config.json → plugins[]</Text>
      <Text dimColor>  Workspace:  .voidrift/config.json → plugins[]</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>e</Text> enable  <Text color="#61afef" bold>d</Text> disable</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}
