#!/usr/bin/env bun
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
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
} from "./index.js";
import {
  StatsPanel, HelpPanel, ToolsPanel, ModelPanel, MemoryPanel, GenericPanel,
  SkillsPanel, MCPPanel, TemplatesPanel, PromptsPanel, ContextPanel, TasksPanel,
  ResumePanel, RewindPanel, AgentsPanel, PlanPanel, DiffPanel,
  PluginsPanel,
} from "./panels.js";
import { PluginRegistry, discoverPlugins } from "./plugins/registry.js";
import type { EngineContext } from "./engine.js";
import { executeTurn } from "./turn.js";
import { validateEditor } from "./utils/editor.js";
import { validateAssets } from "./bootstrap/validate.js";
import { ResourceWatcher } from "./watcher/resources.js";

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

type HistoryItem = UserMsg | AssistantMsg | ToolMsg | SystemMsg | DiffMsg;

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
    <Box marginTop={isFirst ? 0 : 1} marginBottom={1}>
      <Text color="#6a7ec8">┃ </Text>
      <Text bold>{text}</Text>
    </Box>
  );
}

/** Get a human-readable description and color for a tool call */
function describeToolCall(name: string, argsStr: string): { label: string; description: string; color: string } {
  let args: Record<string, any> = {};
  try { args = JSON.parse(argsStr); } catch {}

  const friendly: Record<string, string> = {
    read_file: "Read", glob_files: "Glob", write_file: "Write", edit_file: "Edit",
    execute_command: "Run", web_search: "Search", web_fetch: "Fetch",
    save_memory: "Remember", schedule: "Schedule", plan: "Plan",
    run_task_agent: "Task Agent",
  };
  const label = friendly[name] || name;

  switch (name) {
    case "read_file": {
      const path = args.path || "file";
      const range = args.offset !== undefined ? `:${args.offset + 1}-${(args.offset || 0) + (args.limit || "end")}` : "";
      return { label, description: `${path}${range}`, color: "green" };
    }
    case "glob_files":
      return { label, description: args.pattern || "pattern", color: "green" };
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
    default:
      return { label, description: argsStr.slice(0, 60), color: "gray" };
  }
}

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  return (
    <Box flexDirection="column" marginLeft={1}>
      {tools.map((tool, i) => {
        const { label, description, color } = describeToolCall(tool.name, tool.args);
        return (
          <Box key={i} flexDirection="row">
            <ToolStatusIcon status={tool.status} color={color} />
            <Text bold>{label}</Text>
            <Text color={color}>  {description}</Text>
            {tool.elapsed && tool.status !== "executing" && <Text dimColor>  {tool.elapsed}</Text>}
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
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column">
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

function Footer({ mode, model, contextPct, workspace, branch }: { mode: string; model: string; contextPct: number; workspace: string; branch: string | null }) {
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
  const [exitPending, setExitPending] = useState(false);
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useState(0);

  // Tool confirmation state
  const [confirmRequest, setConfirmRequest] = useState<{ tool: string; args: Record<string, unknown>; requestId: string; diff?: string[]; inferredPattern?: string } | null>(null);

  // Subscribe to tool confirmation requests from the permission gate
  useEffect(() => {
    return engine.container.bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event: any) => {
      setConfirmRequest(event.payload);
    });
  }, []);

  // Handle confirmation response
  const respondConfirmation = useCallback((approved: boolean, persist?: boolean) => {
    if (confirmRequest) {
      engine.container.bus.publish("TOOL_CONFIRMATION_RESPONSE", { requestId: confirmRequest.requestId, approved, persist } as any);
      setConfirmRequest(null);
    }
  }, [confirmRequest]);

  // Helper: activate an agent — sets persona, mode, loads resources
  const activateAgent = (agentId: string) => {
    const agent = engine.agents.setActive(agentId);
    const basePrompt = engine.prompts.resolve("chat")?.body || "";
    const persona = agent.prompt ? `${agent.prompt}\n\n${basePrompt}` : basePrompt;
    engine.context.setPersona(persona);
    engine.context.setTools(agent.tools);
    // Load resources into focused files
    if (agent.resources) {
      for (const uri of agent.resources) {
        if (uri.startsWith("file://")) {
          const relPath = uri.slice(7).replace(/^\.\//, "");
          const absPath = join(engine.workspaceRoot, relPath);
          if (existsSync(absPath)) {
            const content = readFileSync(absPath, "utf-8");
            const lines = content.split("\n").length;
            if (lines <= (engine.container.config.summarizeThreshold ?? 500)) {
              engine.context.focusFile(relPath, content, lines);
            } else {
              // Large files: just register awareness with a brief note
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
      setHistory(h => [...h, ...engine.startupWarnings!.map((w, i) => ({ id: `warn-${i}`, type: "system" as const, text: `⚠️ ${w}` }))]);
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
      if (ch === "y" || ch === "Y" || key.return) { respondConfirmation(true, false); return; }
      if (ch === "a" || ch === "A") { respondConfirmation(true, true); return; }
      if (ch === "n" || ch === "N" || key.escape) { respondConfirmation(false); return; }
      return; // Block all other input while confirming
    }
    if (key.escape) {
      if (busy) {
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null);
        setHistory(h => [...h, ...(pendingTools ? [{ id: String(h.length+1), type: "tools" as const, tools: pendingTools }] : []), { id: String(h.length+2), type: "system" as const, text: "Generation cancelled." }]);
        setPendingTools(null);
      }
    }
    if (key.tab && !busy && !panel) {
      if (showAutocomplete && acCommands.length && !key.shift) {
        setInput("/" + acCommands[acIdx]);
        setAcIdx(0);
        setInputKey(k => k + 1);
        return;
      }
      if (key.shift) {
        const agent = engine.agents.cycle();
        activateAgent(agent.id);
      }
    }
    if (ch === "c" && key.ctrl) {
      if (panel) { setPanel(null); return; }
      if (busy) {
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null);
        setHistory(h => [...h, ...(pendingTools ? [{ id: String(h.length+1), type: "tools" as const, tools: pendingTools }] : []), { id: String(h.length+2), type: "system" as const, text: "Generation cancelled." }]);
        setPendingTools(null);
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
    if (key.upArrow && !busy && !panel && !showAutocomplete) {
      const hist = inputHistoryRef.current;
      if (hist.length) {
        const next = histIdx === -1 ? hist.length - 1 : Math.max(histIdx - 1, 0);
        setHistIdx(next);
        setInput(hist[next]);
        setInputKey(k => k + 1);
      }
      return;
    }
    if (key.downArrow && !busy && !panel && !showAutocomplete && histIdx >= 0) {
      const hist = inputHistoryRef.current;
      const next = histIdx + 1;
      if (next >= hist.length) {
        setHistIdx(-1); setInput(""); setInputKey(k => k + 1);
      } else {
        setHistIdx(next); setInput(hist[next]); setInputKey(k => k + 1);
      }
      return;
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
          engine.setOpenPanel((p: string) => { if (p === "diff" || p === "plan") { process.stdout.write("\x1b[2J\x1b[H"); setFullPanel(p); } else setPanel(p); });
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
        engine.setOpenPanel((p: string) => { if (p === "diff" || p === "plan") { process.stdout.write("\x1b[2J\x1b[H"); setFullPanel(p); } else setPanel(p); });
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
    setHistory(h => [...h, { id: id(), type: "user", text: trimmed }]);
    setBusy(true);
    setThinking("Thinking...");

    const abortController = new AbortController();
    abortRef.current = abortController;

    const startTime = Date.now();
    let tokenCount = 0;
    let fullText = "";
    const tools: ToolCall[] = [];
    const turnItems: HistoryItem[] = [];
    let resolvedModel = engine.agents.active.modelTier === "auto" ? "auto" : (engine.container.config.models[engine.container.config.tiers[engine.agents.active.modelTier as keyof typeof engine.container.config.tiers]]?.model ?? engine.agents.active.modelTier);

    const result = await executeTurn(engine, trimmed, {
      signal: abortController.signal,
      onChunk: (chunk: StreamChunk) => {
        if (chunk.type === "content") {
          setThinking(null);
          fullText += chunk.text;
          tokenCount++;
          if (fullText.trim()) {
            setStreaming({ model: resolvedModel, text: fullText, elapsed: +((Date.now() - startTime) / 1000).toFixed(1), tokens: tokenCount });
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
            resolvedModel = engine.agents.active.modelTier === "auto" ? `auto[${name}]` : name;
            setActiveModel(name);
          }
          setStreaming(null);
          setThinking(chunk.message.startsWith("model:") ? null : chunk.message);
        }
      },
    });

    if (result) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokPerSec = tokenCount > 0 ? (tokenCount / +elapsed).toFixed(1) : "0";
      const finalItem = {
        id: id(), type: "assistant", model: resolvedModel, text: result.response.text,
        stats: `↑ ${result.response.usage.promptTokens} · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${elapsed}s`,
      } as any;
      setHistory(h => [...h, ...turnItems, finalItem]);
    } else if (turnItems.length) {
      setHistory(h => [...h, ...turnItems]);
    }

    setStreaming(null); setThinking(null); setBusy(false);
    setPendingTools(null); setPendingTurn([]);
  }, [busy, engine]);

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
      {fullPanel === "plan" && <PlanPanel planManager={engine.planManager} config={engine.container.config} onClose={() => { setFullPanel(null); process.stdout.write("\x1b[2J\x1b[H"); }} />}
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
          <Text>  <Text bold>{confirmRequest.tool}</Text>({Object.entries(confirmRequest.args).map(([k,v]) => `${k}: ${typeof v === "string" && v.length > 60 ? v.slice(0, 57) + "..." : JSON.stringify(v)}`).join(", ")})</Text>
          {confirmRequest.diff && confirmRequest.diff.length > 0 && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {confirmRequest.diff.slice(0, 8).map((line, i) => (
                <Text key={i} color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined} dimColor={line.startsWith("@@")}>{line}</Text>
              ))}
              {confirmRequest.diff.length > 8 && <Text dimColor>  ...{confirmRequest.diff.length - 8} more lines</Text>}
            </Box>
          )}
          <Text dimColor>  y/enter = allow once · a = always allow{confirmRequest.inferredPattern ? ` (${confirmRequest.inferredPattern})` : ""} · n/esc = deny</Text>
        </Box>
      )}
      {thinking && <ThinkingIndicator label={thinking} />}
      {!thinking && busy && !streaming && <ThinkingIndicator label="Thinking..." />}
      {streaming && <StreamingResponse {...streaming} />}

      <Box flexDirection="column" marginTop={1}>
        <Footer mode={engine.agents.active.name} model={footerModel} contextPct={engine.budget.state.percentage} workspace={engine.shortPath} branch={engine.branch} />
        <Text> </Text>
        <Box>
          <Text color="#6a7ec8" bold>❯ </Text>
          {busy
            ? <Text dimColor italic>working... (esc to cancel)</Text>
            : panel
              ? <Text dimColor italic>esc to close</Text>
              : <TextInput key={inputKey} value={input} onChange={(v) => { setInput(v); setAcIdx(0); setAcOpen(false); setHistIdx(-1); }} onSubmit={handleSubmit} placeholder={exitPending ? "press ctrl+c again to exit" : "ask a question or describe a task"} />
          }
        </Box>
      </Box>

      {showAutocomplete && acCommands.length > 0 && (
        <SlashAutocomplete input={input} registry={engine.container.registry} selected={acIdx} />
      )}

      {panel === "stats" && <StatsPanel stats={engine.stats} budget={engine.budget} onClose={() => setPanel(null)} />}
      {panel === "help" && <HelpPanel registry={engine.container.registry} sessionId={engine.stats.current.sessionId} workspace={engine.shortPath} onClose={() => setPanel(null)} />}
      {panel === "tools" && <ToolsPanel agents={engine.agents} onClose={() => setPanel(null)} />}
      {panel === "model" && <ModelPanel config={engine.container.config} agents={engine.agents} onClose={() => setPanel(null)} />}
      {panel === "memory" && <MemoryPanel memory={engine.memory} context={engine.context} onClose={() => setPanel(null)} />}
      {panel === "skills" && <SkillsPanel skills={engine.skills} config={engine.container.config} workspaceRoot={engine.workspaceRoot} agents={engine.agents} onClose={() => setPanel(null)} />}
      {panel === "mcp" && <MCPPanel mcp={engine.mcp} onClose={() => setPanel(null)} />}
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
      {panel && !["stats","help","tools","model","plan","memory","skills","mcp","templates","prompts","context","tasks","resume","rewind","agents","plugins"].includes(panel) && <GenericPanel name={panel} onClose={() => setPanel(null)} />}
      </>}
    </Box>
  );
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function validateStartup(config: any): string[] {
  const warnings: string[] = [];
  if (config.editor) {
    const err = validateEditor(config.editor);
    if (err) warnings.push(err);
  }
  return warnings;
}

const engine: EngineContext = await (async () => {
  const workspaceRoot = process.cwd();
  const sessionId = randomUUID().slice(0, 8);
  const branch = getGitBranch(workspaceRoot);
  const shortPath = shortenPath(workspaceRoot);

  let container;
  try {
    container = await bootstrap({ workspaceRoot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  \x1b[31m✗ VoidRift failed to start\x1b[0m\n\n  ${msg.replace(/\n/g, "\n  ")}\n\n  Fix your config at:\n    Global: ~/.config/voidrift/config.json\n    Local:  ${workspaceRoot}/.voidrift/config.json\n\n`);
    process.exit(1);
  }
  setWorkspaceRoot(workspaceRoot);
  const codeMap = generateCodeMap(workspaceRoot);
  const agents = new AgentRegistry();
  const templates = new TemplateService(workspaceRoot);
  const prompts = new PromptRegistry(workspaceRoot);
  const mcp = new MCPEngine(workspaceRoot, container.bus);
  const worktree = new WorktreeEngine(workspaceRoot, container.bus);
  const checkpointer = new GitCheckpointer(workspaceRoot, container.bus);
  checkpointer.attach();

  // Config-driven plugin loading
  const startupWarnings: string[] = [];
  templates.setActivePlugins(container.config.plugins);
  const pluginRegistry = new PluginRegistry();

  // Discover all plugins from node_modules (by voidrift marker in package.json)
  const discovered = discoverPlugins(workspaceRoot);
  // Effective plugin list = union of global + workspace config arrays
  const activePluginIds = new Set(container.config.plugins);

  for (const dp of discovered) {
    const isActive = activePluginIds.has(dp.id);

    if (!isActive) {
      pluginRegistry.register({ id: dp.id, name: dp.id, version: dp.version, description: dp.description, author: dp.author, license: dp.license, homepage: dp.homepage, active: false, commands: [], agents: [], modes: [], templates: [], prompts: [], skills: [] });
      continue;
    }

    try {
      const pluginInterface = new CoreAPI(
        container.registry,
        container.bus,
        worktree,
        workspaceRoot,
        templates,
        agents,
        prompts,
        undefined,
        dp.id,
      );
      const mod = await import(dp.id);
      if (typeof mod.register === "function") {
        mod.register(pluginInterface);
      }
      const cmds = container.registry.listSlashCommandHooks().filter(c => c.source === dp.id);
      pluginRegistry.register({
        id: dp.id,
        name: mod.name || dp.id,
        version: dp.version,
        description: dp.description,
        author: dp.author,
        license: dp.license,
        homepage: dp.homepage,
        active: true,
        commands: cmds.map(c => c.name),
        agents: agents.listInteractive().filter(a => a.source === dp.id).map(a => a.id),
        modes: [],
        templates: [],
        prompts: [],
        skills: [],
      });
    } catch (err: any) {
      startupWarnings.push(`Plugin "${dp.id}" failed to load: ${err.message}`);
    }
  }

  agents.discover(workspaceRoot);
  const activeAgent = agents.active;
  const basePrompt = prompts.resolve("chat")?.body || "";
  const startupPersona = activeAgent.prompt ? `${activeAgent.prompt}\n\n${basePrompt}` : basePrompt;
  const context = new ContextManager(startupPersona, codeMap);
  context.setTools(activeAgent.tools);
  const budget = new TokenBudgetWatcher(container.config.models[container.config.tiers.utility]?.contextLimit ?? 128000);
  const brain = new SessionBrain(workspaceRoot, sessionId, container.bus);
  const memory = new MemoryRegistry();
  const planManager = new PlanManager(workspaceRoot);
  const skills = new SkillManager();
  const logger = new AuditLogger({ workspaceRoot, sessionId });
  const guard = new ExceptionGuard(container.bus, context);
  const stats = new StatsTracker(sessionId);
  const scheduler = new TaskScheduler(container.bus, (instruction) => {
    container.bus.publish("USER_INPUT", { text: `[Scheduled] ${instruction}` });
  });
  setScheduler(scheduler);
  setPlanManager(planManager);

  // Inject persisted plan into orbit
  const compiledPlan = planManager.compile();
  if (compiledPlan) context.setPlan(compiledPlan);

  skills.index([join(workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "resources", "skills")]);
  memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
  logger.attach(container.bus);
  brain.attach(() => context.context, () => agents.active.id);
  container.bus.publish("SESSION_START", { workspaceRoot, globalConfig: container.config as any });

  // Watcher → re-index codemap and memory on file changes (debounced 2s)
  let reindexTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReindex = (path: string) => {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => {
      context.setCodeMap(generateCodeMap(workspaceRoot));
      if (path.includes(".voidrift/memory") || path.includes(".voidrift\\memory")) {
        memory.index([join(workspaceRoot, ".voidrift", "memory"), join(homedir(), ".config", "voidrift", "memory")]);
      }
    }, 2000);
  };
  container.bus.subscribe("FILE_MODIFIED", (e) => scheduleReindex(e.payload.path));
  container.bus.subscribe("FILE_CREATED", (e) => scheduleReindex(e.payload.path));
  container.bus.subscribe("FILE_DELETED", (e) => scheduleReindex(e.payload.path));

  // Resource watcher: tracks voidrift config directories (local + global)
  const resourceWatcher = new ResourceWatcher(workspaceRoot, join(homedir(), ".config", "voidrift"), container.bus);
  resourceWatcher.start().catch(() => {});
  container.bus.subscribe("RESOURCE_CHANGED", (e) => {
    const { type } = e.payload;
    if (type === "skill") skills.index([join(workspaceRoot, ".voidrift", "skills"), join(homedir(), ".config", "voidrift", "skills")]);
    if (type === "agent") agents.discover(workspaceRoot);
    if (type === "template") templates.discover();
    // prompts resolve from disk on-demand, config requires restart
  });

  let cmdOutputFn: (text: string) => void = () => {};
  let openPanelFn: (panel: string) => void = () => {};

  registerCommands(container.registry, {
    config: container.config, context, budget, agents, brain, memory, stats,
    skills, templates, mcp, worktree, scheduler, checkpointer, bus: container.bus, workspaceRoot, sessionId,
    output: (text) => cmdOutputFn(text),
    openPanel: (panel) => openPanelFn(panel),
    switchModel: (name) => {
      if (!container.config.models[name]) return false;
      budget.setLimit(container.config.models[name].contextLimit);
      return true;
    },
    exit: () => { process.stdout.write("\x1B[?25h"); process.exit(0); },
  });

  return {
    container, context, budget, agents, prompts, guard, stats, memory, skills, mcp, templates, logger,
    worktree, scheduler, checkpointer, planManager, brain, sessionId, pluginRegistry,
    branch, shortPath, workspaceRoot,
    startupWarnings: [...startupWarnings, ...validateStartup(container.config), ...validateAssets(agents, skills).map(i => `[${i.type}] ${i.id}: ${i.message}`)],
    setCmdOutput: (fn: (text: string) => void) => { cmdOutputFn = fn; },
    setOpenPanel: (fn: (panel: string) => void) => { openPanelFn = fn; },
  };
})();

// ─── Signal Handlers (SYSTEMS-ENG: graceful shutdown) ────────────────────────

async function gracefulShutdown(signal: string) {
  process.stderr.write(`\n[VoidRift] Received ${signal}, shutting down...\n`);
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
