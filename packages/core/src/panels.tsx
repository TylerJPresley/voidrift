/**
 * TUI Panel Components.
 * Each panel is rendered below the input line, dismissed with ESC.
 * Panels follow the mockup's bordered-box pattern from /mockup.
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { StatsTracker } from "./session/stats.js";
import type { TokenBudgetWatcher } from "./output/budget.js";
import type { VoidRiftConfig } from "./config/loader.js";
import type { SkillManager } from "./skills/manager.js";
import type { MemoryRegistry } from "./session/memory.js";
import type { TemplateService } from "./templates/service.js";
import type { MCPEngine } from "./mcp/engine.js";
import type { CoreRegistry } from "./registry/core.js";
import type { ModeCycler } from "./security/mode-cycler.js";
import type { ContextManager } from "./session/context.js";
import { openInEditor } from "./utils/editor.js";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { TOOL_SCHEMAS } from "./tools/definitions.js";
import type { WorktreeEngine } from "./worktree/engine.js";
import type { TaskScheduler } from "./orchestration/scheduler.js";
import { execSync } from "child_process";

// ─── /stats ──────────────────────────────────────────────────────────────────

export function StatsPanel({ stats, budget, onClose }: { stats: StatsTracker; budget: TokenBudgetWatcher; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const s = stats.current;
  const b = budget.state;
  const ctxColor = b.percentage < 50 ? "green" : b.percentage < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Session Summary</Text>
      <Text><Text color="#61afef">Session:   </Text><Text dimColor>{s.sessionId}</Text></Text>
      <Text><Text color="#61afef">Duration:  </Text>{stats.durationFormatted}</Text>
      <Text><Text color="#61afef">Turns:     </Text>{s.turns}</Text>
      <Text> </Text>
      <Text bold>Performance</Text>
      <Text><Text color="#61afef">Wall Time:   </Text>{stats.durationFormatted}</Text>
      <Text><Text color="#61afef">Tool Time:   </Text>{fmtMs(s.tools.totalTimeMs)}</Text>
      <Text> </Text>
      <Text bold>Tools</Text>
      <Text><Text color="#61afef">Calls:        </Text>{s.tools.total} ( <Text color="green">✓ {s.tools.success}</Text> <Text color="red">× {s.tools.failed}</Text> )</Text>
      <Text><Text color="#61afef">Success Rate: </Text><Text color="green">{s.tools.total > 0 ? Math.round((s.tools.success / s.tools.total) * 100) : 0}%</Text></Text>
      <Text> </Text>
      <Text bold>Model Usage</Text>
      <Text dimColor>{"Model".padEnd(28)}{"Turns".padStart(6)}{"Input".padStart(8)}{"Output".padStart(8)}{"tok/s".padStart(7)}</Text>
      <Text dimColor>{"─".repeat(57)}</Text>
      {[...s.modelUsage.entries()].map(([name, u]) => (
        <Text key={name}>{name.padEnd(28)}{String(u.turns).padStart(6)}{String(u.inputTokens).padStart(8)}{String(u.outputTokens).padStart(8)}{(u.totalTimeMs > 0 ? (u.outputTokens / (u.totalTimeMs / 1000)).toFixed(1) : "—").padStart(7)}</Text>
      ))}
      <Text> </Text>
      <Text><Text color="#61afef">Context: </Text><Text color={ctxColor}>◎ {b.percentage}%</Text><Text dimColor> ({b.used} / {b.limit})</Text></Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /help ───────────────────────────────────────────────────────────────────

export function HelpPanel({ registry, sessionId, workspace, onClose }: { registry: CoreRegistry; sessionId: string; workspace: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const pages = ["general", "commands", "shortcuts"];
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.leftArrow || (key.tab && key.shift)) setPage((p) => (p - 1 + 3) % 3);
    if (key.rightArrow || key.tab) setPage((p) => (p + 1) % 3);
  });

  const cmds = registry.listSlashCommands().map((name) => ({ name, desc: registry.getSlashCommand(name)?.description ?? "" }));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Box><Text bold color={page === 0 ? "#4ec9b0" : undefined}> general </Text><Text bold color={page === 1 ? "#4ec9b0" : undefined}> commands </Text><Text bold color={page === 2 ? "#4ec9b0" : undefined}> shortcuts </Text></Box>
      <Text> </Text>
      {page === 0 && <>
        <Text>VoidRift — AI Engineering Harness</Text>
        <Text dimColor>Codebase understanding, permissioned edits, terminal execution.</Text>
        <Text> </Text>
        <Text><Text color="#61afef">Version:      </Text>0.1.0</Text>
        <Text><Text color="#61afef">Workspace:    </Text>{workspace}</Text>
        <Text><Text color="#61afef">Session:      </Text>{sessionId}</Text>
        <Text> </Text>
        <Text dimColor>Type / to see available commands</Text>
      </>}
      {page === 1 && <>
        {cmds.map((c) => <Text key={c.name}><Text color="#61afef">{"/" + c.name.padEnd(14)}</Text><Text dimColor>{c.desc}</Text></Text>)}
      </>}
      {page === 2 && <>
        <Text bold>Input</Text>
        <Text><Text color="#61afef">{"TAB".padEnd(16)}</Text>Autocomplete command/path</Text>
        <Text><Text color="#61afef">{"SHIFT+TAB".padEnd(16)}</Text>Cycle mode (plan → chat → vibe)</Text>
        <Text><Text color="#61afef">{"Enter".padEnd(16)}</Text>Submit input</Text>
        <Text> </Text>
        <Text bold>Session</Text>
        <Text><Text color="#61afef">{"ESC".padEnd(16)}</Text>Cancel generation / close panel</Text>
        <Text><Text color="#61afef">{"Ctrl+C ×2".padEnd(16)}</Text>Exit VoidRift</Text>
      </>}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>←/→</Text> cycle pages  <Text color="#61afef" bold>esc</Text> close</Text>
    </Box>
  );
}

// ─── /tools ──────────────────────────────────────────────────────────────────

export function ToolsPanel({ cycler, onClose }: { cycler: ModeCycler; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const tools = cycler.getTools(null);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Tools <Text dimColor>({cycler.mode} mode)</Text></Text>
      <Text> </Text>
      {tools.map((t) => (
        <Text key={t.name}>
          <Text color={t.safetyProfile === "gated" ? "yellow" : "green"}>{t.safetyProfile === "gated" ? "🔒" : "✓ "} </Text>
          <Text color="#61afef">{t.name.padEnd(18)}</Text>
          <Text dimColor>{t.description}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /model ──────────────────────────────────────────────────────────────────

export function ModelPanel({ config, onAssign, onClose }: { config: VoidRiftConfig; onAssign: (model: string, tier: string) => void; onClose: () => void }) {
  const models = Object.keys(config.models);
  const [selected, setSelected] = useState(0);
  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(models.length - 1, s + 1));
    if (ch === "d") { onAssign(models[selected], "dense"); }
    if (ch === "u") { onAssign(models[selected], "utility"); }
    if (ch === "f") { onAssign(models[selected], "flash"); }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Models</Text>
      <Text> </Text>
      {models.map((name, i) => {
        const cfg = config.models[name];
        const tiers = Object.entries(config.tiers).filter(([, v]) => v === name).map(([k]) => k[0]);
        const tierTag = tiers.length ? ` [${tiers.join(",")}]` : "";
        return (
          <Text key={name}>
            <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
            <Text color="#61afef">{name.padEnd(20)}</Text>
            <Text dimColor>{cfg.protocol}/{cfg.model}</Text>
            <Text color="green">{tierTag}</Text>
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>d</Text> Dense  <Text color="#61afef" bold>u</Text> Utility  <Text color="#61afef" bold>f</Text> Flash  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /skills ─────────────────────────────────────────────────────────────────

export function SkillsPanel({ skills, onClose }: { skills: SkillManager; onClose: () => void }) {
  const indexed = skills.indexed;
  const [selected, setSelected] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  useInput((_, key) => {
    if (key.escape) { if (viewing) setViewing(null); else onClose(); }
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(indexed.length - 1, s + 1));
    if (key.return && indexed[selected]) setViewing(indexed[selected].content);
  });
  if (viewing) return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Skill Content</Text>
      <Text> </Text>
      {viewing.split("\n").slice(0, 20).map((line, i) => <Text key={i} dimColor>{line}</Text>)}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Back</Text>
    </Box>
  );
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Skills</Text>
      <Text> </Text>
      {indexed.length === 0 && <Text dimColor>No skills indexed.</Text>}
      {indexed.map((s, i) => (
        <Text key={s.name}><Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text><Text color="#61afef">{s.name.padEnd(28)}</Text><Text dimColor>{s.description}</Text></Text>
      ))}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> View  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /memory ─────────────────────────────────────────────────────────────────

export function MemoryPanel({ memory, context, onClose }: { memory: MemoryRegistry; context: ContextManager; onClose: () => void }) {
  const entries = memory.all;
  const [selected, setSelected] = useState(0);
  const [, forceUpdate] = useState(0);

  const activeMemory = context.context.workspace.activeMemory;
  const isLoaded = (id: string) => {
    const body = memory.loadBody(id);
    return body ? activeMemory.includes(body) : false;
  };

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(entries.length - 1, s + 1));
    if (ch === "l" && entries[selected]) {
      const body = memory.loadBody(entries[selected].id);
      if (body && !activeMemory.includes(body)) {
        context.loadMemory(body);
        forceUpdate((n) => n + 1);
      }
    }
    if (ch === "u" && entries[selected]) {
      const body = memory.loadBody(entries[selected].id);
      if (body) {
        const idx = activeMemory.indexOf(body);
        if (idx !== -1) {
          context.unloadMemory(idx);
          forceUpdate((n) => n + 1);
        }
      }
    }
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Memory</Text>
      <Text> </Text>
      {entries.length === 0 && <Text dimColor>No memories indexed.</Text>}
      {entries.map((m, i) => (
        <Text key={m.id}>
          <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
          <Text color="#61afef">[{m.id}]</Text>{" "}
          {isLoaded(m.id) ? <Text color="green" bold>[LOADED] </Text> : ""}
          {m.title} — <Text dimColor>{m.summary}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>l</Text> Load  <Text color="#61afef" bold>u</Text> Unload  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /mcp ────────────────────────────────────────────────────────────────────

export function MCPPanel({ mcp, onClose }: { mcp: MCPEngine; onClose: () => void }) {
  const servers = mcp.all;
  const [selected, setSelected] = useState(0);
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(servers.length - 1, s + 1));
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>MCP Servers</Text>
      <Text> </Text>
      {servers.length === 0 && <Text dimColor>No MCP servers configured.</Text>}
      {servers.map((s, i) => (
        <Text key={s.name}>
          <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
          <Text color={s.status === "connected" ? "green" : s.status === "error" ? "red" : "yellow"}>● </Text>
          <Text color="#61afef">{s.name.padEnd(20)}</Text>
          <Text dimColor>{s.status} · {s.tools.length} tools</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Actions  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /templates ──────────────────────────────────────────────────────────────

export function TemplatesPanel({ templates, config, onClose }: { templates: TemplateService; config: VoidRiftConfig; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === "y") {
        const resolved = templates.resolve(entries[cursor].key);
        if (resolved && resolved.source !== "default") {
          const deleted = templates.deleteOverride(entries[cursor].key, resolved.source === "workspace" ? "workspace" : "global");
          setMessage(deleted ? `Deleted override for ${entries[cursor].key}` : "No override to delete");
        }
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
        setMessage(null);
      }
      return;
    }
    if (key.escape) onClose();
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(entries.length - 1, c + 1));
    if (key.return && entries.length > 0) {
      const resolved = templates.resolve(entries[cursor].key);
      const path = resolved?.overridePath || templates.createOverride(entries[cursor].key, "workspace");
      if (path && config.editor) {
        const result = openInEditor(path, config.editor);
        setMessage(result.success ? `Opened: ${path}` : result.error || "Failed");
      } else if (path) {
        setMessage(`Created: ${path} (set "editor" in config to open automatically)`);
      }
    }
    if (input === "o" && entries.length > 0) {
      const path = templates.createOverride(entries[cursor].key, "workspace");
      if (path && config.editor) {
        const result = openInEditor(path, config.editor);
        setMessage(result.success ? `Opened: ${path}` : result.error || "Failed");
      } else if (path) {
        setMessage(`Created: ${path} (set "editor" in config to open automatically)`);
      }
    }
    if (input === "g" && entries.length > 0) {
      const path = templates.createOverride(entries[cursor].key, "global");
      if (path && config.editor) {
        const result = openInEditor(path, config.editor);
        setMessage(result.success ? `Opened: ${path}` : result.error || "Failed");
      } else if (path) {
        setMessage(`Created: ${path} (set "editor" in config to open automatically)`);
      }
    }
    if (input === "d" && entries.length > 0) {
      const resolved = templates.resolve(entries[cursor].key);
      if (resolved && resolved.source !== "default") {
        setConfirmDelete(true);
        setMessage(`Delete ${resolved.source} override for "${entries[cursor].key}"? (y/n)`);
      } else {
        setMessage("No override to delete — using built-in default");
      }
    }
  });
  const entries = templates.all;

  const getStatus = (key: string): { label: string; path?: string } => {
    const resolved = templates.resolve(key);
    if (!resolved) return { label: "[default]" };
    if (resolved.source === "workspace") return { label: "[override: local]", path: resolved.overridePath };
    if (resolved.source === "global") return { label: "[override: global]", path: resolved.overridePath };
    return { label: "[default]" };
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Templates & Prompts</Text>
      <Text> </Text>
      <Text dimColor>{"Key".padEnd(24)}{"Type".padEnd(10)}{"Source".padEnd(12)}{"Status"}</Text>
      <Text dimColor>{"─".repeat(70)}</Text>
      {entries.map((t, i) => {
        const { label, path } = getStatus(t.key);
        const selected = i === cursor;
        return (
          <Text key={t.key} inverse={selected}>
            {t.key.padEnd(24)}{t.type.padEnd(10)}{t.sourcePlugin.padEnd(12)}{label}{path ? `  ${path.replace(process.env.HOME || "", "~")}` : ""}
          </Text>
        );
      })}
      <Text> </Text>
      <Text bold>Override Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/templates/  .voidrift/prompts/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/templates/  ~/.config/voidrift/prompts/</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>o</Text> Override local  <Text color="#61afef" bold>g</Text> Override global  <Text color="#61afef" bold>d</Text> Delete override  <Text color="#61afef" bold>esc</Text> Close</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}

// ─── /context ────────────────────────────────────────────────────────────────

export function ContextPanel({
  budget,
  context,
  stats,
  modelName,
  skills,
  mcp,
  worktree,
  workspaceRoot,
  onClose,
}: {
  budget: TokenBudgetWatcher;
  context: ContextManager;
  stats: StatsTracker;
  modelName: string;
  skills: SkillManager;
  mcp: MCPEngine;
  worktree: WorktreeEngine;
  workspaceRoot?: string;
  onClose: () => void;
}) {
  useInput((ch, key) => {
    if (key.escape) onClose();
  });

  const b = budget.state;
  const totalLimit = b.limit;
  const totalTurns = stats.current.turns;

  // 1. Dynamic Category token calculation
  const messages = context.getMessages();
  const rawUserTokens = messages
    .filter(m => m.role === "user")
    .reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const rawAgentTokens = messages
    .filter(m => m.role === "assistant")
    .reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const rawToolTokens = messages
    .filter(m => m.role === "tool")
    .reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);

  // Focus files and skills token estimates
  const focusedFiles = context.context.workspace.focusedFiles;
  const activeSkills = context.context.governance.activeSkills;

  const rawFileTokens = focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
  const rawSkillsTokens = activeSkills.reduce((acc, content) => acc + Math.ceil(content.length / 4), 0) || activeSkills.length * 1000;
  const rawSystemPromptTokens = Math.ceil(context.context.governance.activePersona.length / 4) || 2000;
  const rawSystemToolsTokens = Math.ceil(JSON.stringify(TOOL_SCHEMAS).length / 4) + (mcp ? mcp.all.reduce((acc, s) => acc + s.tools.length, 0) * 500 : 1500);
  const rawSubagentTokens = worktree ? worktree.locks.length * 4000 : 0;

  // Sum estimated used tokens
  const estUsed = rawUserTokens + rawAgentTokens + rawToolTokens + rawFileTokens + rawSkillsTokens + rawSystemPromptTokens + rawSystemToolsTokens + rawSubagentTokens;

  // Proportional scaling to match budget.used exactly
  const scale = estUsed > 0 ? b.used / estUsed : 1;
  const userTokens = Math.round(rawUserTokens * scale);
  const agentTokens = Math.round(rawAgentTokens * scale);
  const toolTokens = Math.round(rawToolTokens * scale);
  const fileTokens = Math.round(rawFileTokens * scale);
  const skillsTokens = Math.round(rawSkillsTokens * scale);
  const systemPromptTokens = Math.round(rawSystemPromptTokens * scale);
  const systemToolsTokens = Math.round(rawSystemToolsTokens * scale);
  const subagentTokens = Math.round(rawSubagentTokens * scale);

  const activeUsed = b.used;
  const freeTokens = Math.max(0, totalLimit - activeUsed);

  let checkpointBufferTokens = 0;
  if (totalTurns > 0 && workspaceRoot) {
    try {
      const gitStatus = execSync("git status --porcelain", { cwd: workspaceRoot, encoding: "utf-8" });
      checkpointBufferTokens = gitStatus.trim().length > 0 ? Math.min(2000, Math.ceil(gitStatus.length / 4)) : 0;
    } catch {
      checkpointBufferTokens = totalTurns * 200; // fallback estimate
    }
  }

  // Percentages relative to total limit
  const getPctStr = (val: number) => ((val / totalLimit) * 100).toFixed(1);
  const usedPct = getPctStr(activeUsed);
  const userPct = getPctStr(userTokens);
  const agentPct = getPctStr(agentTokens);
  const toolPct = getPctStr(toolTokens);
  const systemPromptPct = getPctStr(systemPromptTokens);
  const systemToolsPct = getPctStr(systemToolsTokens);
  const skillsPct = getPctStr(skillsTokens);
  const subagentPct = getPctStr(subagentTokens);
  const freePct = getPctStr(freeTokens);

  // 2. Grid matrix calculations (30 columns x 12 rows = 360 total blocks)
  const totalBlocks = 360;
  
  // Calculate blocks proportionally
  const getBlocks = (val: number) => {
    if (val === 0) return 0;
    return Math.max(1, Math.round((val / totalLimit) * totalBlocks));
  };

  const systemBlocks = getBlocks(systemPromptTokens + systemToolsTokens + skillsTokens + subagentTokens) || 2;
  const fileBlocks = getBlocks(fileTokens);
  const userBlocks = getBlocks(userTokens);
  const agentBlocks = getBlocks(agentTokens);
  const toolBlocks = getBlocks(toolTokens);
  const freeBlocks = Math.max(0, totalBlocks - systemBlocks - fileBlocks - userBlocks - agentBlocks - toolBlocks);

  const blocks: Array<{ char: string; color: string }> = [];
  // System blocks (⚙)
  for (let i = 0; i < systemBlocks; i++) blocks.push({ char: "⚙", color: "grey" });
  // File blocks (cyan bullseye "◎")
  for (let i = 0; i < fileBlocks; i++) blocks.push({ char: "◎", color: "cyan" });
  // User blocks (blue bullseye "◎")
  for (let i = 0; i < userBlocks; i++) blocks.push({ char: "◎", color: "#61afef" });
  // Agent blocks (green bullseye "◎")
  for (let i = 0; i < agentBlocks; i++) blocks.push({ char: "◎", color: "#98c379" });
  // Tool blocks (yellow bullseye "◎")
  for (let i = 0; i < toolBlocks; i++) blocks.push({ char: "◎", color: "#e5c07b" });
  // Free blocks (grey square "□")
  for (let i = 0; i < freeBlocks; i++) blocks.push({ char: "□", color: "grey" });

  // Ensure blocks matches exactly 360 length
  while (blocks.length < totalBlocks) {
    blocks.push({ char: "□", color: "grey" });
  }
  if (blocks.length > totalBlocks) {
    blocks.length = totalBlocks;
  }

  const renderGrid = () => {
    const rows = [];
    for (let r = 0; r < 12; r++) {
      const cols = [];
      for (let c = 0; c < 30; c++) {
        const idx = r * 30 + c;
        if (idx < blocks.length) {
          const bl = blocks[idx];
          cols.push(<Text key={c} color={bl.color}>{bl.char} </Text>);
        }
      }
      rows.push(<Box key={r}>{cols}</Box>);
    }
    return rows;
  };

  // Helper for formatting token sizes human-readably
  const formatTokens = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return `${val}`;
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>L Context Usage</Text>
      <Text> </Text>
      <Box flexDirection="row">
        {/* Left Side: Grid Matrix */}
        <Box flexDirection="column" width={62} marginRight={4}>
          {renderGrid()}
        </Box>

        {/* Right Side: Legend & Statistics */}
        <Box flexDirection="column" width={55}>
          <Text bold color="white">
            {modelName} · {formatTokens(activeUsed)}/{formatTokens(totalLimit)} tokens ({usedPct}%)
          </Text>
          <Text dimColor>Token usage by category</Text>
          <Text>
            <Text color="#61afef">◎</Text> User messages: {formatTokens(userTokens)} tokens ({userPct}%)
          </Text>
          <Text>
            <Text color="#98c379">◎</Text> Agent responses: {formatTokens(agentTokens)} tokens ({agentPct}%)
          </Text>
          <Text>
            <Text color="#e5c07b">◎</Text> Tool calls: {formatTokens(toolTokens)} tokens ({toolPct}%)
          </Text>
          <Text>
            <Text color="grey">⚙</Text> System prompt: {formatTokens(systemPromptTokens)} tokens ({systemPromptPct}%)
          </Text>
          <Text>
            <Text color="grey">⚙</Text> System tools: {formatTokens(systemToolsTokens)} tokens ({systemToolsPct}%)
          </Text>
          <Text>
            <Text color="grey">⚙</Text> Skills: {formatTokens(skillsTokens)} tokens ({skillsPct}%)
          </Text>
          <Text>
            <Text color="grey">⚙</Text> Subagents: {formatTokens(subagentTokens)} tokens ({subagentPct}%)
          </Text>
          <Text>
            <Text color="grey">□</Text> Free space: {formatTokens(freeTokens)} tokens ({freePct}%)
          </Text>
          <Text>
            <Text color="#c678dd">☒</Text> Checkpoint buffer: {checkpointBufferTokens} tokens (not counted in usage)
          </Text>
        </Box>
      </Box>

      {/* Checkpoints Section */}
      <Text> </Text>
      <Text bold>Checkpoints ({totalTurns}) · /rewind</Text>
      {totalTurns > 0 ? (
        Array.from({ length: totalTurns }, (_, i) => i + 1)
          .slice(-5)
          .map(turn => (
            <Text key={turn} dimColor>
              L Checkpoint {turn} {turn === totalTurns ? "(active, in context)" : "(stored)"}: step {turn}
            </Text>
          ))
      ) : (
        <Text dimColor>No checkpoints recorded yet.</Text>
      )}

      {/* Artifact Files Section */}
      <Text> </Text>
      <Text bold>Artifact files · /artifact</Text>
      {focusedFiles.length === 0 ? (
        <Text dimColor>No active artifact files focused.</Text>
      ) : (
        focusedFiles.map(f => (
          <Text key={f.path} dimColor>
            L {f.path}: {formatTokens(Math.ceil(f.summary.length / 4))} tokens
          </Text>
        ))
      )}

      {/* System Files Section */}
      <Text> </Text>
      <Text bold>System files · auto-loaded</Text>
      {activeSkills.length === 0 ? (
        <Text dimColor>L ~/.config/voidrift/config.json</Text>
      ) : (
        activeSkills.map((s, idx) => {
          const match = skills?.indexed.find(entry => entry.content === s);
          const pathDisplay = match
            ? match.filePath.replace(process.env.HOME || "", "~")
            : `[dynamic skill ${idx + 1}]`;
          return (
            <Text key={idx} dimColor>
              L {pathDisplay}
            </Text>
          );
        })
      )}

      <Text> </Text>
      <Text dimColor>Related: /artifact · /skill · /rewind</Text>
      <Text> </Text>
      <Box justifyContent="space-between">
        <Text dimColor>esc to cancel</Text>
        <Text dimColor>{modelName}</Text>
      </Box>
    </Box>
  );
}

