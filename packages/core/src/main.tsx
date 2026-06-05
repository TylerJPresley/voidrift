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
  SkillManager,
  AuditLogger,
  ExceptionGuard,
  StatsTracker,
  TemplateService,
  MCPEngine,
  WorktreeEngine,
  CoreRegistry,
  registerCommands,
  setWorkspaceRoot,
  generateCodeMap,
  getGitBranch,
  shortenPath,
  AgentRegistry,
  PromptRegistry,
  type StreamChunk,
  TaskScheduler,
  PluginInterface,
} from "./index.js";
import {
  StatsPanel, HelpPanel, ToolsPanel, ModelPanel, MemoryPanel, GenericPanel,
  SkillsPanel, MCPPanel, TemplatesPanel, PromptsPanel, ContextPanel, TasksPanel,
  ResumePanel, RewindPanel, IdeasPanel, ChangesPanel, AgentsPanel, PlanPanel,
} from "./panels.js";
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

function UserMessage({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Text color="#6a7ec8">┃ </Text>
      <Text bold>{text}</Text>
    </Box>
  );
}

/** Get a human-readable description and color for a tool call */
function describeToolCall(name: string, argsStr: string): { description: string; color: string } {
  let args: Record<string, any> = {};
  try { args = JSON.parse(argsStr); } catch {}

  switch (name) {
    case "read_file":
      return { description: args.path || "file", color: "green" };
    case "glob_files":
      return { description: args.pattern || "pattern", color: "green" };
    case "write_file":
      return { description: args.path || "file", color: "blue" };
    case "edit_file":
      return { description: args.path || "file", color: "blue" };
    case "execute_command":
      return { description: args.command?.slice(0, 60) || "command", color: "yellow" };
    default:
      return { description: argsStr.slice(0, 60), color: "gray" };
  }
}

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  return (
    <Box flexDirection="column" marginLeft={1} marginTop={1}>
      {tools.map((tool, i) => {
        const { description, color } = describeToolCall(tool.name, tool.args);
        return (
          <Box key={i} flexDirection="row">
            <ToolStatusIcon status={tool.status} color={color} />
            <Text bold>{tool.name}</Text>
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

function AssistantMessage({ model, text, stats }: { model: string; text: string; stats?: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor italic>  {model}</Text>
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
      <Text dimColor italic>  {model}</Text>
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
  const query = input.slice(1).toLowerCase();
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
      <Text dimColor>{'─'.repeat(process.stdout.columns || 80)}</Text>
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
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [acIdx, setAcIdx] = useState(0);
  const acIdxRef = React.useRef(0);
  acIdxRef.current = acIdx;
  const [inputKey, setInputKey] = useState(0);
  const [, forceRender] = useState(0);

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
            engine.context.focusFile(relPath, content, lines);
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

  const showAutocomplete = !busy && !panel && input.startsWith("/") && !input.includes(" ");
  const acCommands = showAutocomplete
    ? engine.container.registry.listSlashCommands().filter(n => n.startsWith(input.slice(1).toLowerCase()))
    : [];

  useInput((ch, key) => {
    if (key.escape) {
      if (busy) {
        abortRef.current?.abort();
        setBusy(false); setThinking(null); setStreaming(null); setPendingTools(null);
        setHistory(h => [...h, { id: id(), type: "system", text: "Generation cancelled." }]);
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
        setBusy(false); setThinking(null); setStreaming(null); setPendingTools(null);
        setHistory(h => [...h, { id: id(), type: "system", text: "Generation cancelled." }]);
      }
    }
    if (showAutocomplete && acCommands.length) {
      if (key.downArrow) { setAcIdx(i => (i + 1) % acCommands.length); return; }
      if (key.upArrow) { setAcIdx(i => (i - 1 + acCommands.length) % acCommands.length); return; }
    }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;

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
          engine.setOpenPanel((p: string) => setPanel(p));
          await handler.execute([]);
          engine.setCmdOutput(() => {});
          engine.setOpenPanel(() => {});
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
        engine.setOpenPanel((p: string) => setPanel(p));
        await handler.execute(args);
        engine.setCmdOutput(() => {});
        engine.setOpenPanel(() => {});
        if (cmd === "clear") { setHistory([]); return; }
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
    let resolvedModel = engine.agents.active.modelTier === "auto" ? "auto" : (engine.container.config.models[engine.container.config.tiers[engine.agents.active.modelTier as keyof typeof engine.container.config.tiers]]?.model ?? engine.agents.active.modelTier);

    const result = await executeTurn(engine, trimmed, {
      signal: abortController.signal,
      onChunk: (chunk: StreamChunk) => {
        if (chunk.type === "content") {
          setThinking(null);
          fullText += chunk.text;
          tokenCount++;
          const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
          setStreaming({ model: resolvedModel, text: fullText, elapsed, tokens: tokenCount });
        }
        if (chunk.type === "tool_call") {
          setThinking(null);
          tools.push({ name: chunk.name, args: chunk.args, status: "success", elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s` });
          setPendingTools([...tools]);
        }
        if (chunk.type === "error") {
          setThinking(null); setStreaming(null);
          setHistory(h => [...h, { id: id(), type: "system", text: `⚠️ ${chunk.message}` }]);
        }
        if (chunk.type === "status") {
          if (chunk.message.startsWith("model:")) {
            const name = chunk.message.slice(6);
            resolvedModel = engine.agents.active.modelTier === "auto" ? `auto[${name}]` : name;
          }
          setThinking(chunk.message.startsWith("model:") ? "Thinking..." : chunk.message);
        }
      },
    });

    setStreaming(null); setThinking(null); setBusy(false);

    if (tools.length) {
      setPendingTools(null);
      setHistory(h => [...h, { id: id(), type: "tools", tools }]);
    }

    if (result) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokPerSec = tokenCount > 0 ? (tokenCount / +elapsed).toFixed(1) : "0";
      setHistory(h => [...h, {
        id: id(), type: "assistant", model: resolvedModel, text: result.response.text,
        stats: `↑ ${result.response.usage.promptTokens} · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${elapsed}s`,
      }]);
    }
  }, [busy, engine]);

  const footerModel = engine.agents.active.modelTier === "auto" ? "auto" : (engine.container.config.models[engine.container.config.tiers[engine.agents.active.modelTier as keyof typeof engine.container.config.tiers]]?.model ?? engine.agents.active.modelTier);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "welcome" } as any, ...history]}>
        {(item: any) => {
          if (item.id === "welcome") return <Welcome key="welcome" model={footerModel} workspace={engine.shortPath} branch={engine.branch} />;
          switch (item.type) {
            case "user": return <UserMessage key={item.id} text={item.text} />;
            case "tools": return <ToolGroup key={item.id} tools={item.tools} />;
            case "diff": return <DiffDisplay key={item.id} summary={item.summary} lines={item.lines} />;
            case "assistant": return <AssistantMessage key={item.id} model={item.model} text={item.text} stats={item.stats} />;
            case "system": return <Text key={item.id} dimColor italic>  {item.text}</Text>;
            default: return null;
          }
        }}
      </Static>

      {pendingTools && <ToolGroup tools={pendingTools} />}
      {thinking && <ThinkingIndicator label={thinking} />}
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
              : <TextInput key={inputKey} value={input} onChange={(v) => { setInput(v); setAcIdx(0); }} onSubmit={handleSubmit} placeholder="ask a question or describe a task" />
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
      {panel === "plan" && <PlanPanel context={engine.context} onClose={() => setPanel(null)} />}
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
      {panel === "ideas" && <IdeasPanel workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel === "changes" && <ChangesPanel workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel === "agents" && <AgentsPanel agents={engine.agents} config={engine.container.config} workspaceRoot={engine.workspaceRoot} onClose={() => setPanel(null)} />}
      {panel && !["stats","help","tools","model","plan","memory","skills","mcp","templates","prompts","context","tasks","resume","rewind","ideas","changes","agents"].includes(panel) && <GenericPanel name={panel} onClose={() => setPanel(null)} />}
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

  // Config-driven plugin loading
  const startupWarnings: string[] = [];
  templates.setActivePlugins(container.config.plugins);
  for (const pluginName of container.config.plugins) {
    try {
      const pluginInterface = new PluginInterface(
        container.registry,
        container.bus,
        worktree,
        workspaceRoot,
        templates,
        agents,
        prompts,
        pluginName,
      );
      const mod = await import(pluginName);
      if (typeof mod.register === "function") {
        mod.register(pluginInterface);
      }
    } catch (err: any) {
      startupWarnings.push(`Plugin "${pluginName}" failed to load: ${err.message}`);
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
  const skills = new SkillManager();
  const logger = new AuditLogger({ workspaceRoot, sessionId });
  const guard = new ExceptionGuard(container.bus, context);
  const stats = new StatsTracker(sessionId);
  const scheduler = new TaskScheduler(container.bus, (instruction) => {
    cmdOutputFn(`[Scheduler Triggered] Executing: "${instruction}"`);
  });

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
    skills, templates, mcp, worktree, scheduler, bus: container.bus, workspaceRoot, sessionId,
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
    worktree, scheduler, brain, sessionId,
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

process.stdout.write("\x1b[?25l"); // Hide native cursor
process.on("exit", () => process.stdout.write("\x1b[?25h"));

render(<App engine={engine} />, { patchConsole: false, exitOnCtrlC: false });
process.stdout.write("\x1B[?25l"); // hide terminal cursor
