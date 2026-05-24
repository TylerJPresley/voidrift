import React, { useState, useCallback, useRef } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "./config/loader.js";
import { createAdapter } from "./adapters/factory.js";
import { SessionManager, type ConfirmFn } from "./session/manager.js";
import { saveSession, loadSession, clearSession } from "./session/persistence.js";
import { ToolRegistry, type ConfirmResult } from "./tools/registry.js";
import { builtinTools } from "./tools/builtins.js";
import { MarkdownText } from "./components/markdown.js";
import { hasUnclosedFormatting } from "./components/boundary.js";
import { useDebounce } from "./hooks/useDebounce.js";
import { ToolGroupMessage } from "./components/ToolGroupMessage.js";
import { ConfirmationPrompt } from "./components/ConfirmationPrompt.js";
import type { ToolCallData, ToolStatus } from "./components/ToolMessage.js";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const { model, modelName } = loadConfig();
const adapter = createAdapter(model);
const registry = new ToolRegistry();
builtinTools.forEach(t => registry.register(t));

// Restore previous session
const savedSession = loadSession();

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserMsg { id: string; type: "user"; text: string }
interface AssistantMsg { id: string; type: "assistant"; model: string; text: string; stats?: string }
interface ToolGroupMsg { id: string; type: "toolgroup"; tools: import("./components/ToolMessage.js").ToolCallData[] }
interface SystemMsg { id: string; type: "system"; text: string }

type HistoryItem = UserMsg | AssistantMsg | ToolGroupMsg | SystemMsg;

// ─── Components ──────────────────────────────────────────────────────────────

