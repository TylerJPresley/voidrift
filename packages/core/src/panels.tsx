/**
 * TUI Panel Components.
 * Each panel is rendered below the input line, dismissed with ESC.
 * Panels follow the mockup's bordered-box pattern from /mockup.
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { Markdown } from "./ui/markdown.js";
import { Table, type TableRow } from "./ui/table.js";
import { ScrollView } from "./ui/scroll-view.js";
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
import { execSync } from "child_process";
import { TOOL_SCHEMAS } from "./tools/definitions.js";
import type { TaskScheduler } from "./orchestration/scheduler.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { EventBus } from "./events/bus.js";

/** Truncate a string to max length, adding … if cut. Pad to width. */
function trunc(str: string, max: number, pad: number): string {
  const t = str.length > max ? str.slice(0, max - 1) + "…" : str;
  return t.padEnd(pad);
}

/** Format a table cell: truncate content to fit within width (includes 1 char right padding). */
function cell(str: string, width: number): string {
  const max = width - 1;
  const t = str.length > max ? str.slice(0, max - 1) + "…" : str;
  return t.padEnd(width);
}

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
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /help ───────────────────────────────────────────────────────────────────

export function HelpPanel({ registry, sessionId, workspace, onClose }: { registry: CoreRegistry; sessionId: string; workspace: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const pages = ["general", "commands", "shortcuts", "context"];
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.leftArrow) setPage((p) => (p - 1 + 4) % 4);
    if (key.rightArrow) setPage((p) => (p + 1) % 4);
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Help</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box><Text bold color={page === 0 ? "#4ec9b0" : undefined}>{page === 0 ? "[ general ]" : "  general  "}</Text><Text>  </Text><Text bold color={page === 1 ? "#4ec9b0" : undefined}>{page === 1 ? "[ commands ]" : "  commands  "}</Text><Text>  </Text><Text bold color={page === 2 ? "#4ec9b0" : undefined}>{page === 2 ? "[ shortcuts ]" : "  shortcuts  "}</Text><Text>  </Text><Text bold color={page === 3 ? "#4ec9b0" : undefined}>{page === 3 ? "[ context ]" : "  context  "}</Text></Box>
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
      {page === 1 && (() => {
        const hooks = registry.listSlashCommandHooks();
        const core = hooks.filter(c => !c.source || c.source === "core");
        const plugins = new Map<string, typeof hooks>();
        hooks.filter(c => c.source && c.source !== "core").forEach(c => {
          const group = plugins.get(c.source!) || [];
          group.push(c);
          plugins.set(c.source!, group);
        });
        return <>
          <Text bold>Core</Text>
          {core.map((c) => <Text key={c.name}><Text color="#61afef">  {"/" + c.name.padEnd(14)}</Text><Text dimColor>{c.description}</Text></Text>)}
          {[...plugins.entries()].map(([source, cmds]) => <Box key={source} flexDirection="column" marginTop={1}>
            <Text bold>Plugin: {source}</Text>
            {cmds.map((c) => <Text key={c.name}><Text color="#c678dd">  {"/" + c.name.padEnd(14)}</Text><Text dimColor>{c.description}</Text></Text>)}
          </Box>)}
        </>;
      })()}
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
      {page === 3 && <>
        <Text>Context is assembled in four layers ordered by ascending volatility.</Text>
        <Text>Stable layers are cached by the provider. Volatile layers are discarded.</Text>
        <Text> </Text>
        <Text bold color="#98c379">Agent</Text><Text dimColor> Locked to the active agent. Rebuilds when you switch agents.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Persona</Text> the instructions that define the active agent's personality, expertise, and behavior</Text>
        <Text>  • <Text color="#61afef">Tool Schemas</Text> descriptions of every action the agent can perform, so it knows what's available</Text>
        <Text>  • <Text color="#61afef">Bound Skills</Text> technical guidelines permanently attached to this agent (e.g. framework standards)</Text>
        <Text>  • <Text color="#61afef">Skill Discovery Index</Text> a lightweight directory of all skills that could be loaded on demand</Text>
        <Text>  • <Text color="#61afef">Memory Index</Text> a lightweight directory of all saved lessons and learnings available to recall</Text>
        <Text> </Text>
        <Text bold color="#61afef">Orbit</Text><Text dimColor> Stable project landscape. Changes rarely (~5% of turns). Usually cached.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Plan</Text> the step-by-step roadmap the agent is following to complete a task</Text>
        <Text>  • <Text color="#61afef">Active Skills</Text> technical guidelines loaded because the current work triggered them</Text>
        <Text>  • <Text color="#61afef">Active Memory</Text> full lessons and learnings the agent pulled into working memory</Text>
        <Text> </Text>
        <Text bold color="#e5c07b">Drift</Text><Text dimColor> Active working set in motion. Changes on tool use (~30-40% of turns).</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">File Map</Text> a structural overview of every file in the workspace (names, exports, headings)</Text>
        <Text>  • <Text color="#61afef">Active Files</Text> detailed summaries of the specific files the agent is currently working with</Text>
        <Text>  • <Text color="#61afef">Workspace Changes</Text> which files have been modified, added, or deleted since the last save point</Text>
        <Text> </Text>
        <Text bold color="#e06c75">Void</Text><Text dimColor> Transient conversation. Changes every turn. Compacted or discarded.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Messages</Text> the back-and-forth conversation between you and the agent</Text>
        <Text>  • <Text color="#61afef">Diagnostics</Text> errors or warnings from the last build, test, or validation run</Text>
      </>}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> cycle pages  <Text color="#61afef" bold>esc</Text> close</Text>
    </Box>
  );
}

