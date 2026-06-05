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
import type { AgentRegistry } from "./agents/registry.js";
import type { PromptRegistry } from "./prompts/registry.js";
import type { ContextManager } from "./session/context.js";
import { openInEditor } from "./utils/editor.js";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import { TOOL_SCHEMAS } from "./tools/definitions.js";
import type { TaskScheduler } from "./orchestration/scheduler.js";

// ─── /stats ──────────────────────────────────────────────────────────────────

export function StatsPanel({ stats, budget, onClose }: { stats: StatsTracker; budget: TokenBudgetWatcher; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const s = stats.current;
  const b = budget.state;
  const ctxColor = b.percentage < 50 ? "green" : b.percentage < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Session Summary</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
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
      <Text dimColor color="#333333">{"─".repeat(57)}</Text>
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
    if (key.leftArrow) setPage((p) => (p - 1 + 3) % 3);
    if (key.rightArrow) setPage((p) => (p + 1) % 3);
  });

  const cmds = registry.listSlashCommands().map((name) => ({ name, desc: registry.getSlashCommand(name)?.description ?? "" }));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Help</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box><Text bold color={page === 0 ? "#4ec9b0" : undefined}>{page === 0 ? "[ general ]" : "  general  "}</Text><Text>  </Text><Text bold color={page === 1 ? "#4ec9b0" : undefined}>{page === 1 ? "[ commands ]" : "  commands  "}</Text><Text>  </Text><Text bold color={page === 2 ? "#4ec9b0" : undefined}>{page === 2 ? "[ shortcuts ]" : "  shortcuts  "}</Text></Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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

