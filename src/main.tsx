#!/usr/bin/env node
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { RawInput } from "./ui/raw-input.js";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync, statSync } from "fs";
import {
  bootstrap,
  ContextManager,
  TokenBudgetWatcher,
  SessionBrain,
  MemoryRegistry,
  PlanManager,
  SkillManager,
  AuditLogger,
  ExceptionGuard,
  StatsTracker,
  TemplateService,
  MCPEngine,
  WorktreeEngine,
  GitCheckpointer,
  CoreRegistry,
  registerCommands,
  setWorkspaceRoot,
  setScheduler,
  setPlanManager,
  generateCodeMap,
  getGitBranch,
  shortenPath,
  AgentRegistry,
  PromptRegistry,
  type StreamChunk,
  TaskScheduler,
  CoreAPI,
  AutocompleteEngine,
  PolicyEngine,
} from "./index.js";
import {
  StatsPanel, HelpPanel, ToolsPanel, ModelPanel, MemoryPanel, GenericPanel,
  SkillsPanel, MCPPanel, TemplatesPanel, PromptsPanel, ContextPanel, TasksPanel,
  ResumePanel, RewindPanel, AgentsPanel, PlanPanel, DiffPanel,
  PluginsPanel, PolicyPanel, HistoryPanel,
} from "./panels.js";
import { PluginRegistry, discoverPlugins } from "./plugins/registry.js";
import type { EngineContext } from "./engine.js";
import { executeTurn } from "./turn.js";
import { validateEditor } from "./utils/editor.js";
import { validateAssets } from "./bootstrap/validate.js";
import { ResourceWatcher } from "./watcher/resources.js";
import { clipboardHasImage, saveClipboardImage } from "./utils/clipboard.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolStatus = "pending" | "executing" | "success" | "error";

interface ToolCall {
  name: string;
  args: string;
  status: ToolStatus;
  result?: string;
  elapsed?: string;
}

interface UserMsg { id: string; type: "user"; text: string }
interface AssistantMsg { id: string; type: "assistant"; model: string; text: string; stats?: string }
interface ToolMsg { id: string; type: "tools"; tools: ToolCall[] }
interface SystemMsg { id: string; type: "system"; text: string }
interface DiffMsg { id: string; type: "diff"; summary: string; lines: string[] }
interface CalloutMsg { id: string; type: "callout"; level: "warning" | "info" | "error"; text: string }

type HistoryItem = UserMsg | AssistantMsg | ToolMsg | SystemMsg | DiffMsg | CalloutMsg;

// ─── Presentational Components ───────────────────────────────────────────────

function Welcome({ model, workspace, branch }: { model: string; workspace: string; branch: string | null }) {
  const logo = [
    "██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗",
    "██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝",
    "██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   ",
    "╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   ",
    " ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   ",
    "  ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ",
  ];
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Box>
        <Box flexDirection="column">
          {logo.map((line, i) => <Text key={i} color="#6a7ec8">{line}</Text>)}
        </Box>
        <Box flexDirection="column" justifyContent="center" marginLeft={2}>
          <Text><Text color="#4ec9b0" bold>VoidRift</Text><Text dimColor> 0.1.0</Text></Text>
          <Text dimColor>{model}</Text>
          <Text dimColor>{workspace}</Text>
          {branch && <Text dimColor>{branch}</Text>}
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  );
}

function UserMessage({ text, isFirst }: { text: string; isFirst?: boolean }) {
  return (
    <Box marginTop={isFirst ? 0 : 1} marginBottom={1} width={(process.stdout.columns || 80)}>
      <Text color="#6a7ec8">┃ </Text>
      <Text bold wrap="wrap">{text}</Text>
    </Box>
  );
}