// ─── /tasks ──────────────────────────────────────────────────────────────────

export function TasksPanel({
  scheduler,
  onClose,
}: {
  scheduler?: TaskScheduler;
  onClose: () => void;
}) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const tasks = scheduler ? scheduler.all : [];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Background Tasks</Text>
      <Text> </Text>
      {tasks.length === 0 ? (
        <Text dimColor>No active background tasks.</Text>
      ) : (
        tasks.map((task) => (
          <Text key={task.id}>
            <Text color={task.status === "active" ? "green" : "grey"}>● </Text>
            <Text color="#61afef">[{task.id}]</Text>{" "}
            <Text bold>({task.type})</Text> {task.instruction} — <Text dimColor>Status: {task.status}</Text>
          </Text>
        ))
      )}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /resume ─────────────────────────────────────────────────────────────────

export function ResumePanel({ onClose }: { onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Conversations</Text>
      <Text> </Text>
      <Text dimColor>No saved conversations found.</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /rewind ─────────────────────────────────────────────────────────────────

export function RewindPanel({ turns, onRewind, onClose }: { turns: number; onRewind: (turn: number) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(turns);
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.min(turns, s + 1));
    if (key.downArrow) setSelected((s) => Math.max(1, s - 1));
    if (key.return) { onRewind(selected); onClose(); }
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Rewind to Turn</Text>
      <Text> </Text>
      {Array.from({ length: turns }, (_, i) => i + 1).reverse().map((t) => (
        <Text key={t}><Text color={t === selected ? "#4ec9b0" : undefined}>{t === selected ? "▸ " : "  "}Turn {t}</Text></Text>
      ))}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Rollback  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /ideas ──────────────────────────────────────────────────────────────────

export function IdeasPanel({ workspaceRoot, onClose }: { workspaceRoot: string; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const [ideas, setIdeas] = useState<Array<{ id: string; title: string; status: string }>>([]);

  React.useEffect(() => {
    const ideasDir = join(workspaceRoot, ".voidrift", "ideas");
    if (!existsSync(ideasDir)) return;
    try {
      const files = readdirSync(ideasDir).filter((f) => f.startsWith("IDEA-") && f.endsWith(".md"));
      const parsed = files.map((f) => {
        const content = readFileSync(join(ideasDir, f), "utf-8");
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const statusMatch = content.match(/status:\s*(\S+)/);
        const idMatch = f.match(/^(IDEA-\d+)/);
        return {
          id: idMatch ? idMatch[1] : f.replace(".md", ""),
          title: titleMatch ? titleMatch[1] : "Untitled Idea",
          status: statusMatch ? statusMatch[1] : "draft",
        };
      });
      setIdeas(parsed);
    } catch {}
  }, [workspaceRoot]);

  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(ideas.length - 1, s + 1));
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Ideas</Text>
      <Text> </Text>
      {ideas.length === 0 ? (
        <Text dimColor>No ideas found. Use <Text color="#61afef">n</Text> to create one.</Text>
      ) : (
        ideas.map((idea, i) => (
          <Text key={idea.id}>
            <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
            <Text color="#61afef" bold>[{idea.id}]</Text> <Text color="green">({idea.status})</Text> {idea.title}
          </Text>
        ))
      )}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>n</Text> New  <Text color="#61afef" bold>d</Text> Delete  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /changes ────────────────────────────────────────────────────────────────

export function ChangesPanel({ workspaceRoot, onClose }: { workspaceRoot: string; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const [changes, setChanges] = useState<Array<{ id: string; title: string; status: string }>>([]);

  React.useEffect(() => {
    const changesDir = join(workspaceRoot, ".voidrift", "changes");
    if (!existsSync(changesDir)) return;
    try {
      const files = readdirSync(changesDir).filter((f) => f.startsWith("CR-") && f.endsWith(".md"));
      const parsed = files.map((f) => {
        const content = readFileSync(join(changesDir, f), "utf-8");
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const statusMatch = content.match(/status:\s*(\S+)/);
        const idMatch = f.match(/^(CR-\d+)/);
        return {
          id: idMatch ? idMatch[1] : f.replace(".md", ""),
          title: titleMatch ? titleMatch[1] : "Untitled Change Request",
          status: statusMatch ? statusMatch[1] : "draft",
        };
      });
      setChanges(parsed);
    } catch {}
  }, [workspaceRoot]);

  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(changes.length - 1, s + 1));
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Change Requests</Text>
      <Text> </Text>
      {changes.length === 0 ? (
        <Text dimColor>No change requests found.</Text>
      ) : (
        changes.map((cr, i) => (
          <Text key={cr.id}>
            <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
            <Text color="#61afef" bold>[{cr.id}]</Text> <Text color="green">({cr.status})</Text> {cr.title}
          </Text>
        ))
      )}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /agents ─────────────────────────────────────────────────────────────────

export function AgentsPanel({ onClose }: { onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Agents</Text>
      <Text> </Text>
      <Text dimColor>No custom agents configured.</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>k</Text> Kill  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── Generic fallback ────────────────────────────────────────────────────────

export function GenericPanel({ name, onClose }: { name: string; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
      <Text> </Text>
      <Text dimColor>/{name}</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