export function ToolsPanel({ agents, onClose }: { agents: AgentRegistry; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const agent = agents.active;
  const tools = TOOL_SCHEMAS.filter(t => agent.tools.includes(t.name));
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Tools <Text dimColor>({agent.name})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {tools.map((t) => (
        <Text key={t.name}>
          <Text color={agent.allowedTools.includes(t.name) ? "green" : "yellow"}>{agent.allowedTools.includes(t.name) ? "✓ " : "🔒"} </Text>
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

export function ModelPanel({ config, agents, onClose }: { config: VoidRiftConfig; agents: AgentRegistry; onClose: () => void }) {
  const models = Object.keys(config.models);
  const items = ["auto", ...models];
  const [selected, setSelected] = useState(0);

  const activeAgent = agents.active;
  const currentTier = activeAgent.modelTier;

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(items.length - 1, s + 1));
    if (key.return) {
      const picked = items[selected];
      if (picked === "auto") {
        activeAgent.modelTier = "auto";
      } else {
        activeAgent.modelTier = picked as any;
      }
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Models</Text>
      <Text dimColor>Active agent: {activeAgent.name} (current: {currentTier})</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {items.map((name, i) => {
        const isActive = name === currentTier || (name === "auto" && currentTier === "auto");
        if (name === "auto") {
          return (
            <Text key="auto">
              <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
              <Text color="#c678dd">auto</Text>
              <Text dimColor>  (model router decides per turn)</Text>
              {isActive && <Text color="green"> ✓</Text>}
            </Text>
          );
        }
        const cfg = config.models[name];
        const tiers = Object.entries(config.tiers).filter(([, v]) => v === name).map(([k]) => k[0]);
        const tierTag = tiers.length ? ` [${tiers.join(",")}]` : "";
        return (
          <Text key={name}>
            <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
            <Text color="#61afef">{name.padEnd(20)}</Text>
            <Text dimColor>{cfg.protocol}/{cfg.model}</Text>
            <Text color="green">{tierTag}</Text>
            {isActive && <Text color="green"> ✓</Text>}
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Select  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /plan ───────────────────────────────────────────────────────────────────

export function PlanPanel({ context, onClose }: { context: ContextManager; onClose: () => void }) {
  const plan = context.context.workspace.activePlan;

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.delete || (ch === "d" && !plan)) onClose();
    if (ch === "d" && plan) {
      context.setPlan(null);
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Active Plan</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {plan
        ? <Text>{plan}</Text>
        : <Text dimColor italic>No active plan. Use plan mode to create one.</Text>
      }
      <Text> </Text>
      <Text dimColor>  {plan ? <><Text color="#61afef" bold>d</Text> Delete plan  </> : null}<Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /skills ─────────────────────────────────────────────────────────────────

export function SkillsPanel({ skills, config, workspaceRoot, agents, onClose }: { skills: SkillManager; config: VoidRiftConfig; workspaceRoot: string; agents: AgentRegistry; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");

  // Use indexed skills from the manager (already parsed with agents/active)
  const allAgentIds = [...agents.listInteractive(), ...agents.listTask()].map(a => a.id);
  const skillList = skills.indexed.map(s => {
    const hasInvalidAgents = s.agents.some(id => !allAgentIds.includes(id));
    const missingMeta = !s.name || !s.description;
    const raw = readFileSync(s.filePath, "utf-8");
    const missingStructure = !raw.includes("triggers:") || !raw.includes("agents:") || !raw.includes("active:");
    return {
      name: s.name,
      path: s.filePath,
      location: s.filePath.includes(".config/voidrift") ? "global" : "workspace",
      active: s.active,
      invalid: hasInvalidAgents || missingMeta || missingStructure,
    };
  });

  useInput((input, key) => {
    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const dir = createState.scope === "workspace"
            ? join(workspaceRoot, ".voidrift", "skills")
            : join(process.env.HOME || "", ".config", "voidrift", "skills");
          mkdirSync(dir, { recursive: true });
          const filePath = join(dir, `${createName}.md`);
          if (!existsSync(filePath)) {
            writeFileSync(filePath, `---\nname: "${createName}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\nagents: []\nactive: true\n---\n\n`, "utf-8");
          }
          setCreateState(null);
          setCreateName("");
          if (config.editor) {
            openInEditor(filePath, config.editor);
            setMessage(`Created ${createName} — editing`);
          } else {
            setMessage(`Created: ${filePath.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
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
        const item = skillList[cursor];
        if (item) {
          const newPath = join(dirname(item.path), `${renameName}.md`);
          if (!existsSync(newPath)) {
            renameSync(item.path, newPath);
            setMessage(`Renamed: ${item.name} → ${renameName}`);
          } else {
            setMessage(`"${renameName}" already exists`);
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

    if (key.escape) onClose();
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(skillList.length - 1, c + 1));
    if (key.return && skillList[cursor]) {
      if (config.editor) {
        const result = openInEditor(skillList[cursor].path, config.editor);
        setMessage(result.success ? `Opened: ${skillList[cursor].path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
      }
    }
    if (input === "c") {
      setCreateState({ step: "scope" });
      setMessage("Create skill — scope: (g) global  (w) workspace");
    }
    if (input === "r" && skillList[cursor]) {
      setRenaming(true);
      setRenameName("");
      setMessage(`Rename "${skillList[cursor].name}" — enter new id:`);
    }
    if (key.delete && skillList[cursor]) {
      unlinkSync(skillList[cursor].path);
      setMessage(`Deleted: ${skillList[cursor].name}`);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Skills</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {skillList.length === 0 ? (
        <Text dimColor>No skills found.</Text>
      ) : (<>
        <Text dimColor>{"  "}{"Name".padEnd(25)}{"Location".padEnd(15)}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {skillList.map((s, i) => (
          <Box key={`${s.location}-${s.name}`} flexDirection="column">
            <Text>
              <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
              <Text bold color={s.invalid ? "red" : "#61afef"}>{s.invalid ? "[X] " : ""}{s.name.slice(0, 20).padEnd(25)}</Text>
              <Text>{s.location.padEnd(15)}</Text>
            </Text>
            {i < skillList.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
            {i === skillList.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
          </Box>
        ))}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/skills/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/skills/</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Memory</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>MCP Servers</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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

// ─── /templates ──────────────────────────────────────────────────────────────

export function TemplatesPanel({ templates, config, workspaceRoot, onClose }: { templates: TemplateService; config: VoidRiftConfig; workspaceRoot: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const pages = ["system", "custom"];

  const systemSlots = templates.slotsByType("template").filter(s => s.sourcePlugin !== "custom");
  
  // Discover custom templates from filesystem
  const customTemplates: Array<{ key: string; path: string; location: string }> = [];
  const customDirs = [
    { dir: join(process.env.HOME || "", ".config", "voidrift", "templates"), location: "global" },
    { dir: join(workspaceRoot, ".voidrift", "templates"), location: "workspace" },
  ];
  for (const { dir, location } of customDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith(".md")) {
          const key = entry.slice(0, -3);
          if (!systemSlots.find(s => s.key === key)) {
            customTemplates.push({ key, path: join(dir, entry), location });
          }
        }
      }
    } catch {}
  }

  const isCustomPage = page === 1;
  const list = isCustomPage ? customTemplates : systemSlots;

  useInput((input, key) => {
    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter template id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter template id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const dir = createState.scope === "workspace"
            ? join(workspaceRoot, ".voidrift", "templates")
            : join(process.env.HOME || "", ".config", "voidrift", "templates");
          mkdirSync(dir, { recursive: true });
          const filePath = join(dir, `${createName}.md`);
          if (!existsSync(filePath)) {
            writeFileSync(filePath, `---\nname: "${createName}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\n---\n\n`, "utf-8");
          }
          setCreateState(null);
          setCreateName("");
          if (config.editor) {
            openInEditor(filePath, config.editor);
            setMessage(`Created ${createName} — editing`);
          } else {
            setMessage(`Created: ${filePath.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
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
        const item = customTemplates[cursor];
        if (item) {
          const newPath = join(dirname(item.path), `${renameName}.md`);
          if (!existsSync(newPath)) {
            renameSync(item.path, newPath);
            setMessage(`Renamed: ${item.key} → ${renameName}`);
          } else {
            setMessage(`"${renameName}" already exists`);
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
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); return; }
      if (isCustomPage) {
        // Custom detail: just open the file
        if (key.return) {
          const item = customTemplates.find(t => t.key === detail);
          if (item && config.editor) {
            const result = openInEditor(item.path, config.editor);
            setMessage(result.success ? `Opened: ${item.path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
          }
        }
      } else {
        // System detail: override cascade
        if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
        if (key.downArrow) setDetailCursor(c => Math.min(2, c + 1));
        if (key.return) {
          const slot = systemSlots.find(s => s.key === detail);
          if (slot) {
            if (detailCursor === 0) {
              // View default (built-in) — write to temp and open read-only
              const resolved = templates.resolveSlot(slot);
              const tmpDir = join(workspaceRoot, ".voidrift", "cache", "view");
              mkdirSync(tmpDir, { recursive: true });
              const tmpPath = join(tmpDir, `${detail.replace(/\//g, "_")}.md`);
              writeFileSync(tmpPath, resolved.content, "utf-8");
              if (config.editor) {
                const result = openInEditor(tmpPath, config.editor);
                setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "Failed");
              } else {
                setMessage(`Default written to: ${tmpPath.replace(workspaceRoot, ".")} (set "editor" in config)`);
              }
            } else {
              const scope = detailCursor === 1 ? "global" : "workspace";
              const path = templates.createOverrideForSlot(slot, scope as any);
              if (path && config.editor) {
                const result = openInEditor(path, config.editor);
                setMessage(result.success ? `Opened: ${path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
              } else if (path) {
                setMessage(`Created: ${path.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
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
        if (item && config.editor) {
          const result = openInEditor(item.path, config.editor);
          setMessage(result.success ? `Opened: ${item.path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
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
      unlinkSync(item.path);
      setMessage(`Deleted: ${item.key}`);
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
            <Text dimColor>{item?.path.replace(process.env.HOME || "", "~").replace(workspaceRoot, ".") || ""}</Text>
          </Text>
          <Text> </Text>
          <Text dimColor>  <Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Back</Text>
          {message && <Text color="#4ec9b0">{message}</Text>}
        </Box>
      );
    }

    const slot = systemSlots.find(s => s.key === detail);
    const wsPath = join(workspaceRoot, ".voidrift", "templates", `${detail}.md`);
    const globalPath = join(process.env.HOME || "", ".config", "voidrift", "templates", `${detail}.md`);
    const wsExists = existsSync(wsPath);
    const globalExists = existsSync(globalPath);
    const activeLevel = wsExists ? "workspace" : globalExists ? "global" : "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)", scope: "default" as const },
      { level: "Global", active: activeLevel === "global", path: globalExists ? globalPath.replace(process.env.HOME || "", "~") : undefined, scope: "global" as const },
      { level: "Workspace", active: activeLevel === "workspace", path: wsExists ? wsPath.replace(workspaceRoot, ".") : undefined, scope: "workspace" as const },
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
        <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}  <Text color="#61afef" bold>esc</Text> Back</Text>
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
          <>
            <Text dimColor>{"  "}{"Label".padEnd(25)}{"Source".padEnd(25)}{"Override"}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {systemSlots.map((slot, i) => {
              const resolved = templates.resolveSlot(slot);
              const override = resolved.source;
              return (
                <Box key={`${slot.sourcePlugin}-${slot.key}`} flexDirection="column">
                  <Text>
                    <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                    <Text bold color="#61afef">{slot.label.slice(0, 20).padEnd(25)}</Text>
                    <Text>{slot.sourcePlugin.slice(0, 20).padEnd(25)}</Text>
                    <Text>{override}</Text>
                  </Text>
                  {i < systemSlots.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
                  {i === systemSlots.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
                </Box>
              );
            })}
          </>
        ) : (
          <>
            <Text dimColor>{"  "}{"Name".padEnd(25)}{"Location".padEnd(15)}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {customTemplates.map((t, i) => (
              <Box key={t.key} flexDirection="column">
                <Text>
                  <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                  <Text bold color="#61afef">{t.key.slice(0, 20).padEnd(25)}</Text>
                  <Text>{t.location.padEnd(15)}</Text>
                </Text>
                {i < customTemplates.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
                {i === customTemplates.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
              </Box>
            ))}
          </>
        )}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/templates/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/templates/</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {isCustomPage ? "Open" : "Details"}  <Text color="#61afef" bold>esc</Text> Close{isCustomPage && <>  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
    </Box>
  );
}

// ─── /prompts ────────────────────────────────────────────────────────────────

export function PromptsPanel({ prompts, config, workspaceRoot, onClose }: { prompts: PromptRegistry; config: VoidRiftConfig; workspaceRoot: string; onClose: () => void }) {
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
          // View default (built-in)
          const resolved = prompts.resolve(detail!);
          const tmpDir = join(workspaceRoot, ".voidrift", "cache", "view");
          mkdirSync(tmpDir, { recursive: true });
          const tmpPath = join(tmpDir, `${detail!.replace(/\//g, "_")}_prompt.md`);
          writeFileSync(tmpPath, resolved?.body || "", "utf-8");
          if (config.editor) {
            const result = openInEditor(tmpPath, config.editor);
            setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "Failed");
          } else {
            setMessage(`Default written to: ${tmpPath.replace(workspaceRoot, ".")} (set "editor" in config)`);
          }
        } else {
          const scope = detailCursor === 1 ? "global" : "workspace";
          const path = prompts.createOverride(detail!, scope as any);
          if (path && config.editor) {
            const result = openInEditor(path, config.editor);
            setMessage(result.success ? `Opened: ${path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
          } else if (path) {
            setMessage(`Created: ${path.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
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
    const wsPath = join(workspaceRoot, ".voidrift", "prompts", `${detail}.md`);
    const globalPath = join(process.env.HOME || "", ".config", "voidrift", "prompts", `${detail}.md`);
    const wsExists = existsSync(wsPath);
    const globalExists = existsSync(globalPath);
    const activeLevel = wsExists ? "workspace" : globalExists ? "global" : "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)" },
      { level: "Global", active: activeLevel === "global", path: globalExists ? globalPath.replace(process.env.HOME || "", "~") : undefined },
      { level: "Workspace", active: activeLevel === "workspace", path: wsExists ? wsPath.replace(workspaceRoot, ".") : undefined },
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
        <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}  <Text color="#61afef" bold>del</Text> Delete  <Text color="#61afef" bold>esc</Text> Back</Text>
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
        <Text dimColor>{"  "}{"Label".padEnd(25)}{"Source".padEnd(25)}{"Override"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {entries.map((entry, i) => {
          const resolved = prompts.resolve(entry.key);
          const override = resolved?.source || "default";
          return (
            <Box key={entry.key} flexDirection="column">
              <Text>
                <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                <Text bold color="#61afef">{entry.label.slice(0, 20).padEnd(25)}</Text>
                <Text>{entry.sourcePlugin.slice(0, 20).padEnd(25)}</Text>
                <Text>{override}</Text>
              </Text>
              {i < entries.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
              {i === entries.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
            </Box>
          );
        })}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/prompts/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/prompts/</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close</Text>
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
  onClose,
}: {
  budget: TokenBudgetWatcher;
  context: ContextManager;
  stats: StatsTracker;
  modelName: string;
  skills: SkillManager;
  onClose: () => void;
}) {
  useInput((_, key) => { if (key.escape) onClose(); });

  const b = budget.state;
  const totalLimit = b.limit;

  const messages = context.getMessages();
  const focusedFiles = context.context.workspace.focusedFiles;
  const activeSkills = context.context.governance.activeSkills;

  // Token estimates
  const promptTokens = Math.ceil(context.context.governance.activePersona.length / 4);
  const toolsTokens = Math.ceil(JSON.stringify(TOOL_SCHEMAS).length / 4);
  const skillsTokens = activeSkills.reduce((acc, s) => acc + Math.ceil(s.length / 4), 0);
  const filesTokens = focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
  const codeMapTokens = Math.ceil(context.context.workspace.workspaceCodeMap.length / 4);
  const memoryTokens = context.context.workspace.activeMemory.reduce((acc, m) => acc + Math.ceil(m.length / 4), 0);
  const planTokens = context.context.workspace.activePlan ? Math.ceil(context.context.workspace.activePlan.length / 4) : 0;
  const msgTokens = messages.filter(m => m.role === "user" || m.role === "assistant").reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const toolResultTokens = messages.filter(m => m.role === "tool").reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const diagTokens = context.context.work.diagnostics ? Math.ceil(context.context.work.diagnostics.length / 4) : 0;

  const govTotal = promptTokens + toolsTokens + skillsTokens;
  const wsTotal = filesTokens + codeMapTokens + memoryTokens + planTokens;
  const workTotal = msgTokens + toolResultTokens + diagTokens;
  const totalUsed = govTotal + wsTotal + workTotal;
  const freeTokens = Math.max(0, totalLimit - totalUsed);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const pct = (n: number) => ((n / totalLimit) * 100).toFixed(1);

  // Grid: each partition's grid shows fill relative to totalLimit
  // blocks filled = (partitionTokens / totalLimit) * totalBlocks
  const renderGrid = (rows: number, items: Array<{ tokens: number; char: string; color: string }>) => {
    const totalBlocks = rows * 30;
    const blocks: Array<{ char: string; color: string }> = [];

    for (const item of items) {
      const count = Math.round((item.tokens / totalLimit) * totalBlocks);
      for (let i = 0; i < count && blocks.length < totalBlocks; i++) {
        blocks.push({ char: item.char, color: item.color });
      }
    }
    while (blocks.length < totalBlocks) blocks.push({ char: "□", color: "grey" });

    const gridRows = [];
    for (let r = 0; r < rows; r++) {
      const cols = [];
      for (let c = 0; c < 30; c++) {
        const bl = blocks[r * 30 + c];
        cols.push(<Text key={c} color={bl.color}>{bl.char} </Text>);
      }
      gridRows.push(<Box key={r}>{cols}</Box>);
    }
    return gridRows;
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Context</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Text bold>Governance <Text dimColor>({fmt(govTotal)} · {pct(govTotal)}%)</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: promptTokens, char: "⚙", color: "#61afef" },
            { tokens: toolsTokens, char: "●", color: "#e5c07b" },
            { tokens: skillsTokens, char: "◎", color: "#c678dd" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">⚙</Text> Prompt: {fmt(promptTokens)}</Text>
          <Text><Text color="#e5c07b">●</Text> Tools: {fmt(toolsTokens)}</Text>
          <Text><Text color="#c678dd">◎</Text> Skills: {fmt(skillsTokens)}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Workspace <Text dimColor>({fmt(wsTotal)} · {pct(wsTotal)}%)</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: filesTokens, char: "◎", color: "cyan" },
            { tokens: codeMapTokens, char: "●", color: "#98c379" },
            { tokens: memoryTokens, char: "▪", color: "#e5c07b" },
            { tokens: planTokens, char: "◆", color: "#61afef" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="cyan">◎</Text> Files: {fmt(filesTokens)}</Text>
          <Text><Text color="#98c379">●</Text> Code Map: {fmt(codeMapTokens)}</Text>
          <Text><Text color="#e5c07b">▪</Text> Memory: {fmt(memoryTokens)}</Text>
          <Text><Text color="#61afef">◆</Text> Plan: {fmt(planTokens)}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Work <Text dimColor>({fmt(workTotal)} · {pct(workTotal)}%)</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(12, [
            { tokens: msgTokens, char: "◎", color: "#61afef" },
            { tokens: toolResultTokens, char: "●", color: "#e5c07b" },
            { tokens: diagTokens, char: "✗", color: "red" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">◎</Text> Messages: {fmt(msgTokens)}</Text>
          <Text><Text color="#e5c07b">●</Text> Tool Results: {fmt(toolResultTokens)}</Text>
          <Text><Text color="red">✗</Text> Diagnostics: {fmt(diagTokens)}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>{modelName} · {fmt(totalUsed)}/{fmt(totalLimit)} ({pct(totalUsed)}%) <Text dimColor>Free: {fmt(freeTokens)}</Text></Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>esc</Text> Close</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Background Tasks</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Conversations</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Rewind to Turn</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Ideas</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Change Requests</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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

export function AgentsPanel({
  agents,
  config,
  workspaceRoot,
  onClose,
}: {
  agents: AgentRegistry;
  config: VoidRiftConfig;
  workspaceRoot: string;
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
  const pages = ["system interactive", "system task", "custom interactive", "custom task"];

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
            openInEditor(path, config.editor);
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
        <Text bold>Agent Details: {detail}</Text>
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
        <Text dimColor>  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {editableRows[detailCursor]?.level === "Default" ? "View" : "Open/Create"}  <Text color="#61afef" bold>esc</Text> Back{isCustomAgent && <>  │  <Text color="#61afef" bold>r</Text> Reset  <Text color="#61afef" bold>del</Text> Delete</>}{!isCustomAgent && <>  │  <Text color="#61afef" bold>del</Text> Delete</>}</Text>
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
        <Text dimColor>{"  "}{"Name".padEnd(25)}{!isCustomPage ? "Source".padEnd(15) : "Location".padEnd(15)}{isCustomPage ? "Active".padEnd(10) : ""}{!isCustomPage ? "Override (config/prompt)" : ""}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {list.map((a, i) => {
          const globalDir = join(process.env.HOME || "", ".config", "voidrift", "agents", a.id);
          const wsDir = join(workspaceRoot, ".voidrift", "agents", a.id);
          const configOverride = existsSync(join(wsDir, "agent.json")) ? "workspace" : existsSync(join(globalDir, "agent.json")) ? "global" : "default";
          const promptOverride = existsSync(join(wsDir, "prompt.md")) ? "workspace" : existsSync(join(globalDir, "prompt.md")) ? "global" : "default";
          return (
            <Box key={a.id} flexDirection="column">
              <Text>
                <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
                <Text bold color="#61afef">{a.name.slice(0, 20).padEnd(25)}</Text>
                <Text>{(isCustomPage
                  ? (existsSync(join(workspaceRoot, ".voidrift", "agents", a.id)) ? "workspace" : "global")
                  : (a.source || "core")).slice(0, 12).padEnd(15)}</Text>
                {isCustomPage && <Text color={a.active !== false ? "green" : "red"}>{(a.active !== false ? "yes" : "no").padEnd(10)}</Text>}
                {!isCustomPage && <Text>{configOverride} / {promptOverride}</Text>}
              </Text>
              {i < list.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
              {i === list.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
            </Box>
          );
        })}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/agents/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/agents/</Text>
      <Text> </Text>
      <Text dimColor>  <Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close{isCustomPage && <>  │  <Text color="#61afef" bold>a</Text> toggle active  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
    </Box>
  );
}

// ─── Generic fallback ────────────────────────────────────────────────────────

export function GenericPanel({ name, onClose }: { name: string; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
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