/** Get a human-readable description and color for a tool call */
function describeToolCall(name: string, argsStr: string): { label: string; description: string; color: string } {
  let args: Record<string, any> = {};
  try { args = JSON.parse(argsStr); } catch {}

  const friendly: Record<string, string> = {
    read_file: "Read", glob_files: "Glob", search_contents: "Search", workspace_map: "Map", write_file: "Write", edit_file: "Edit",
    execute_command: "Run", web_search: "Search", web_fetch: "Fetch",
    save_memory: "Remember", schedule: "Schedule",
    read_plan: "Plan", write_plan: "Plan", add_plan: "Plan", remove_plan: "Plan", prioritize_plan: "Plan", update_plan: "Plan",
    run_task_agent: "Task Agent", spawn_subagent: "Subagent",
    escalate: "Escalate", deescalate: "De-escalate",
  };

  // MCP tools: mcp_server_toolname → MCP:server:toolname
  if (name.startsWith("mcp_")) {
    const parts = name.match(/^mcp_([^_]+)_(.+)$/);
    const serverName = parts?.[1] ?? "";
    const toolName = parts?.[2] ?? name;
    const desc = Object.values(args).filter(v => typeof v === "string").join(", ").slice(0, 60) || argsStr.slice(0, 60);
    return { label: `MCP:${serverName}:${toolName}`, description: desc, color: "magenta" };
  }

  const label = friendly[name] || name;

  switch (name) {
    case "read_file": {
      const path = args.path || "file";
      const range = args.offset !== undefined ? `:${args.offset + 1}-${(args.offset || 0) + (args.limit || "end")}` : "";
      return { label, description: `${path}${range}`, color: "green" };
    }
    case "glob_files":
      return { label, description: args.pattern || "pattern", color: "green" };
    case "search_contents":
      return { label, description: `${args.pattern || "pattern"}${args.include ? ` in ${args.include}` : ""}`, color: "green" };
    case "write_file":
      return { label, description: args.path || "file", color: "blue" };
    case "edit_file":
      return { label, description: args.path || "file", color: "blue" };
    case "execute_command":
      return { label, description: args.command?.slice(0, 60) || "command", color: "yellow" };
    case "web_search":
      return { label, description: args.query?.slice(0, 60) || "query", color: "cyan" };
    case "web_fetch":
      return { label, description: args.url?.slice(0, 60) || "url", color: "cyan" };
    case "read_plan":
      return { label, description: args.name ? `load ${args.name}` : "list items", color: "#61afef" };
    case "add_plan":
      return { label, description: `add ${args.name || ""}`.trim(), color: "#61afef" };
    case "remove_plan":
      return { label, description: `remove ${args.name || ""}`.trim(), color: "#61afef" };
    case "prioritize_plan":
      return { label, description: `${args.name || ""} → ${args.priority || "?"}`.trim(), color: "#61afef" };
    case "update_plan":
      return { label, description: `edit ${args.name || "item"}`, color: "#61afef" };
    case "save_memory":
      return { label, description: args.title?.slice(0, 40) || "memory", color: "#d19a66" };
    case "escalate":
      return { label, description: args.reason?.slice(0, 60) || "requesting dense model", color: "red" };
    case "deescalate":
      return { label, description: "returning to utility", color: "green" };
    default:
      return { label, description: argsStr.slice(0, 60), color: "gray" };
  }
}

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  return (
    <Box flexDirection="column" marginLeft={1}>
      {tools.map((tool, i) => {
        const { label, description, color } = describeToolCall(tool.name, tool.args);
        const hasDiff = tool.result?.includes("\n---DIFF---\n");
        const summary = hasDiff ? tool.result!.split("\n---DIFF---\n")[0] : tool.result;
        const diffLines = hasDiff ? tool.result!.split("\n---DIFF---\n")[1].split("\n") : [];
        return (
          <Box key={i} flexDirection="column">
            <Box flexDirection="row">
              <ToolStatusIcon status={tool.status} color={color} />
              <Text bold>{label}</Text>
              <Text color={color}>  {description}</Text>
              {tool.elapsed && tool.status !== "executing" && <Text dimColor>  {tool.elapsed}</Text>}
            </Box>
            {summary && tool.status !== "executing" && !summary.startsWith("Error:") && tool.name !== "search_contents" && (
              <Text dimColor wrap="wrap">  {summary.split("\n")[0]}</Text>
            )}
            {diffLines.length > 0 && tool.status !== "executing" && (
              <Box flexDirection="column" paddingLeft={2}>
                {diffLines.slice(0, 20).map((line, j) => (
                  <Text key={j} color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined} dimColor={line.startsWith("@@")}>{line}</Text>
                ))}
                {diffLines.length > 20 && <Text dimColor>  ...{diffLines.length - 20} more lines</Text>}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ToolStatusIcon({ status, color }: { status: ToolStatus; color?: string }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    if (status !== "executing") return;
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, [status]);

  if (status === "success") return <Text color={color || "green"}>● </Text>;
  if (status === "error") return <Text color="red">✗ </Text>;
  if (status === "executing") return <Text color="yellow">{frames[frame]} </Text>;
  return <Text color="gray">○ </Text>;
}
function DiffDisplay({ summary, lines }: { summary: string; lines: string[] }) {
  let addLine = 0;
  let delLine = 0;
  // Parse hunk header for starting line numbers
  const hunkMatch = lines[0]?.match(/@@ -(\d+).*\+(\d+)/);
  if (hunkMatch) { delLine = parseInt(hunkMatch[1]) - 1; addLine = parseInt(hunkMatch[2]) - 1; }

  return (
    <Box flexDirection="column" marginLeft={1} marginTop={1}>
      <Text dimColor>{summary}</Text>
      {lines.map((line, i) => {
        if (line.startsWith("@@")) return <Text key={i} color="cyan" dimColor>{line}</Text>;
        let num = "";
        if (line.startsWith("+")) { addLine++; num = `${addLine}+`; }
        else if (line.startsWith("-")) { delLine++; num = `${delLine}-`; }
        else { addLine++; delLine++; num = `${addLine}`; }
        const color = line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined;
        return (
          <Box key={i}>
            <Text dimColor>{num.padStart(4)} </Text>
            <Text color={color} dimColor={!color}>{line.slice(1)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

import { Markdown } from "./ui/markdown.js";

function AssistantMessage({ model, text, stats, prevType }: { model: string; text: string; stats?: string; prevType?: string }) {
  return (
    <Box flexDirection="column" marginTop={prevType === "user" ? 0 : 1}>
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column" width={(process.stdout.columns || 80) - 1}>
        <Markdown text={text.trim()} />
      </Box>
      {stats && <Text dimColor>  · {stats}</Text>}
    </Box>
  );
}

function StreamingResponse({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column">
        <Markdown text={text.trim()} />
        <Text color="#6a7ec8">▊</Text>
      </Box>
      <Text dimColor>  ⠹ {elapsed}s · {tokens} tokens</Text>
    </Box>
  );
}

function ThinkingIndicator({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color="yellow">  {frames[frame]} {label}</Text>;
}

function SlashAutocomplete({ input, registry, selected }: { input: string; registry: CoreRegistry; selected: number }) {
  const query = input === "" ? "" : input.slice(1).toLowerCase();
  const all = registry.listSlashCommands()
    .map(name => ({ name, description: registry.getSlashCommand(name)!.description }))
    .filter(c => c.name.startsWith(query));
  if (!all.length) return null;
  const maxVisible = 5;
  const start = Math.min(Math.max(0, selected - 2), Math.max(0, all.length - maxVisible));
  const visible = all.slice(start, start + maxVisible);
  const remaining = all.length - start - visible.length;
  const maxName = Math.max(...visible.map(c => c.name.length + 1));
  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text dimColor>{'─'.repeat((process.stdout.columns || 80) - 1)}</Text>
      {visible.map((cmd, i) => {
        const idx = start + i;
        return (
          <Box key={cmd.name}>
            <Text color={idx === selected ? "#6a7ec8" : undefined}>{idx === selected ? "❯" : " "} </Text>
            <Text color={idx === selected ? "#6a7ec8" : "white"} bold>{"/" + cmd.name.padEnd(maxName)}</Text>
            <Text dimColor>  {cmd.description}</Text>
          </Box>
        );
      })}
      {remaining > 0 && <Text dimColor>  ↓ {remaining} more</Text>}
      <Text dimColor>  ↑↓ Navigate  <Text color="green" bold>enter</Text> Select  <Text color="#6a7ec8" bold>tab</Text> Complete  <Text color="#6a7ec8" bold>esc</Text> Close</Text>
    </Box>
  );
}

function Footer({ mode, model, contextPct, workspace, branch, tasks }: { mode: string; model: string; contextPct: number; workspace: string; branch: string | null; tasks: number }) {
  const ctxColor = contextPct < 50 ? "green" : contextPct < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(process.stdout.columns || 80)}</Text>
      <Box justifyContent="space-between" paddingX={1}>
        <Text>
          <Text color="#6a7ec8">[{mode}]</Text>
          <Text> voidrift</Text>
          <Text dimColor> · </Text>
          <Text>{model}</Text>
          <Text dimColor> · </Text>
          <Text color={ctxColor}>◎ {contextPct}%</Text>
          {tasks > 0 && <><Text dimColor> · </Text><Text color="#d19a66">⟳ {tasks}</Text></>}
        </Text>
        <Text>
          <Text color="#61afef">{workspace}</Text>
          {branch && <><Text dimColor> · </Text><Text color="#00d4ff">{branch}</Text></>}
        </Text>
      </Box>
    </Box>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App({ engine }: { engine: EngineContext }) {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streaming, setStreaming] = useState<{ model: string; text: string; elapsed: number; tokens: number } | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<ToolCall[] | null>(null);
  const [pendingTurn, setPendingTurn] = useState<HistoryItem[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [clearKey, setClearKey] = useState(0);
  const [input, setInput] = useState("");
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [fullPanel, setFullPanel] = useState<string | null>(null);
  const [acIdx, setAcIdx] = useState(0);
  const [acOpen, setAcOpen] = useState(false);
  const acIdxRef = React.useRef(0);
  acIdxRef.current = acIdx;
  const [inputKey, setInputKey] = useState(0);
  const inputHistoryRef = React.useRef<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const draftRef = React.useRef("");
  const fileAcRef = React.useRef<AutocompleteEngine>((() => { const e = new AutocompleteEngine(); e.indexWorkspace(engine.workspaceRoot); return e; })());

  // Re-index file completions when files are created/deleted
  useEffect(() => {
    const unsub1 = engine.container.bus.subscribe("FILE_CREATED", () => { fileAcRef.current.indexWorkspace(engine.workspaceRoot); });
    const unsub2 = engine.container.bus.subscribe("FILE_DELETED", () => { fileAcRef.current.indexWorkspace(engine.workspaceRoot); });
    return () => { unsub1(); unsub2(); };
  }, []);

  const [exitPending, setExitPending] = useState(false);
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useState(0);

  // Tool confirmation state
  const [confirmRequest, setConfirmRequest] = useState<{ tool: string; args: Record<string, unknown>; requestId: string; diff?: string[]; inferredPatterns?: string[] } | null>(null);
  const [confirmIdx, setConfirmIdx] = useState(0);

  // Build dynamic options from the confirmation request
  const confirmOptions = React.useMemo(() => {
    if (!confirmRequest) return [];
    const opts: { label: string; approved: boolean; persist?: boolean; pattern?: string }[] = [
      { label: "Yes, allow once", approved: true },
    ];
    const patterns = confirmRequest.inferredPatterns || [];
    for (const p of patterns) {
      const displayPattern = p.startsWith("mcp_") ? p.replace(/^mcp_([^_]+)_(.+)$/, "MCP:$1:$2").replace(/^mcp_([^_]+)_\*$/, "MCP:$1:*") : p;
      opts.push({ label: `Trust, always allow "${displayPattern}"`, approved: true, persist: true, pattern: p });
    }
    opts.push({ label: "No", approved: false });
    return opts;
  }, [confirmRequest]);

  // Subscribe to tool confirmation requests from the permission gate
  useEffect(() => {
    return engine.container.bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event: any) => {
      setConfirmRequest(event.payload);
      setConfirmIdx(0);
    });
  }, []);

  // Handle confirmation response
  const respondConfirmation = useCallback((optionIdx: number) => {
    if (confirmRequest && confirmOptions[optionIdx]) {
      const opt = confirmOptions[optionIdx];
      engine.container.bus.publish("TOOL_CONFIRMATION_RESPONSE", {
        requestId: confirmRequest.requestId,
        approved: opt.approved,
        persist: opt.persist,
        chosenPattern: opt.pattern,
      } as any);
      setConfirmRequest(null);
    }
  }, [confirmRequest, confirmOptions]);

  // Helper: activate an agent — sets persona, mode, loads resources
  const activateAgent = (agentId: string) => {
    const agent = engine.agents.setActive(agentId);
    const basePrompt = engine.prompts.resolve("chat")?.body || "";
    const persona = agent.prompt ? `${agent.prompt}\n\n${basePrompt}` : basePrompt;
    engine.context.setPersona(persona);
    engine.context.setTools(agent.tools);
    // Load bound skills by name (must be registered with VoidRift)
    const boundSkills: string[] = [];
    if (agent.skills?.length) {
      for (const skillName of agent.skills) {
        const skill = engine.skills.indexed.find(s => s.name === skillName);
        if (skill) boundSkills.push(skill.content);
      }
    }
    engine.context.setBoundSkills(boundSkills);
    // Load file resources
    if (agent.resources) {
      for (const uri of agent.resources) {
        if (uri.startsWith("file://")) {
          const rawPath = uri.slice(7);
          const isAbsolute = rawPath.startsWith("/");
          const relPath = isAbsolute ? rawPath : rawPath.replace(/^\.\//, "");
          const absPath = isAbsolute ? rawPath : join(engine.workspaceRoot, relPath);
          if (existsSync(absPath)) {
            const content = readFileSync(absPath, "utf-8");
            const lines = content.split("\n").length;
            if (lines <= (engine.container.config.summarizeThreshold ?? 500)) {
              engine.context.focusFile(relPath, content, lines);
            } else {
              engine.context.focusFile(relPath, `[Resource: ${relPath}] ${lines} lines. Use read_file("${relPath}", offset, limit) to access content.`, lines);
            }
          }
        }
      }
    }
    setHistory(h => [...h, { id: id(), type: "system", text: agent.welcomeMessage || `Switched to ${agent.name}` }]);
  };

  // Re-render on terminal resize
  useEffect(() => {
    const onResize = () => forceRender(n => n + 1);
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  // Show startup warnings
  useEffect(() => {
    if (engine.startupWarnings?.length) {
      setHistory(h => [...h, ...engine.startupWarnings!.map((w, i) => ({ id: `warn-${i}`, type: "callout" as const, level: "warning" as const, text: w }))]);
    }
  }, []);

  let nextId = history.length + 1;
  const id = () => String(nextId++);
  const abortRef = React.useRef<AbortController | null>(null);

  const showAutocomplete = !busy && !panel && ((input === "" && acOpen) || (input.startsWith("/") && !input.includes(" ")));
  const acCommands = showAutocomplete
    ? engine.container.registry.listSlashCommands().filter(n => input === "" || n.startsWith(input.slice(1).toLowerCase()))
    : [];

  useInput((ch, key) => {
    // Handle tool confirmation dialog
    if (confirmRequest) {
      if ((ch === "c" && key.ctrl) || key.escape) {
        // Cancel entire turn
        respondConfirmation(confirmOptions.length - 1);
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null);
        setHistory(h => [...h, { id: String(h.length+1), type: "system" as const, text: "Turn cancelled." }]);
        setPendingTools(null);
        return;
      }
      if (key.upArrow) { setConfirmIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setConfirmIdx(i => Math.min(confirmOptions.length - 1, i + 1)); return; }
      if (key.return) { respondConfirmation(confirmIdx); return; }
      return; // Block all other input while confirming
    }
    if (key.escape) {
      if (busy) {
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null);
        setHistory(h => [...h, ...(pendingTools ? [{ id: String(h.length+1), type: "tools" as const, tools: pendingTools.map(t => t.status === "executing" ? { ...t, status: "error" as const } : t) }] : []), { id: String(h.length+2), type: "system" as const, text: "Generation cancelled." }]);
        setPendingTools(null);
        setPendingTurn([]);
      }
    }
    if (key.tab && !busy && !panel) {
      if (showAutocomplete && acCommands.length && !key.shift) {
        setInput("/" + acCommands[acIdx]);
        setAcIdx(0);
        setInputKey(k => k + 1);
        return;
      }
      // File path completion: tab on non-slash input
      if (!key.shift && input && !input.startsWith("/")) {
        const matches = fileAcRef.current.complete(input);
        if (matches.length === 1) {
          const words = input.split(/\s+/);
          words[words.length - 1] = matches[0];
          setInput(words.join(" "));
          setInputKey(k => k + 1);
          return;
        }
        if (matches.length > 1) {
          // Complete to longest common prefix
          let prefix = matches[0];
          for (let i = 1; i < matches.length; i++) {
            while (!matches[i].startsWith(prefix)) {
              prefix = prefix.slice(0, -1);
            }
          }
          const words = input.split(/\s+/);
          if (prefix.length > words[words.length - 1].length) {
            words[words.length - 1] = prefix;
            setInput(words.join(" "));
            setInputKey(k => k + 1);
          }
          return;
        }
      }
      if (key.shift) {
        const agent = engine.agents.cycle();
        activateAgent(agent.id);
      }
    }
    if (ch === "v" && key.ctrl && !busy && !panel) {
      if (clipboardHasImage()) {
        const saved = saveClipboardImage(engine.workspaceRoot);
        if (saved) setClipboardImage(saved);
      }
      return;
    }
    if (ch === "x" && key.ctrl && clipboardImage) {
      setClipboardImage(null);
      return;
    }
    if (ch === "c" && key.ctrl) {
      if (panel) { setPanel(null); return; }
      if (busy) {
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null);
        setHistory(h => [...h, ...(pendingTools ? [{ id: String(h.length+1), type: "tools" as const, tools: pendingTools.map(t => t.status === "executing" ? { ...t, status: "error" as const } : t) }] : []), { id: String(h.length+2), type: "system" as const, text: "Generation cancelled." }]);
        setPendingTools(null);
        setPendingTurn([]);
        return;
      }
      if (input) { setInput(""); setInputKey(k => k + 1); return; }
      // Empty input — exit confirmation
      if (exitPending) {
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        process.stdout.write("\x1B[?25h");
        engine.container.shutdown().finally(() => process.exit(0));
        return;
      }
      setExitPending(true);
      exitTimerRef.current = setTimeout(() => { setExitPending(false); }, 1000);
      return;
    }
    // Any other key clears exit pending
    if (exitPending && ch) { setExitPending(false); if (exitTimerRef.current) clearTimeout(exitTimerRef.current); }
    if (showAutocomplete && acCommands.length) {
      if (key.downArrow) { setAcIdx(i => Math.min(i + 1, acCommands.length - 1)); return; }
      if (key.upArrow) {
        if (acOpen && acIdx === 0) { setAcOpen(false); return; }
        setAcIdx(i => Math.max(i - 1, 0)); return;
      }
    }
    if (key.downArrow && !busy && !panel && input === "" && !acOpen) {
      setAcOpen(true); setAcIdx(0); return;
    }
    if (key.upArrow && !busy && !panel && showAutocomplete && acCommands.length) {
      if (acOpen && acIdx === 0) { setAcOpen(false); return; }
      setAcIdx(i => Math.max(i - 1, 0)); return;
    }
    if (key.return && acOpen && input === "" && acCommands.length) {
      const selected = acCommands[acIdx % acCommands.length];
      setAcOpen(false); setAcIdx(0);
      setInput(""); setInputKey(k => k + 1);
      handleSubmit("/" + selected);
      return;
    }
    if (key.escape && acOpen) { setAcOpen(false); return; }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    inputHistoryRef.current.push(text);
    setHistIdx(-1);

    // If autocomplete is showing and input is a partial command, execute the selected item
    if (text.startsWith("/") && !text.includes(" ")) {
      const partial = text.slice(1).toLowerCase();
      const matches = engine.container.registry.listSlashCommands().filter(n => n.startsWith(partial));
      if (matches.length > 0 && !engine.container.registry.getSlashCommand(partial)) {
        const selected = matches[acIdxRef.current % matches.length];
        setInput("");
        setAcIdx(0);
        const handler = engine.container.registry.getSlashCommand(selected);
        if (handler) {
          let captured = "";
          engine.setCmdOutput((t: string) => { captured += (captured ? "\n" : "") + t; });
          engine.setOpenPanel((p: string) => { if (p === "diff" || p === "history") { process.stdout.write("\x1b[2J\x1b[H"); setFullPanel(p); } else setPanel(p); });
          await handler.execute([]);
          engine.setCmdOutput(() => {});
          engine.setOpenPanel(() => {});
          if (selected === "clear") { process.stdout.write("\x1b[2J\x1b[H"); setHistory([]); setClearKey(k => k + 1); return; }
          if (captured) setHistory(h => [...h, { id: id(), type: "system", text: captured }]);
        }
        return;
      }
    }

    setInput("");
    const trimmed = text.trim();

    // Slash commands
    if (trimmed === "/quit") { engine.container.shutdown().then(() => { process.stdout.write("\x1B[?25h"); exit(); }); return; }
    if (trimmed.startsWith("/")) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
      const handler = engine.container.registry.getSlashCommand(cmd);
      if (handler) {
        let captured = "";
        engine.setCmdOutput((t: string) => { captured += (captured ? "\n" : "") + t; });
        engine.setOpenPanel((p: string) => { if (p === "diff" || p === "history") { process.stdout.write("\x1b[2J\x1b[H"); setFullPanel(p); } else setPanel(p); });
        await handler.execute(args);
        engine.setCmdOutput(() => {});
        engine.setOpenPanel(() => {});
        if (cmd === "clear") { process.stdout.write("\x1b[2J\x1b[H"); setHistory([]); setClearKey(k => k + 1); return; }
        if (captured) setHistory(h => [...h, { id: id(), type: "system", text: captured }]);
      } else {
        setHistory(h => [...h, { id: id(), type: "system", text: `Unknown command: /${cmd}` }]);
      }
      return;
    }

    // Chat turn
    const messageText = clipboardImage ? `${trimmed} ${clipboardImage}` : trimmed;
    setHistory(h => [...h, { id: id(), type: "user", text: clipboardImage ? `${trimmed} 📎` : trimmed }]);
    setClipboardImage(null);
    setBusy(true);
    setThinking("Thinking...");

    const abortController = new AbortController();
    abortRef.current = abortController;

    const startTime = Date.now();
    let tokenCount = 0;
    let fullText = "";
    let lastRender = 0;
    const tools: ToolCall[] = [];
    const turnItems: HistoryItem[] = [];
    let resolvedModel = engine.agents.active.modelTier === "auto" ? "auto" : (engine.container.config.models[engine.container.config.tiers[engine.agents.active.modelTier as keyof typeof engine.container.config.tiers]]?.model ?? engine.agents.active.modelTier);

    const result = await executeTurn(engine, messageText, {
      signal: abortController.signal,
      onChunk: (chunk: StreamChunk) => {
        if (chunk.type === "content") {
          setThinking(null);
          fullText += chunk.text;
          tokenCount++;
          const now = Date.now();
          if (fullText.trim() && now - lastRender >= 50) {
            lastRender = now;
            setStreaming({ model: resolvedModel, text: fullText, elapsed: +((now - startTime) / 1000).toFixed(1), tokens: tokenCount });
          }
        }
        if (chunk.type === "tool_call") {
          if (fullText.trim()) {
            turnItems.push({ id: id(), type: "assistant", model: resolvedModel, text: fullText } as any);
            fullText = "";
          }
          setStreaming(null);
          setThinking(null);
          if (chunk.status === "executing") {
            const toolId = id();
            tools.push({ name: chunk.name, args: chunk.args, status: "executing", _histId: toolId } as any);
            turnItems.push({ id: toolId, type: "tools", tools: [{ name: chunk.name, args: chunk.args, status: "executing" }] } as any);
          } else {
            const tool = tools.find(t => t.name === chunk.name && t.status === "executing");
            if (tool) {
              tool.status = chunk.status === "error" ? "error" : "success";
              tool.result = (chunk as any).result;
              tool.elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
              const histId = (tool as any)._histId;
              const idx = turnItems.findIndex(item => item.id === histId);
              if (idx >= 0) turnItems[idx] = { ...turnItems[idx], tools: [{ ...tool }] } as any;
            }
          }
          setPendingTurn([...turnItems]);
        }
        if (chunk.type === "error") {
          setThinking(null); setStreaming(null);
          turnItems.push({ id: id(), type: "system", text: `⚠️ ${chunk.message}` } as any);
          setPendingTurn([...turnItems]);
        }
        if (chunk.type === "status") {
          if (chunk.message.startsWith("model:")) {
            const name = chunk.message.slice(6);
            const displayModel = engine.agents.active.modelTier === "auto" ? `auto[${name}]` : name;
            resolvedModel = displayModel;
            setActiveModel(displayModel);
          }
          setStreaming(null);
          setThinking(chunk.message.startsWith("model:") ? null : chunk.message);
        }
      },
    });

    if (result) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokPerSec = tokenCount > 0 ? (tokenCount / +elapsed).toFixed(1) : "0";
      const cacheInfo = result.response.usage.cacheReadTokens ? ` » ${result.response.usage.cacheReadTokens}` : "";
      const finalItem = {
        id: id(), type: "assistant", model: resolvedModel, text: result.response.text,
        stats: `↑ ${result.response.usage.promptTokens}${cacheInfo} · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${elapsed}s`,
      } as any;
      setHistory(h => [...h, ...turnItems, finalItem]);
    } else if (turnItems.length) {
      setHistory(h => [...h, ...turnItems]);
    }

    setStreaming(null); setThinking(null); setBusy(false);
    setPendingTools(null); setPendingTurn([]);
  }, [busy, engine, clipboardImage]);

  // Subscribe to scheduled task triggers (queue if busy)
  const scheduledQueueRef = React.useRef<string[]>([]);
  useEffect(() => {
    return engine.container.bus.subscribe("USER_INPUT", (event: any) => {
      if (event.payload.text) {
        if (busy) { scheduledQueueRef.current.push(event.payload.text); }
        else { handleSubmit(event.payload.text); }
      }
    });
  }, [busy]);
  useEffect(() => {
    if (!busy && scheduledQueueRef.current.length > 0) {
      const next = scheduledQueueRef.current.shift()!;
      handleSubmit(next);
    }
  }, [busy]);

  const footerModel = activeModel || (engine.agents.active.modelTier === "auto" ? "auto" : (engine.container.config.models[engine.container.config.tiers[engine.agents.active.modelTier as keyof typeof engine.container.config.tiers]]?.model ?? engine.agents.active.modelTier));

  return (
    <Box flexDirection="column" height={fullPanel ? process.stdout.rows || 24 : undefined}>
      {fullPanel === "diff" && <DiffPanel workspaceRoot={engine.workspaceRoot} onClose={() => { setFullPanel(null); process.stdout.write("\x1b[2J\x1b[H"); }} />}
      {fullPanel === "history" && <HistoryPanel logger={engine.logger} onClose={() => { setFullPanel(null); process.stdout.write("\x1b[2J\x1b[H"); }} />}
      {!fullPanel && <>
      <Static key={clearKey} items={[{ id: "welcome", type: "welcome" } as any, ...history]}>
        {(item: any, idx: number) => {
          if (item.type === "welcome") return <Welcome key="welcome" model={footerModel} workspace={engine.shortPath} branch={engine.branch} />;
          const isFirst = idx === 1; // idx 0 is welcome
          const allItems = [{ type: "welcome" }, ...history];
          const prev = allItems[idx - 1]?.type ?? "welcome";
          switch (item.type) {
            case "user": return <UserMessage key={item.id} text={item.text} isFirst={isFirst} />;
            case "tools": return <ToolGroup key={item.id} tools={item.tools} />;
            case "diff": return <DiffDisplay key={item.id} summary={item.summary} lines={item.lines} />;
            case "assistant": return <AssistantMessage key={item.id} model={item.model} text={item.text} stats={item.stats} prevType={prev} />;
            case "system": return <Text key={item.id} dimColor italic>  {item.text}</Text>;
            case "callout": {
              const color = item.level === "error" ? "red" : item.level === "warning" ? "yellow" : "#61afef";
              const icon = item.level === "error" ? "✗" : item.level === "warning" ? "⚠" : "ℹ";
              return <Box key={item.id} marginLeft={1}><Text color={color}>{icon} {item.text}</Text></Box>;
            }
            default: return null;
          }
        }}
      </Static>

      {pendingTurn.length > 0 && pendingTurn.map((item: any) => {
        switch (item.type) {
          case "tools": return <ToolGroup key={item.id} tools={item.tools} />;
          case "assistant": return <AssistantMessage key={item.id} model={item.model} text={item.text} stats={item.stats} prevType="tools" />;
          case "system": return <Text key={item.id} dimColor italic>  {item.text}</Text>;
          default: return null;
        }
      })}
      {pendingTools && <ToolGroup tools={pendingTools} />}
      {confirmRequest && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>⚠ Tool requires approval</Text>
          <Text>  <Text bold>{confirmRequest.tool.startsWith("mcp_") ? confirmRequest.tool.replace(/^mcp_([^_]+)_(.+)$/, "MCP:$1:$2") : confirmRequest.tool}</Text>({Object.entries(confirmRequest.args).map(([k,v]) => `${k}: ${typeof v === "string" && v.length > 60 ? v.slice(0, 57) + "..." : JSON.stringify(v)}`).join(", ")})</Text>
          {confirmRequest.diff && confirmRequest.diff.length > 0 && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {confirmRequest.diff.slice(0, 8).map((line, i) => (
                <Text key={i} color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined} dimColor={line.startsWith("@@")}>{line}</Text>
              ))}
              {confirmRequest.diff.length > 8 && <Text dimColor>  ...{confirmRequest.diff.length - 8} more lines</Text>}
            </Box>
          )}
          <Box flexDirection="column" marginTop={1} paddingLeft={1}>
            {confirmOptions.map((opt, i) => (
              <Text key={i} color={confirmIdx === i ? "green" : undefined}>{confirmIdx === i ? "❯ " : "  "}<Text bold={confirmIdx === i}>{opt.label}</Text></Text>
            ))}
          </Box>
          <Text dimColor>  ↑↓ navigate · enter select · esc deny</Text>
        </Box>
      )}
      {thinking && <ThinkingIndicator label={thinking} />}
      {!thinking && busy && !streaming && <ThinkingIndicator label="Thinking..." />}
      {streaming && <StreamingResponse {...streaming} />}

      <Box flexDirection="column" marginTop={1}>
        {clipboardImage && (
          <Text dimColor>📎 1 image attached (clipboard, {Math.round(statSync(clipboardImage).size / 1024)} KB, image/png)  <Text color="#61afef">ctrl+x</Text> remove</Text>
        )}
        <Footer mode={engine.agents.active.name} model={footerModel} contextPct={engine.budget.getContextPct(engine.context.getTokenCount())} workspace={engine.shortPath} branch={engine.branch} tasks={engine.scheduler.runningCount} />
        <Text> </Text>
        <Box>
          <Text color="#6a7ec8" bold>❯ </Text>
          {busy
            ? <Text dimColor italic>working... (esc to cancel)</Text>
            : panel
              ? <Text dimColor italic>esc to close</Text>
              : <RawInput value={input} onChange={(v) => { setInput(v); setAcIdx(0); setAcOpen(false); setHistIdx(-1); }} onSubmit={handleSubmit} placeholder={exitPending ? "press ctrl+c again to exit" : "ask a question or describe a task"} isActive={!busy && !panel} onHistoryUp={() => {
                const hist = inputHistoryRef.current;
                if (!hist.length) return;
                if (histIdx === -1) { draftRef.current = input; setHistIdx(hist.length - 1); setInput(hist[hist.length - 1]); }
                else if (histIdx > 0) { setHistIdx(histIdx - 1); setInput(hist[histIdx - 1]); }
              }} onHistoryDown={() => {
                const hist = inputHistoryRef.current;
                if (histIdx < 0) return;
                if (histIdx < hist.length - 1) { setHistIdx(histIdx + 1); setInput(hist[histIdx + 1]); }
                else { setHistIdx(-1); setInput(draftRef.current); }
              }} />
          }
        </Box>
      </Box>

      {showAutocomplete && acCommands.length > 0 && (
        <SlashAutocomplete input={input} registry={engine.container.registry} selected={acIdx} />
      )}

      {panel === "stats" && <StatsPanel stats={engine.stats} budget={engine.budget} onClose={() => setPanel(null)} />}
      {panel === "help" && <HelpPanel registry={engine.container.registry} sessionId={engine.stats.current.sessionId} workspace={engine.shortPath} onClose={() => setPanel(null)} />}
      {panel === "tools" && <ToolsPanel agents={engine.agents} mcp={engine.mcp} onClose={() => setPanel(null)} />}
      {panel === "model" && <ModelPanel config={engine.container.config} agents={engine.agents} onClose={() => { setPanel(null); forceRender(n => n + 1); }} />}
      {panel === "plan" && <PlanPanel planManager={engine.planManager} config={engine.container.config} onClose={() => setPanel(null)} />}
      {panel === "memory" && <MemoryPanel memory={engine.memory} context={engine.context} onClose={() => setPanel(null)} />}
      {panel === "skills" && <SkillsPanel skills={engine.skills} config={engine.container.config} workspaceRoot={engine.workspaceRoot} agents={engine.agents} onClose={() => setPanel(null)} />}
      {panel === "mcp" && <MCPPanel mcp={engine.mcp} config={engine.container.config} onClose={() => setPanel(null)} />}
      {panel === "templates" && <TemplatesPanel templates={engine.templates} config={engine.container.config} workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel === "prompts" && <PromptsPanel prompts={engine.prompts} config={engine.container.config} workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel === "context" && <ContextPanel budget={engine.budget} context={engine.context} stats={engine.stats} modelName={footerModel} skills={engine.skills} onClose={() => setPanel(null)} />}
      {panel === "tasks" && <TasksPanel scheduler={engine.scheduler} onClose={() => setPanel(null)} />}
      {panel === "resume" && <ResumePanel workspaceRoot={engine.workspaceRoot} currentSessionId={engine.sessionId} onResume={(id, msgs) => {
        engine.brain.loadSession(id, engine.context);
        // Rebuild UI history from persisted messages
        let n = 0;
        const restored = msgs.map((m: any) => {
          n++;
          if (m.role === "user") return { id: String(n), type: "user" as const, text: m.content };
          if (m.role === "assistant") return { id: String(n), type: "assistant" as const, model: "", text: m.content };
          return null;
        }).filter(Boolean) as any[];
        setHistory(restored);
        setPanel(null);
      }} onClose={() => setPanel(null)} />}
      {panel === "rewind" && <RewindPanel turns={engine.stats.current.turns} onRewind={(t) => { engine.context.setMessages(engine.context.getMessages().slice(0, t * 2)); }} onClose={() => setPanel(null)} />}
      {panel === "agents" && <AgentsPanel agents={engine.agents} config={engine.container.config} workspaceRoot={engine.workspaceRoot} bus={engine.container.bus} onClose={() => setPanel(null)} />}
      {panel === "plugins" && <PluginsPanel plugins={engine.pluginRegistry} registry={engine.container.registry} agents={engine.agents} workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel === "policy" && <PolicyPanel engine={engine.policyEngine} onClose={() => setPanel(null)} />}
      {panel === "history" && <HistoryPanel logger={engine.logger} onClose={() => setPanel(null)} />}
      {panel && !["stats","help","tools","model","plan","memory","skills","mcp","templates","prompts","context","tasks","resume","rewind","agents","plugins","policy","history"].includes(panel) && <GenericPanel name={panel} onClose={() => setPanel(null)} />}
      </>}
    </Box>
  );
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// --version flag
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log("voidrift 0.1.0");
  process.exit(0);
}

// If --serve flag, run headless JSON-RPC mode (for VS Code / external frontends)
if (process.argv.includes("--serve")) {
  const { runServe } = await import("./serve.js");
  await runServe();
  // Never reaches here — serve handles its own lifecycle
}

import { createEngine } from "./bootstrap/cli.js";
const engine: EngineContext = await createEngine();

// --resume flag: load previous session
let restoredHistory: Array<{ role: string; content: string }> | null = null;
const resumeIdx = process.argv.indexOf("--resume");
if (resumeIdx !== -1) {
  const sessionArg = process.argv[resumeIdx + 1];
  const sessions = engine.brain.listSessions();
  if (sessionArg && !sessionArg.startsWith("--")) {
    engine.brain.loadSession(sessionArg, engine.context) && (restoredHistory = engine.context.getMessages());
  } else if (sessions.length > 0) {
    engine.brain.loadSession(sessions[0].id, engine.context) && (restoredHistory = engine.context.getMessages());
  }
}

// ─── Signal Handlers (SYSTEMS-ENG: graceful shutdown) ────────────────────────

async function gracefulShutdown(signal: string) {
  process.stderr.write(`\n[VoidRift] Received ${signal}, shutting down...\n`);
  engine.scheduler.killAll();
  await engine.container.shutdown();
  process.stdout.write("\x1B[?25h");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Render ──────────────────────────────────────────────────────────────────

process.stdout.write("\x1b[2J\x1b[H\x1b[?25l"); // Clear screen, move to top, hide cursor
process.on("exit", () => process.stdout.write("\x1b[?25h"));

render(<App engine={engine} />, { patchConsole: false, exitOnCtrlC: false });
process.stdout.write("\x1B[?25l"); // hide terminal cursor
