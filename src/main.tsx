#!/usr/bin/env node
console.error("DEBUG CWD:", process.cwd());
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { RawInput } from "./ui/raw-input.js";
import { randomUUID } from "crypto";
import { statSync } from "fs";
import {
  CoreAPI,
  AutocompleteEngine,
  type StreamChunk,
} from "./index.js";
import {
  StatsPanel, HelpPanel, ToolsPanel, ModelPanel, MemoryPanel, GenericPanel,
  SkillsPanel, MCPPanel, TemplatesPanel, PromptsPanel, ContextPanel, TasksPanel,
  ResumePanel, RewindPanel, AgentsPanel, PlanPanel, DiffPanel,
  PluginsPanel, PolicyPanel, HistoryPanel, ConfigPanel, RoutinesPanel,
} from "./panels.js";
import { clipboardHasImage, saveClipboardImage } from "./utils/clipboard.js";
import { VERSION } from "./version.js";
import { useConfirmation } from "./ui/hooks/useConfirmation.js";
import { describeToolCall } from "./ui/tool-descriptions.js";
import {
  Welcome, UserMessage, ToolGroup, DiffDisplay, AssistantMessage,
  StreamingResponse, ThinkingIndicator, SlashAutocomplete, Footer,
} from "./ui/chat-components.js";

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

// ─── App ─────────────────────────────────────────────────────────────────────

