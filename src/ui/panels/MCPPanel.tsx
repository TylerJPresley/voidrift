import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { trunc } from "./utils.js";
import { openInEditor } from "../../utils/editor.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { MCPEngine } from "../../mcp/engine.js";
import type { VoidRiftConfig } from "../../config/loader.js";

export function MCPPanel({ mcp, config, onClose }: { mcp: MCPEngine; config: VoidRiftConfig; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name" | "url"; scope?: "workspace" | "global"; name?: string } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const configs = mcp.loadConfigs();
  const servers = mcp.all;
  const allNames = [...new Set([...configs.map(c => c.name), ...servers.map(s => s.name)])];

  const getStatus = (name: string) => servers.find(s => s.name === name)?.status ?? "not connected";
  const getToolCount = (name: string) => servers.find(s => s.name === name)?.tools.length ?? 0;
  const hasAuth = (name: string) => !!configs.find(c => c.name === name)?.auth;

  useInput((input, key) => {
    if (createState) {
      if (key.escape) { setCreateState(null); setInputValue(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter server id (lower-case, hyphens only):"); }
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter server id (lower-case, hyphens only):"); }
        return;
      }
      return;
    }

    if (detail) {
      if (key.escape) { setDetail(null); setMessage(null); return; }
      // Clear previous status on any new keypress
      if (input || key.return) setMessage(null);
      if (input === "e" && config.editor) {
        for (const dir of mcp["configDirs"]) {
          const path = join(dir, `${detail}.json`);
          if (existsSync(path)) { openInEditor(path, config.editor); setMessage(`Editing ${detail}`); break; }
        }
      }
      if (input === "a") {
        // Toggle autoConnect
        for (const dir of mcp["configDirs"]) {
          const path = join(dir, `${detail}.json`);
          if (existsSync(path)) {
            const raw = JSON.parse(readFileSync(path, "utf-8"));
            raw.autoConnect = raw.autoConnect === false ? true : false;
            writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");
            setMessage(`autoConnect: ${raw.autoConnect}`);
            break;
          }
        }
      }
      if (input === "x") {
        const st = getStatus(detail);
        if (st === "connected") {
          mcp.disconnect(detail);
          setMessage(`Disconnected.`);
        } else {
          const cfg = configs.find(c => c.name === detail);
          if (cfg) {
            setMessage("Connecting...");
            mcp.connect(cfg).then((result) => {
              setMessage(result.status === "connected" ? `Connected (${result.tools.length} tools)` : `Error: ${result.errorLog[result.errorLog.length - 1] || "failed"}`);
            });
          }
        }
      }
      if (input === "o") {
        const cfg = configs.find(c => c.name === detail);
        if (cfg?.auth?.type === "oauth2") {
          setMessage("Starting OAuth flow — check browser...");
          import("../../mcp/oauth.js").then(({ runOAuthFlow }) => {
            import("child_process").then(({ execSync }) => {
            runOAuthFlow(detail, cfg.auth!, (url: string) => {
              try { execSync(`xdg-open "${url}" 2>/dev/null || open "${url}" 2>/dev/null`); } catch {}
            }, (msg: string) => setMessage(msg));
            });
          });
        } else {
          setMessage("No OAuth config. Add 'auth' section to config.");
        }
      }
      return;
    }

    if (confirmDelete) {
      if (input === "y") {
        const name = allNames[cursor];
        mcp.disconnect(name);
        mcp.removeConfig(name);
        setMessage(`Deleted: ${name}`);
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
        setMessage(null);
      }
      return;
    }

    if (key.escape) { onClose(); return; }
    if (key.upArrow) setCursor(s => Math.max(0, s - 1));
    if (key.downArrow) setCursor(s => Math.min(allNames.length - 1, s + 1));

    if (key.return && allNames[cursor]) { setDetail(allNames[cursor]); return; }
    if (input === "c") {
      setCreateState({ step: "scope" });
      setMessage("Create MCP server — scope: (w) workspace  (g) global");
    }
    if (key.delete && allNames[cursor]) {
      setConfirmDelete(true);
      setMessage(`Delete "${allNames[cursor]}"? (y/n)`);
    }
  });

  if (detail) {
    const cfg = configs.find(c => c.name === detail);
    const srv = servers.find(s => s.name === detail);
    const st = getStatus(detail);
    const tools = srv?.tools ?? [];
    const location = mcp["configDirs"].findIndex((d: string) => existsSync(join(d, `${detail}.json`)));
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>MCP Servers <Text dimColor>›</Text> {detail}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text><Text color="#61afef">{"Name:".padEnd(16)}</Text>{detail}</Text>
        <Text><Text color="#61afef">{"Status:".padEnd(16)}</Text><Text color={st === "connected" ? "green" : st === "error" ? "red" : "yellow"}>{st}</Text></Text>
        <Text><Text color="#61afef">{"Location:".padEnd(16)}</Text>{location === 1 ? "global" : "workspace"}</Text>
        <Text><Text color="#61afef">{"Transport:".padEnd(16)}</Text>{cfg?.transport ?? (cfg?.url ? "http-sse" : "stdio")}</Text>
        {cfg?.url && <Text><Text color="#61afef">{"URL:".padEnd(16)}</Text>{cfg.url}</Text>}
        {cfg?.command && <Text><Text color="#61afef">{"Command:".padEnd(16)}</Text>{cfg.command} {(cfg.args ?? []).join(" ")}</Text>}
        <Text><Text color="#61afef">{"Auth:".padEnd(16)}</Text>{cfg?.auth ? `${cfg.auth.type} (${cfg.auth.scopes?.join(", ") ?? "no scopes"})` : "none"}</Text>
        <Text><Text color="#61afef">{"Auto-Connect:".padEnd(16)}</Text>{(cfg as any)?.autoConnect === false ? <Text color="yellow">manual</Text> : <Text color="green">on startup</Text>}</Text>
        <Text><Text color="#61afef">{"Tools:".padEnd(16)}</Text>{tools.length}</Text>
        {tools.length > 0 && <>
          <Text> </Text>
          <Text bold>Registered Tools</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          {tools.slice(0, 15).map(t => <Text key={t.name}><Text color="#61afef">{"  " + t.name.padEnd(25)}</Text><Text dimColor>{t.description}</Text></Text>)}
          {tools.length > 15 && <Text dimColor>  ...{tools.length - 15} more</Text>}
        </>}
        {srv && srv.errorLog.length > 0 && <>
          <Text> </Text>
          <Text bold color="red">Errors</Text>
          {srv.errorLog.slice(-3).map((e, i) => <Text key={i} dimColor>  {e.trim().slice(0, 80)}</Text>)}
        </>}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>esc</Text> back  │  <Text color="#61afef" bold>x</Text> connect  <Text color="#61afef" bold>o</Text> auth  <Text color="#61afef" bold>e</Text> edit  <Text color="#61afef" bold>a</Text> auto-connect</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>MCP Servers</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {allNames.length === 0 ? (
        <Text dimColor>No MCP servers configured. Press 'c' to create.</Text>
      ) : (<>
        <Text dimColor>{"  "}{"Name".padEnd(20)}{"Status".padEnd(16)}{"Tools".padEnd(8)}{"Auth"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {allNames.map((name, i) => {
          const st = getStatus(name);
          return (
            <Text key={name}>
              <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
              <Text color={st === "connected" ? "green" : st === "error" ? "red" : "yellow"}>● </Text>
              <Text bold color="#61afef">{trunc(name, 18, 18)}</Text>
              <Text>{st.padEnd(16)}</Text>
              <Text>{getToolCount(name) > 0 ? String(getToolCount(name)).padEnd(8) : "—".padEnd(8)}</Text>
              <Text>{hasAuth(name) ? "🔑" : ""}</Text>
            </Text>
          );
        })}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/mcp/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/mcp/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>del</Text> delete</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && (
        <Box><Text color="#61afef">  &gt; </Text><TextInput value={inputValue} onChange={setInputValue} onSubmit={(v) => {
          if (v.length > 0) { setCreateState({ step: "url", name: v }); setInputValue(""); setMessage("Enter server URL (paste supported):"); }
        }} placeholder="server-name" /></Box>
      )}
      {createState?.step === "url" && (
        <Box><Text color="#61afef">  &gt; </Text><TextInput value={inputValue} onChange={setInputValue} onSubmit={(v) => {
          if (v.length > 0) {
            const name = createState.name!;
            const dirIdx = createState.scope === "global" ? 1 : 0;
            setMessage("Discovering server...");
            setInputValue("");
            import("../../mcp/discovery.js").then(({ discoverMCPServer, buildConfigFromDiscovery }) => {
              discoverMCPServer(v, setMessage).then((discovery) => {
                const cfgPath = join(mcp["configDirs"][dirIdx], `${name}.json`);
                mkdirSync(dirname(cfgPath), { recursive: true });
                if (discovery.error) {
                  setMessage(`Discovery failed: ${discovery.error}`);
                  writeFileSync(cfgPath, JSON.stringify({ transport: "http-sse", url: v, autoConnect: true }, null, 2), "utf-8");
                } else {
                  const cfg = buildConfigFromDiscovery(name, discovery);
                  writeFileSync(cfgPath, JSON.stringify({ ...cfg, autoConnect: true }, null, 2), "utf-8");
                  setMessage(discovery.requiresAuth ? `Created ${name} — auth required. Press 'o' to authenticate.` : `Created ${name} — press 'x' to connect.`);
                }
                setCreateState(null);
              });
            });
          }
        }} placeholder="https://mcp.example.com/mcp" /></Box>
      )}
      <Text> </Text>
    </Box>
  );
}