// ─── /tools ──────────────────────────────────────────────────────────────────

export function ToolsPanel({ agents, onClose }: { agents: AgentRegistry; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const agent = agents.active;
  const tools = TOOL_SCHEMAS.filter(t => agent.tools.includes(t.name));

  useInput((_, key) => {
    if (key.escape) { if (detail) setDetail(null); else onClose(); }
    if (!detail) {
      if (key.upArrow) setCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setCursor(c => Math.min(tools.length - 1, c + 1));
      if (key.return && tools[cursor]) setDetail(tools[cursor].name);
    }
  });

  if (detail) {
    const t = tools.find(x => x.name === detail)!;
    const approved = agent.allowedTools.includes(t.name);
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Tools <Text dimColor>›</Text> {t.name}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text><Text color="#61afef">{"Name:".padEnd(16)}</Text>{t.name}</Text>
        <Text><Text color="#61afef">{"Description:".padEnd(16)}</Text>{t.description}</Text>
        <Text><Text color="#61afef">{"Approval:".padEnd(16)}</Text>{approved ? <Text color="green">auto-approved</Text> : <Text color="yellow">requires confirmation</Text>}</Text>
        <Text> </Text>
        <Text bold>Parameters</Text>
        <Text> </Text>
        <Text dimColor>{"Name".padEnd(16)}{"Type".padEnd(10)}{"Required".padEnd(12)}{"Description"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {t.parameters.map(p => (
          <Text key={p.name}><Text color="#61afef">{p.name.padEnd(16)}</Text><Text dimColor>{p.type.padEnd(10)}</Text>{p.required ? <Text color="yellow">{"required".padEnd(12)}</Text> : <Text dimColor>{"optional".padEnd(12)}</Text>}<Text dimColor>{p.description}</Text></Text>
        ))}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>esc</Text> back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Tools <Text dimColor>({agent.name})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Table
        columns={[
          { key: "name", label: "Name", width: 20 },
          { key: "approval", label: "Approval", width: 15 },
          { key: "description", label: "Description" },
        ]}
        rows={tools.map(t => {
          const approved = agent.allowedTools.includes(t.name);
          return { name: t.name, approval: approved ? "auto" : "confirm", description: t.description, _prefix: approved ? "✓ " : "🔒", _prefixColor: approved ? "green" : "yellow" } as TableRow;
        })}
        cursor={cursor}
      />
      <Text> </Text>
      <Text dimColor><Text color="green">✓</Text> auto-approved   <Text color="yellow">🔒</Text> requires confirmation</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close</Text>
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
      activeAgent.modelTier = picked === "auto" ? "auto" : picked as any;
      onClose();
    }
    if (ch === "d") { const picked = items[selected]; if (picked !== "auto") { config.tiers.dense = picked; } }
    if (ch === "u") { const picked = items[selected]; if (picked !== "auto") { config.tiers.utility = picked; } }
    if (ch === "f") { const picked = items[selected]; if (picked !== "auto") { config.tiers.flash = picked; } }
  });

  const columns = [
    { key: "name", label: "Model", width: 22 },
    { key: "tiers", label: "Tiers", width: 10 },
    { key: "detail", label: "Provider / Model" },
  ];

  const rows = items.map(name => {
    if (name === "auto") {
      const label = currentTier === "auto" ? "✓ auto" : "auto";
      return { name: label, tiers: "", detail: "model router decides per turn" };
    }
    const cfg = config.models[name];
    const tierTags = Object.entries(config.tiers).filter(([, v]) => v === name).map(([k]) => k[0]).join(",");
    const label = name === currentTier ? `✓ ${name}` : name;
    return { name: label, tiers: tierTags ? `[${tierTags}]` : "", detail: `${cfg.protocol}/${cfg.model}` };
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Models <Text dimColor>({activeAgent.name} · {currentTier})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Table columns={columns} rows={rows} cursor={selected} />
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Select  <Text color="#61afef" bold>d/u/f</Text> Assign tier  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /plan ───────────────────────────────────────────────────────────────────

export function PlanPanel({ context, onClose }: { context: ContextManager; onClose: () => void }) {
  const plan = context.context.orbit.activePlan;

  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 7;

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (ch === "d" && plan) { context.setPlan(null); onClose(); }
  });

  const lines = plan
    ? plan.split("\n").map((line, i) => <Text key={i}>{line || " "}</Text>)
    : [<Text key="empty" dimColor italic>No active plan. Use plan mode to create one.</Text>];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Active Plan <Text dimColor>({plan ? plan.split("\n").length : 0} lines)</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <ScrollView height={viewHeight} lines={lines} active={!!plan} />
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>pgup/pgdn</Text> Page  <Text color="#61afef" bold>d</Text> Delete  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /diff (full panel) ──────────────────────────────────────────────────────

export function DiffPanel({ workspaceRoot, onClose }: { workspaceRoot: string; onClose: () => void }) {
  const rawLines = React.useMemo(() => {
    try {
      const raw = execSync("git diff --no-color", { cwd: workspaceRoot, encoding: "utf-8" });
      return raw ? raw.split("\n") : [];
    } catch { return []; }
  }, []);

  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 7;

  useInput((_, key) => { if (key.escape) onClose(); });

  const lines = rawLines.length === 0
    ? [<Text key="empty" dimColor>No uncommitted changes.</Text>]
    : rawLines.map((line, i) => {
        const color = line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : line.startsWith("@@") ? "cyan" : undefined;
        return <Text key={i} color={color}>{line || " "}</Text>;
      });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Diff <Text dimColor>({rawLines.length} lines)</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <ScrollView height={viewHeight} lines={lines} />
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>pgup/pgdn</Text> Page  <Text color="#61afef" bold>esc</Text> Close</Text>
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
        <Text dimColor>{"  "}{"Name".padEnd(20)}{"Location".padEnd(15)}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {skillList.map((s, i) => (
          <Box key={`${s.location}-${s.name}`} flexDirection="column">
            <Text>
              <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
              <Text bold color={s.invalid ? "red" : "#61afef"}>{s.invalid ? "[X] " : ""}{trunc(s.name, 18, 20)}</Text>
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
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</Text>
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

  const activeMemory = context.context.orbit.activeMemory;
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
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>l</Text> Load  <Text color="#61afef" bold>u</Text> Unload  <Text color="#61afef" bold>esc</Text> Close</Text>
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
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Actions  <Text color="#61afef" bold>esc</Text> Close</Text>
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
          <Text dimColor><Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Back</Text>
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
          <>
            <Table
              columns={[
                { key: "label", label: "Label", width: 20 },
                { key: "source", label: "Source", width: 15 },
                { key: "override", label: "Override", width: 15 },
                { key: "description", label: "Description" },
              ]}
              rows={systemSlots.map(slot => {
                const resolved = templates.resolveSlot(slot);
                return { label: slot.label, source: slot.sourcePlugin, override: resolved.source, description: slot.description };
              })}
              cursor={cursor}
            />
          </>
        ) : (
          <>
            <Text dimColor>{"  "}{"Name".padEnd(20)}{"Location".padEnd(15)}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {customTemplates.map((t, i) => (
              <Box key={t.key} flexDirection="column">
                <Text>
                  <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                  <Text bold color="#61afef">{trunc(t.key, 18, 20)}</Text>
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
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {isCustomPage ? "Open" : "Details"}  <Text color="#61afef" bold>esc</Text> Close{isCustomPage && <>  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
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
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}  <Text color="#61afef" bold>del</Text> Delete  <Text color="#61afef" bold>esc</Text> Back</Text>
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
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>esc</Text> Close</Text>
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
  const [page, setPage] = useState(0);
  const pages = ["overview", "agent", "orbit", "drift", "void"];

  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.leftArrow) setPage(p => (p - 1 + pages.length) % pages.length);
    if (key.rightArrow) setPage(p => (p + 1) % pages.length);
  });

  const b = budget.state;
  const totalLimit = b.limit;

  const messages = context.getMessages();
  const focusedFiles = context.context.drift.focusedFiles;
  const activeSkills = context.context.orbit.activeSkills;
  const boundSkills = context.context.agent.boundSkills;
  const skillIndex = context.context.agent.skillDiscoveryIndex;
  const memoryIndex = context.context.agent.activeMemoryIndex;
  const activeMemory = context.context.orbit.activeMemory;
  const tools = context.context.agent.activeTools;

  // Token estimates
  const personaTokens = Math.ceil(context.context.agent.activePersona.length / 4);
  const toolsTokens = Math.ceil(JSON.stringify(TOOL_SCHEMAS).length / 4);
  const boundSkillsTokens = boundSkills.reduce((acc, s) => acc + Math.ceil(s.length / 4), 0);
  const skillIndexTokens = skillIndex.reduce((acc, s) => acc + Math.ceil(s.length / 4), 0);
  const memoryIndexTokens = memoryIndex.reduce((acc, m) => acc + Math.ceil((m.title + m.summary).length / 4), 0);

  const activeSkillsTokens = activeSkills.reduce((acc, s) => acc + Math.ceil(s.length / 4), 0);
  const memoryTokens = activeMemory.reduce((acc, m) => acc + Math.ceil(m.length / 4), 0);
  const planTokens = context.context.orbit.activePlan ? Math.ceil(context.context.orbit.activePlan.length / 4) : 0;

  const codeMapTokens = Math.ceil(context.context.orbit.workspaceCodeMap.length / 4);
  const filesTokens = focusedFiles.reduce((acc, f) => acc + Math.ceil(f.summary.length / 4), 0);
  const gitTokens = context.context.drift.gitStatus ? Math.ceil(context.context.drift.gitStatus.length / 4) : 0;

  const msgTokens = messages.filter(m => m.role === "user" || m.role === "assistant").reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const toolResultTokens = messages.filter(m => m.role === "tool").reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const diagTokens = context.context.void.diagnostics ? Math.ceil(context.context.void.diagnostics.length / 4) : 0;

  const agentTotal = personaTokens + toolsTokens + boundSkillsTokens + skillIndexTokens + memoryIndexTokens;
  const orbitTotal = activeSkillsTokens + memoryTokens + planTokens;
  const driftTotal = codeMapTokens + filesTokens + gitTokens;
  const voidTotal = msgTokens + toolResultTokens + diagTokens;
  const totalUsed = agentTotal + orbitTotal + driftTotal + voidTotal;
  const freeTokens = Math.max(0, totalLimit - totalUsed);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const pct = (n: number) => totalLimit > 0 ? ((n / totalLimit) * 100).toFixed(1) : "0";

  const turnCount = messages.filter(m => m.role === "user").length;

  // Grid
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
      <Box>{pages.map((name, i) => (<React.Fragment key={name}><Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${name} ]` : `  ${name}  `}</Text>{i < pages.length - 1 && <Text>  </Text>}</React.Fragment>))}</Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {page === 0 && <>
      <Text bold>Agent <Text dimColor>({fmt(agentTotal)} · {pct(agentTotal)}%) locked to active agent</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: personaTokens, char: "⚙", color: "#61afef" },
            { tokens: toolsTokens, char: "●", color: "#e5c07b" },
            { tokens: boundSkillsTokens, char: "◎", color: "#c678dd" },
            { tokens: skillIndexTokens, char: "▪", color: "#56b6c2" },
            { tokens: memoryIndexTokens, char: "◆", color: "#d19a66" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">⚙</Text> Persona: {fmt(personaTokens)}</Text>
          <Text><Text color="#e5c07b">●</Text> Tool Schemas: {fmt(toolsTokens)} <Text dimColor>({tools.length} tools)</Text></Text>
          <Text><Text color="#c678dd">◎</Text> Bound Skills: {fmt(boundSkillsTokens)} <Text dimColor>({boundSkills.length} loaded)</Text></Text>
          <Text><Text color="#56b6c2">▪</Text> Skill Index: {fmt(skillIndexTokens)} <Text dimColor>({skillIndex.length} available)</Text></Text>
          <Text><Text color="#d19a66">◆</Text> Memory Index: {fmt(memoryIndexTokens)} <Text dimColor>({memoryIndex.length} discovered)</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Orbit <Text dimColor>({fmt(orbitTotal)} · {pct(orbitTotal)}%) stable project landscape</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: activeSkillsTokens, char: "◎", color: "#c678dd" },
            { tokens: memoryTokens, char: "▪", color: "#e5c07b" },
            { tokens: planTokens, char: "◆", color: "#61afef" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#c678dd">◎</Text> Active Skills: {fmt(activeSkillsTokens)} <Text dimColor>({activeSkills.length} triggered)</Text></Text>
          <Text><Text color="#e5c07b">▪</Text> Memory: {fmt(memoryTokens)} <Text dimColor>({activeMemory.length} loaded)</Text></Text>
          <Text><Text color="#61afef">◆</Text> Plan: {fmt(planTokens)} <Text dimColor>{context.context.orbit.activePlan ? "active" : "none"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Drift <Text dimColor>({fmt(driftTotal)} · {pct(driftTotal)}%) active working set</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: codeMapTokens, char: "●", color: "#98c379" },
            { tokens: filesTokens, char: "◎", color: "cyan" },
            { tokens: gitTokens, char: "▪", color: "#56b6c2" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#98c379">●</Text> File Map: {fmt(codeMapTokens)}</Text>
          <Text><Text color="cyan">◎</Text> Active Files: {fmt(filesTokens)} <Text dimColor>({focusedFiles.length}/3 slots)</Text></Text>
          {focusedFiles.map((f, i) => <Text key={i} dimColor>     {f.path} <Text color="gray">({f.totalLines}L{f.readRanges.length ? `, ${f.readRanges.length} range${f.readRanges.length > 1 ? "s" : ""} read` : ""})</Text></Text>)}
          <Text><Text color="#56b6c2">▪</Text> Workspace Changes: {fmt(gitTokens)} <Text dimColor>{context.context.drift.gitStatus ? "modified" : "clean"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Void <Text dimColor>({fmt(voidTotal)} · {pct(voidTotal)}%) transient conversation</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(8, [
            { tokens: msgTokens, char: "◎", color: "#61afef" },
            { tokens: toolResultTokens, char: "●", color: "#e5c07b" },
            { tokens: diagTokens, char: "✗", color: "red" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">◎</Text> Messages: {fmt(msgTokens)} <Text dimColor>({turnCount} turn{turnCount !== 1 ? "s" : ""})</Text></Text>
          <Text><Text color="#e5c07b">●</Text> Tool Results: {fmt(toolResultTokens)}</Text>
          <Text><Text color="red">✗</Text> Diagnostics: {fmt(diagTokens)} <Text dimColor>{context.context.void.diagnostics ? "active" : "none"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>{modelName} · {fmt(totalUsed)}/{fmt(totalLimit)} ({pct(totalUsed)}%) <Text dimColor>Free: {fmt(freeTokens)}</Text></Text>
      </>}
      {page === 1 && <Box flexDirection="column">
        <Text bold>Persona <Text dimColor>({fmt(personaTokens)} tok)</Text></Text>
        <Text dimColor>{context.context.agent.activePersona.slice(0, 200)}{context.context.agent.activePersona.length > 200 ? "…" : ""}</Text>
        <Text> </Text>
        <Text bold>Tools <Text dimColor>({tools.length})</Text></Text>
        <Text dimColor>{tools.join(", ")}</Text>
        <Text> </Text>
        <Text bold>Bound Skills <Text dimColor>({boundSkills.length})</Text></Text>
        {boundSkills.length === 0 ? <Text dimColor>none</Text> : boundSkills.map((s, i) => <Text key={i} dimColor>{s.slice(0, 80)}…</Text>)}
      </Box>}
      {page === 2 && <Box flexDirection="column">
        <Text bold>Active Skills <Text dimColor>({activeSkills.length} triggered)</Text></Text>
        {activeSkills.length === 0 ? <Text dimColor>none</Text> : activeSkills.map((s, i) => <Text key={i} dimColor>{s.slice(0, 100)}…</Text>)}
        <Text> </Text>
        <Text bold>Memory <Text dimColor>({activeMemory.length} loaded)</Text></Text>
        {activeMemory.length === 0 ? <Text dimColor>none</Text> : activeMemory.map((m, i) => <Text key={i} dimColor>{m.slice(0, 100)}…</Text>)}
        <Text> </Text>
        <Text bold>Plan</Text>
        {context.context.orbit.activePlan ? <Text dimColor>{context.context.orbit.activePlan.slice(0, 200)}…</Text> : <Text dimColor>no active plan</Text>}
      </Box>}
      {page === 3 && <Box flexDirection="column">
        <Text bold>File Map <Text dimColor>({fmt(codeMapTokens)} tok)</Text></Text>
        <Text dimColor>{context.context.orbit.workspaceCodeMap ? "loaded" : "empty"}</Text>
        <Text> </Text>
        <Text bold>Active Files <Text dimColor>({focusedFiles.length}/3)</Text></Text>
        {focusedFiles.length === 0 ? <Text dimColor>none</Text> : focusedFiles.map((f, i) => <Box key={i} flexDirection="column"><Text color="#61afef">{f.path} <Text dimColor>({f.totalLines}L · {f.readRanges.length} ranges)</Text></Text><Text dimColor>  {f.summary.slice(0, 120)}…</Text></Box>)}
        <Text> </Text>
        <Text bold>Git Status</Text>
        <Text dimColor>{context.context.drift.gitStatus || "clean"}</Text>
      </Box>}
      {page === 4 && <Box flexDirection="column">
        <Text bold>Messages <Text dimColor>({messages.length})</Text></Text>
        {messages.slice(-10).map((m, i) => <Text key={i} dimColor wrap="truncate">[{m.role}] {m.content.slice(0, 100)}{m.content.length > 100 ? "…" : ""}</Text>)}
        {messages.length > 10 && <Text dimColor>  … {messages.length - 10} older</Text>}
        <Text> </Text>
        <Text bold>Diagnostics</Text>
        <Text dimColor>{context.context.void.diagnostics || "none"}</Text>
      </Box>}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> Tab  <Text color="#61afef" bold>esc</Text> Close</Text>
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
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /resume ─────────────────────────────────────────────────────────────────

export function ResumePanel({ workspaceRoot, currentSessionId, onResume, onClose }: { workspaceRoot: string; currentSessionId: string; onResume: (id: string, messages: Array<{ role: string; content: string }>) => void; onClose: () => void }) {
  const sessionsDir = join(workspaceRoot, ".voidrift", "sessions");
  const sessions: Array<{ id: string; turnCount: number; lastActivity: number; lastMessage: string }> = [];
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir)) {
      const metaPath = join(sessionsDir, name, "system.metadata.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const turnsPath = join(sessionsDir, name, "system.turns.json");
        let lastActivity = meta.startTime || 0;
        if (existsSync(turnsPath)) {
          const turns = JSON.parse(readFileSync(turnsPath, "utf-8"));
          if (turns.length) lastActivity = turns[turns.length - 1].timestamp;
        }
        let lastMessage = "";
        const msgsPath = join(sessionsDir, name, "work.messages.json");
        if (existsSync(msgsPath)) {
          const msgs = JSON.parse(readFileSync(msgsPath, "utf-8"));
          const lastUser = [...msgs].reverse().find((m: any) => m.role === "user");
          if (lastUser) lastMessage = lastUser.content.slice(0, 60).replace(/\n/g, " ");
        }
        sessions.push({ id: name, turnCount: meta.turnCount || 0, lastActivity, lastMessage });
      } catch { continue; }
    }
  }
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);

  const [selected, setSelected] = useState(0);
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected(s => Math.max(0, s - 1));
    if (key.downArrow) setSelected(s => Math.min(sessions.length - 1, s + 1));
    if (key.return && sessions.length > 0) {
      const s = sessions[selected];
      const msgsPath = join(sessionsDir, s.id, "work.messages.json");
      const msgs = existsSync(msgsPath) ? JSON.parse(readFileSync(msgsPath, "utf-8")) : [];
      onResume(s.id, msgs);
    }
  });

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Conversations</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {sessions.length === 0
        ? <Text dimColor>No saved conversations found.</Text>
        : <Table
            columns={[
              { key: "id", label: "Session", width: 12 },
              { key: "turns", label: "Turns", width: 8 },
              { key: "activity", label: "Activity", width: 12 },
              { key: "message", label: "Last Message" },
            ]}
            rows={sessions.map(s => ({
              id: (s.id === currentSessionId ? "● " : "") + s.id.slice(0, 8),
              turns: String(s.turnCount),
              activity: relativeTime(s.lastActivity),
              message: s.lastMessage,
            }))}
            cursor={selected}
            dividers={false}
          />
      }
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Resume  <Text color="#61afef" bold>esc</Text> Close</Text>
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
      <Table
        columns={[
          { key: "turn", label: "Turn", width: 10 },
          { key: "description", label: "Description" },
        ]}
        rows={Array.from({ length: turns }, (_, i) => i + 1).reverse().map(t => ({
          turn: `Turn ${t}`,
          description: t === turns ? "current" : "",
        }))}
        cursor={turns - selected}
        dividers={false}
      />
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Rollback  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

// ─── /agents ─────────────────────────────────────────────────────────────────

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
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── /plugins ────────────────────────────────────────────────────────────────

export function PluginsPanel({
  plugins,
  registry,
  agents,
  workspaceRoot,
  onClose,
}: {
  plugins: PluginRegistry;
  registry: CoreRegistry;
  agents: AgentRegistry;
  workspaceRoot: string;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  const allPlugins = plugins.list();
  const globalConfigPath = join(process.env.HOME || "", ".config", "voidrift", "config.json");
  const wsConfigPath = join(workspaceRoot, ".voidrift", "config.json");

  // Determine scope for each plugin
  const getScope = (id: string): "global" | "workspace" | "available" => {
    let inGlobal = false, inWorkspace = false;
    try { const g = JSON.parse(readFileSync(globalConfigPath, "utf-8")); inGlobal = (g.plugins || []).includes(id); } catch {}
    try { const w = JSON.parse(readFileSync(wsConfigPath, "utf-8")); inWorkspace = (w.plugins || []).includes(id); } catch {}
    if (inWorkspace) return "workspace";
    if (inGlobal) return "global";
    return "available";
  };

  const addToConfig = (id: string, scope: "global" | "workspace") => {
    const targetPath = scope === "global" ? globalConfigPath : wsConfigPath;
    const otherPath = scope === "global" ? wsConfigPath : globalConfigPath;
    // Add to target
    let config: any = {};
    if (existsSync(targetPath)) { try { config = JSON.parse(readFileSync(targetPath, "utf-8")); } catch {} }
    if (!Array.isArray(config.plugins)) config.plugins = [];
    if (!config.plugins.includes(id)) config.plugins.push(id);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(config, null, 2));
    // Remove from the other
    if (existsSync(otherPath)) {
      try {
        const other = JSON.parse(readFileSync(otherPath, "utf-8"));
        if (Array.isArray(other.plugins) && other.plugins.includes(id)) {
          other.plugins = other.plugins.filter((p: string) => p !== id);
          writeFileSync(otherPath, JSON.stringify(other, null, 2));
        }
      } catch {}
    }
    setMessage(`Enabled ${id} (${scope}) — restart to apply`);
    forceRender(n => n + 1);
  };

  const removeFromConfig = (id: string) => {
    for (const path of [globalConfigPath, wsConfigPath]) {
      if (!existsSync(path)) continue;
      try {
        const config = JSON.parse(readFileSync(path, "utf-8"));
        if (Array.isArray(config.plugins)) {
          config.plugins = config.plugins.filter((p: string) => p !== id);
          writeFileSync(path, JSON.stringify(config, null, 2));
        }
      } catch {}
    }
    setMessage(`Disabled ${id} — restart to apply`);
    forceRender(n => n + 1);
  };

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
    if (ch === "g" && allPlugins[cursor]) addToConfig(allPlugins[cursor].id, "global");
    if (ch === "w" && allPlugins[cursor]) addToConfig(allPlugins[cursor].id, "workspace");
    if (ch === "d" && allPlugins[cursor]) removeFromConfig(allPlugins[cursor].id);
  });

  // ─── Detail View ───
  if (detail) {
    const p = allPlugins.find(pl => pl.id === detail)!;
    const pages = ["general", "commands", "agents"];
    const cmds = registry.listSlashCommandHooks().filter(c => c.source === p.id);
    const scope = getScope(p.id);

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
            const scope = getScope(p.id);
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
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Details  <Text color="#61afef" bold>g</Text> enable global  <Text color="#61afef" bold>w</Text> enable workspace  <Text color="#61afef" bold>d</Text> disable  <Text color="#61afef" bold>esc</Text> Close</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}