function Welcome({ modelName, protocol, cwd, branch }: { modelName: string; protocol: string; cwd: string; branch: string }) {
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
          <Text dimColor>{modelName} ({protocol})</Text>
          <Text dimColor>{cwd}</Text>
          <Text dimColor>{branch}</Text>
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

function AssistantMessage({ model, text, stats }: { model: string; text: string; stats?: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor italic>  {model}</Text>
      <Box>
        <Text color="#6a7ec8">┃ </Text>
        <MarkdownText text={text} />
      </Box>
      {stats && <Text dimColor>  · {stats}</Text>}
    </Box>
  );
}

function StreamingView({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
  const safe = !hasUnclosedFormatting(text);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor italic>  {model}</Text>
      <Box>
        <Text color="#6a7ec8">┃ </Text>
        {safe ? <MarkdownText text={text} /> : <Text>{text}</Text>}
      </Box>
      <Box><Text color="#6a7ec8">┃ </Text><Text color="#6a7ec8">▊</Text></Box>
      <Text dimColor>  ⠹ {elapsed}s · {tokens} tokens</Text>
    </Box>
  );
}

function Footer({ mode, model, contextPct, branch }: { mode: string; model: string; contextPct: number; branch: string }) {
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
          <Text dimColor> · </Text>
          <Text>🛡  0</Text>
        </Text>
        <Text>
          <Text color="#61afef">~/voidrift</Text>
          <Text dimColor> · </Text>
          <Text color="#00d4ff">{branch}</Text>
        </Text>
      </Box>
    </Box>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function getBranch(): string {
  try {
    const { execSync } = require("child_process");
    return execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  } catch { return ""; }
}

function getShortCwd(): string {
  const home = process.env.HOME || "";
  const cwd = process.cwd();
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

function App() {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (!savedSession?.messages.length) return [];
    // Convert saved messages to display history
    return savedSession.messages
      .filter(m => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m, i) => m.role === "user"
        ? { id: String(i), type: "user" as const, text: m.content || "" }
        : { id: String(i), type: "assistant" as const, model: modelName, text: m.content || "" }
      );
  });
  const [streaming, setStreaming] = useState<{ text: string; elapsed: number; tokens: number } | null>(null);
  const [toolGroup, setToolGroup] = useState<ToolCallData[]>([]);
  const [confirming, setConfirming] = useState<{ name: string; keyArg: string; args: Record<string, unknown>; resolve: (r: ConfirmResult) => void } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextPct, setContextPct] = useState(0);
  const debouncedCtx = useDebounce(contextPct, 300);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  const branch = getBranch();
  const cwd = getShortCwd();
  let nextId = history.length;
  const id = () => String(nextId++);

  // Confirmation callback for session manager
  const confirmFn: ConfirmFn = (toolName, args) => {
    return new Promise<ConfirmResult>((resolve) => {
      const keyArg = args.command ? String(args.command) : args.path ? String(args.path) : args.pattern ? String(args.pattern) : "";
      setConfirming({ name: toolName, keyArg, args, resolve });
    });
  };

  const sessionRef = useRef(() => {
    const s = new SessionManager(adapter, registry, confirmFn);
    if (savedSession?.messages) s.restoreHistory(savedSession.messages);
    return s;
  });
  const sessionInstance = useRef(sessionRef.current());

  useInput((ch, key) => {
    if (confirming) return; // Let ConfirmationPrompt handle input
    if (key.escape || (ch === "c" && key.ctrl)) {
      if (busy) {
        setBusy(false);
        setStreaming(null);
        setToolGroup([]);
        setHistory(h => [...h, { id: id(), type: "system", text: "Generation cancelled." }]);
        return;
      }
      setCtrlCHint(true);
      setTimeout(() => setCtrlCHint(false), 3000);
    }
  });

  const handleConfirm = useCallback((result: ConfirmResult) => {
    if (confirming) {
      confirming.resolve(result);
      setConfirming(null);
    }
  }, [confirming]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");

    if (text.trim() === "/exit") { exit(); return; }
    if (text.trim() === "/clear") { setHistory([]); setContextPct(0); clearSession(); return; }

    setHistory(h => [...h, { id: id(), type: "user", text: text.trim() }]);
    setBusy(true);
    setStreaming({ text: "", elapsed: 0, tokens: 0 });
    setToolGroup([]);

    const startTime = Date.now();
    let acc = "";
    let tokenCount = 0;
    let currentTools: ToolCallData[] = [];

    try {
      for await (const event of sessionInstance.current.send(text.trim())) {
        switch (event.type) {
          case "content":
            acc += event.content;
            tokenCount++;
            setStreaming({ text: acc, elapsed: +((Date.now() - startTime) / 1000).toFixed(1), tokens: tokenCount });
            break;
          case "tool_call": {
            setStreaming(null);
            const tc: ToolCallData = {
              id: event.toolCall!.id,
              name: event.toolCall!.name,
              keyArg: event.toolCall!.keyArg,
              status: "executing",
              startTime: Date.now(),
            };
            currentTools = [...currentTools, tc];
            setToolGroup([...currentTools]);
            break;
          }
          case "tool_result": {
            currentTools = currentTools.map(t =>
              t.id === event.toolResult!.id
                ? { ...t, status: "success" as ToolStatus, result: event.toolResult!.result, elapsed: `${((Date.now() - (t.startTime || Date.now())) / 1000).toFixed(1)}s` }
                : t
            );
            setToolGroup([...currentTools]);
            acc = "";
            tokenCount = 0;
            break;
          }
          case "tool_denied": {
            currentTools = currentTools.map(t =>
              t.id === event.toolCall!.id
                ? { ...t, status: "denied" as ToolStatus, elapsed: `${((Date.now() - (t.startTime || Date.now())) / 1000).toFixed(1)}s` }
                : t
            );
            setToolGroup([...currentTools]);
            acc = "";
            tokenCount = 0;
            break;
          }
          case "done":
            // Commit tool group to history if any
            if (currentTools.length > 0) {
              setHistory(h => [...h, { id: id(), type: "toolgroup", tools: currentTools }]);
              currentTools = [];
              setToolGroup([]);
            }
            if (acc) {
              const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
              const tokPerSec = tokenCount > 0 ? (tokenCount / +totalTime).toFixed(1) : "0";
              setHistory(h => [...h, { id: id(), type: "assistant", model: modelName, text: acc, stats: `↓ ${tokenCount} · ${tokPerSec} tok/s · ${totalTime}s` }]);
            }
            break;
        }
      }
    } catch (err: any) {
      setHistory(h => [...h, { id: id(), type: "system", text: `Error: ${err.message}` }]);
    }

    setStreaming(null);
    setToolGroup([]);
    setBusy(false);
    setContextPct(p => Math.min(95, p + 2));
    saveSession(sessionInstance.current.getHistory());
  }, [busy]);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "welcome", type: "welcome" as const }, ...history]}>
        {(item: any) => {
          if (item.type === "welcome") return <Welcome key="welcome" modelName={modelName} protocol={model.protocol} cwd={cwd} branch={branch} />;
          switch (item.type) {
            case "user": return <UserMessage key={item.id} text={item.text} />;
            case "assistant": return <AssistantMessage key={item.id} model={item.model} text={item.text} stats={item.stats} />;
            case "toolgroup": return <ToolGroupMessage key={item.id} tools={item.tools} />;
            case "system": return <Text key={item.id} dimColor italic>  {item.text}</Text>;
            default: return null;
          }
        }}
      </Static>

      {toolGroup.length > 0 && !confirming && <ToolGroupMessage tools={toolGroup} />}
      {confirming && <ConfirmationPrompt toolName={confirming.name} keyArg={confirming.keyArg} args={confirming.args} onRespond={handleConfirm} />}
      {streaming && streaming.text && <StreamingView model={modelName} text={streaming.text} elapsed={streaming.elapsed} tokens={streaming.tokens} />}
      {ctrlCHint && <Text dimColor italic>  Type /exit to exit.</Text>}

      <Box flexDirection="column" marginTop={1}>
        <Footer mode="chat" model={modelName} contextPct={debouncedCtx} branch={branch} />
        <Text> </Text>
        <Box>
          <Text color="#6a7ec8" bold>❯ </Text>
          {busy && !confirming
            ? <Text dimColor italic>streaming...</Text>
            : confirming
              ? <Text dimColor italic>↑/↓ to select, enter to confirm, esc to deny</Text>
              : <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="ask a question or describe a task" />
          }
        </Box>
      </Box>
    </Box>
  );
}

render(<App />);