function App({ restoredHistory }: { restoredHistory?: Array<{ role: string; content: string }> | null }) {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (!restoredHistory?.length) return [];
    let n = 0;
    return restoredHistory.map((m) => {
      n++;
      if (m.role === "user") return { id: String(n), type: "user" as const, text: m.content };
      if (m.role === "assistant") return { id: String(n), type: "assistant" as const, model: "", text: m.content };
      if (m.role === "tool") return { id: String(n), type: "system" as const, text: `[tool] ${m.content.split("\n")[0].slice(0, 80)}` };
      return null;
    }).filter(Boolean) as HistoryItem[];
  });
  const [streaming, setStreaming] = useState<{ model: string; text: string; elapsed: number; tokens: number } | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<ToolCall[] | null>(null);
  const [pendingTurn, setPendingTurn] = useState<HistoryItem[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [clearKey, setClearKey] = useState(0);
  const [input, setInput] = useState("");
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardSizeKB, setClipboardSizeKB] = useState(0);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [fullPanel, setFullPanel] = useState<string | null>(null);
  const [autocompleteIdx, setAutocompleteIdx] = useState(0);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const autocompleteIdxRef = React.useRef(0);
  autocompleteIdxRef.current = autocompleteIdx;
  const [inputKey, setInputKey] = useState(0);
  const inputHistoryRef = React.useRef<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const draftRef = React.useRef("");
  const fileAutocompleteRef = React.useRef<AutocompleteEngine>((() => { const e = new AutocompleteEngine(); e.indexWorkspace(core.workspace.root(), () => core.workspace.listFiles()); return e; })());

  // Re-index file completions when files are created/deleted
  useEffect(() => {
    const unsub1 = core.events.subscribe("FILE_CREATED", () => { fileAutocompleteRef.current.indexWorkspace(core.workspace.root()); });
    const unsub2 = core.events.subscribe("FILE_DELETED", () => { fileAutocompleteRef.current.indexWorkspace(core.workspace.root()); });
    return () => { unsub1(); unsub2(); };
  }, []);

  const [exitPending, setExitPending] = useState(false);
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useState(0);

  // Tool confirmation state
  const { request: confirmRequest, options: confirmOptions, idx: confirmIdx, setIdx: setConfirmIdx, respond: respondConfirmation } = useConfirmation(core);

  // Helper: activate an agent — sets persona, mode, loads resources
  const activateAgent = (agentId: string) => {
    const agent = core.agents.activate(agentId);
    setHistory(h => [...h, { id: id(), type: "system", text: agent.welcomeMessage || `Switched to ${agent.name}` }]);
  };

  // Re-render on terminal resize
  useEffect(() => {
    const onResize = () => forceRender(n => n + 1);
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  // Re-render on task state changes (locks, subagents, scheduler)
  useEffect(() => {
    const onTaskChange = () => forceRender(n => n + 1);
    const unsub1 = core.events.subscribe("LOCKS_UPDATED", onTaskChange);
    const unsub2 = core.events.subscribe("SUBAGENT_SPAWNED", onTaskChange);
    const unsub3 = core.events.subscribe("SUBAGENT_COMPLETED", onTaskChange);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Show startup warnings
  useEffect(() => {
    if (core.session.warnings?.length) {
      setHistory(h => [...h, ...core.session.warnings!.map((w: string, i: number) => ({ id: `warn-${i}`, type: "callout" as const, level: "warning" as const, text: w }))]);
    }
  }, []);

  let nextId = 0;
  const id = () => `msg-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
  const abortRef = React.useRef<AbortController | null>(null);
  const busyRef = React.useRef(false);

  const showAutocomplete = !busy && !panel && ((input === "" && autocompleteOpen) || (input.startsWith("/") && !input.includes(" ")));
  const autocompleteCommands = showAutocomplete
    ? core.session.listCommands().map(c => c.name).filter(n => input === "" || n.startsWith(input.slice(1).toLowerCase()))
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
        core.events.emit("TURN_CANCELLED", { reason: "user", turnId: `turn-${Date.now()}` });
        core.events.emit("TURN_CANCELLED", { reason: "user", turnId: `turn-${Date.now()}` });
      }
    }
    if (key.tab && !busy && !panel) {
      if (showAutocomplete && autocompleteCommands.length && !key.shift) {
        setInput("/" + autocompleteCommands[autocompleteIdxRef.current]);
        setAutocompleteIdx(0);
        setInputKey(k => k + 1);
        return;
      }
      // File path completion: tab on non-slash input
      if (!key.shift && input && !input.startsWith("/")) {
        const matches = fileAutocompleteRef.current.complete(input);
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
        const agent = core.agents.cycle();
        activateAgent(agent.agent.id);
      }
    }
    if (ch === "v" && key.ctrl && !busy && !panel) {
      if (clipboardHasImage()) {
        const saved = saveClipboardImage(core.workspace.root());
        if (saved) { setClipboardImage(saved); setClipboardSizeKB(saved.length > 0 ? Math.round(statSync(saved).size / 1024) : 0); }
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
        core.session.shutdown().then(() => process.exit(0));
        return;
      }
      setExitPending(true);
      exitTimerRef.current = setTimeout(() => { setExitPending(false); }, 1000);
      return;
    }
    // Any other key clears exit pending
    if (exitPending && ch) { setExitPending(false); if (exitTimerRef.current) clearTimeout(exitTimerRef.current); }
    if (key.downArrow && !busy && !panel && input === "" && !autocompleteOpen) {
      setAutocompleteOpen(true); setAutocompleteIdx(0); return;
    }
    if (key.return && autocompleteOpen && input === "" && autocompleteCommands.length) {
      const selected = autocompleteCommands[autocompleteIdxRef.current % autocompleteCommands.length];
      setAutocompleteOpen(false); setAutocompleteIdx(0);
      setInput(""); setInputKey(k => k + 1);
      handleSubmit("/" + selected);
      return;
    }
    if (key.escape && autocompleteOpen) { setAutocompleteOpen(false); return; }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    // Synchronous guard — prevents double-submission before React re-renders
    if (busyRef.current) return;
    busyRef.current = true;
    inputHistoryRef.current.push(text);
    setHistIdx(-1);

    setInput("");
    const trimmed = text.trim();

    // Slash commands
    if (trimmed === "/quit") { core.session.shutdown().then(() => { process.stdout.write("\x1B[?25h"); exit(); }); return; }
    if (trimmed.startsWith("/")) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
      const handler = core.registry.getSlashCommand(cmd);
      if (handler) {
        let captured = "";
        setBusy(true);
        setThinking("Working...");
        core.session.setCmdOutput((t: string) => { captured += (captured ? "\n" : "") + t; setHistory(h => [...h, { id: id(), type: "system", text: t }]); });
        core.session.setOpenPanel((p: string) => { if (p === "diff" || p === "history") { process.stdout.write("\x1b[2J\x1b[H"); setFullPanel(p); } else setPanel(p); });
        await handler.execute(args);
        core.session.setCmdOutput(() => {});
        core.session.setOpenPanel(() => {});
        setBusy(false);
        busyRef.current = false;
        setThinking(null);
        if (cmd === "clear") { process.stdout.write("\x1b[2J\x1b[H"); setHistory([]); setClearKey(k => k + 1); return; }
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
    let hasIntermediateCommits = false;
    let resolvedModel = (() => { const selected = core.models.list().modelSelected; if (selected === "auto") return "auto"; const cfg = core.workspace.config(); return cfg.models[selected]?.model ?? selected; })();

    const result = await core.session.execute(messageText, {
      signal: abortController.signal,
      onChunk: (chunk: StreamChunk) => {
        if (chunk.type === "content") {
          fullText += chunk.text;
          tokenCount++;
          setThinking(null);
        }
        if (chunk.type === "reasoning") {
          // Reasoning/thinking — show as thinking indicator, don't include in response text
          setThinking("Reasoning...");
        }
        if (chunk.type === "tool_call") {
          if (fullText.trim()) {
            // Commit intermediate assistant text immediately to freeze it statically
            setHistory(h => [...h, { id: id(), type: "assistant", model: resolvedModel, text: fullText } as any]);
            fullText = "";
            hasIntermediateCommits = true;
          }
          setStreaming(null);
          setThinking(null);
          if (chunk.status === "executing") {
            // Render the executing tool dynamically (keeps dynamic height small)
            setPendingTools([{ name: chunk.name, args: chunk.args, status: "executing" }]);
          } else {
            // Clear the dynamic pending tool
            setPendingTools(null);
            // Commit the completed tool to static history chronologically
            const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
            setHistory(h => [...h, {
              id: id(),
              type: "tools",
              tools: [{
                name: chunk.name,
                args: chunk.args,
                status: chunk.status === "error" ? "error" : "success",
                result: (chunk as any).result,
                elapsed,
              }],
            } as any]);
          }
        }
        if (chunk.type === "error") {
          setThinking(null); setStreaming(null); setPendingTools(null);
          setHistory(h => [...h, { id: id(), type: "system", text: `⚠️ ${chunk.message}` } as any]);
        }
        if (chunk.type === "status") {
          if (chunk.message.startsWith("model:")) {
            const name = chunk.message.slice(6);
            const displayModel = core.models.list().modelSelected === "auto" ? `auto[${name}]` : name;
            resolvedModel = displayModel;
            setActiveModel(displayModel);
          }
          setStreaming(null);
          setThinking(chunk.message.startsWith("model:") ? null : chunk.message);
        }
      },
    });

    if (result) {
      // Skip if the turn was cancelled while we were awaiting
      if (abortController.signal.aborted) {
        setStreaming(null); setThinking(null); setBusy(false);
        busyRef.current = false;
        setPendingTools(null); setPendingTurn([]);
        return;
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokPerSec = tokenCount > 0 ? (tokenCount / +elapsed).toFixed(1) : "0";
      const cacheInfo = result.response.usage.cacheReadTokens ? ` » ${result.response.usage.cacheReadTokens}` : "";
      if (!result.response.text.trim()) {
        setHistory(h => [...h, { id: id(), type: "system", text: "⚠️ Model returned an empty response." } as any]);
      } else {
        if (fullText.trim()) {
          // Show the final trailing response via replay animation
          setStreaming({ model: resolvedModel, text: fullText, elapsed: +elapsed, tokens: tokenCount });
          setThinking(null);
          // Wait for reveal to finish, then commit to static
          const revealMs = Math.min(500, Math.max(200, fullText.length / 2));
          await new Promise(r => setTimeout(r, revealMs));
          setStreaming(null);
          const finalItem = {
            id: id(), type: "assistant", model: resolvedModel, text: fullText,
            stats: `↑ ${result.response.usage.promptTokens}${cacheInfo} · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${elapsed}s`,
          } as any;
          setHistory(h => [...h, finalItem]);
        } else {
          // No trailing text, just push statistics on a dim line
          setHistory(h => [...h, {
            id: id(), type: "system",
            text: `Stats: ↑ ${result.response.usage.promptTokens}${cacheInfo} · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${elapsed}s`
          } as any]);
        }
      }
    }

    setStreaming(null); setThinking(null); setBusy(false);
    busyRef.current = false;
    setPendingTools(null); setPendingTurn([]);
  }, [busy, clipboardImage]);

  // Subscribe to scheduled task triggers (queue if busy)
  const scheduledQueueRef = React.useRef<string[]>([]);
  useEffect(() => {
    return core.events.subscribe("USER_INPUT", (event: any) => {
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

  const footerModel = activeModel || (() => { const selected = core.models.list().modelSelected; return selected; })();

  return (
    <Box flexDirection="column" height={fullPanel ? process.stdout.rows || 24 : undefined}>
      {fullPanel === "diff" && <DiffPanel core={core} onClose={() => { setFullPanel(null); process.stdout.write("\x1b[2J\x1b[H"); }} />}
      {fullPanel === "history" && <HistoryPanel core={core} onClose={() => { setFullPanel(null); process.stdout.write("\x1b[2J\x1b[H"); }} />}
      {!fullPanel && <>
      <Static key={clearKey} items={[{ id: "welcome", type: "welcome" } as any, ...history]}>
        {(item: any, idx: number) => {
          if (item.type === "welcome") return <Welcome key="welcome" workspace={core.workspace.shortPath()} branch={core.workspace.branch()} />;
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
          <Text dimColor>📎 1 image attached (clipboard, {clipboardSizeKB} KB, image/png)  <Text color="#61afef">ctrl+x</Text> remove</Text>
        )}
        <Footer mode={core.agents.list().agents.find(a => a.active)?.name || "Chat"} model={footerModel} contextPct={core.models.contextPct()} workspace={core.workspace.shortPath()} branch={core.workspace.branch()} tasks={core.workspace.runningCount()} />
        <Text> </Text>
        <Box>
          {busy
            ? <Text dimColor italic>working... (esc to cancel)</Text>
            : panel
              ? <Text dimColor italic>esc to close</Text>
              : <RawInput value={input} onChange={(v) => { setInput(v); setAutocompleteIdx(0); setAutocompleteOpen(false); setHistIdx(-1); }} onSubmit={handleSubmit} placeholder={exitPending ? "press ctrl+c again to exit" : "ask a question or describe a task"} isActive={!busy && !panel} onIntercept={(ch, key) => {
                if (showAutocomplete && autocompleteCommands.length) {
                  if (key.upArrow) { setAutocompleteIdx(i => Math.max(i - 1, 0)); return true; }
                  if (key.downArrow) { setAutocompleteIdx(i => Math.min(i + 1, autocompleteCommands.length - 1)); return true; }
                  if (key.return) {
                    const selected = autocompleteCommands[autocompleteIdxRef.current % autocompleteCommands.length];
                    setInput(""); setAutocompleteIdx(0); setAutocompleteOpen(false);
                    handleSubmit("/" + selected);
                    return true;
                  }
                }
                return false;
              }} onHistoryUp={() => {
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

      {showAutocomplete && autocompleteCommands.length > 0 && (
        <SlashAutocomplete input={input} core={core} selected={autocompleteIdx} />
      )}

      {panel === "stats" && <StatsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "help" && <HelpPanel core={core} sessionId={core.session.id} workspace={core.workspace.shortPath()} onClose={() => setPanel(null)} />}
      {panel === "tools" && <ToolsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "model" && <ModelPanel core={core} onClose={() => { setPanel(null); setActiveModel(""); forceRender(n => n + 1); }} />}
      {panel === "plan" && <PlanPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "memory" && <MemoryPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "skills" && <SkillsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "mcp" && <MCPPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "templates" && <TemplatesPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "prompts" && <PromptsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "context" && <ContextPanel core={core} modelName={footerModel} onClose={() => setPanel(null)} />}
      {panel === "tasks" && <TasksPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "resume" && <ResumePanel core={core} onResume={(id, msgs) => {
        core.session.resume(id);
        // Rebuild UI history from persisted messages
        let n = 0;
        const restored = msgs.map((m: any) => {
          n++;
          if (m.role === "user") return { id: String(n), type: "user" as const, text: m.content };
          if (m.role === "assistant") return { id: String(n), type: "assistant" as const, model: "", text: m.content };
          if (m.role === "tool") return { id: String(n), type: "system" as const, text: `[tool] ${m.content.split("\n")[0].slice(0, 80)}` };
          return null;
        }).filter(Boolean) as any[];
        process.stdout.write("\x1b[2J\x1b[H");
        setHistory(restored);
        setClearKey(k => k + 1);
        setBusy(false); setThinking(null); setStreaming(null); setPendingTools(null); setPendingTurn([]);
        setPanel(null);
      }} onClose={() => setPanel(null)} />}
      {panel === "rewind" && <RewindPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "agents" && <AgentsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "plugins" && <PluginsPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "policy" && <PolicyPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "config" && <ConfigPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "routines" && <RoutinesPanel core={core} onClose={() => setPanel(null)} />}
      {panel === "history" && <HistoryPanel core={core} onClose={() => setPanel(null)} />}
      {panel && !["stats","help","tools","model","plan","memory","skills","mcp","templates","prompts","context","tasks","resume","rewind","agents","plugins","policy","history","config","routines"].includes(panel) && <GenericPanel name={panel} onClose={() => setPanel(null)} />}
      </>}
    </Box>
  );
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// --version flag
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`voidrift ${VERSION}`);
  process.exit(0);
}

// If --serve flag, run headless JSON-RPC mode (for VS Code / external frontends)
if (process.argv.includes("--serve")) {
  const { runServe } = await import("./serve.js");
  await runServe();
  // Never reaches here — serve handles its own lifecycle
}

import { createCore } from "./bootstrap/core.js";
const core = await createCore();

// --resume flag: load previous session
let restoredHistory: Array<{ role: string; content: string }> | null = null;
const resumeIdx = process.argv.indexOf("--resume");
if (resumeIdx !== -1) {
  const sessionArg = process.argv[resumeIdx + 1];
  const sessions = core.session.list();
  if (sessionArg && !sessionArg.startsWith("--")) {
    core.session.resume(sessionArg) && (restoredHistory = core.session.loadMessages(sessionArg)) && true;
  } else if (sessions.length > 0) {
    core.session.resume(sessions[0].id) && (restoredHistory = core.session.loadMessages(sessions[0].id)) && true;
  }
}

// ─── Signal Handlers (SYSTEMS-ENG: graceful shutdown) ────────────────────────

async function gracefulShutdown(signal: string) {
  process.stderr.write(`\n[VoidRift] Received ${signal}, shutting down...\n`);
  await core.session.shutdown();
  process.stdout.write("\x1B[?25h");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Render ──────────────────────────────────────────────────────────────────

process.stdout.write("\x1b[2J\x1b[H\x1b[?25l"); // Clear screen, move to top, hide cursor
process.on("exit", () => process.stdout.write("\x1b[?25h"));

render(<App restoredHistory={restoredHistory} />, { patchConsole: false, exitOnCtrlC: false });
process.stdout.write("\x1B[?25l"); // hide terminal cursor
