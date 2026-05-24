import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "./config/loader.js";
import { createAdapter } from "./adapters/factory.js";
import { SessionManager } from "./session/manager.js";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const { model, modelName } = loadConfig();
const adapter = createAdapter(model);
const session = new SessionManager(adapter);

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserMsg { id: string; type: "user"; text: string }
interface AssistantMsg { id: string; type: "assistant"; model: string; text: string; stats?: string }
interface SystemMsg { id: string; type: "system"; text: string }

type HistoryItem = UserMsg | AssistantMsg | SystemMsg;

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
      {text.split("\n").map((line, i) => (
        <Box key={i}>
          <Text color="#6a7ec8">┃ </Text>
          <Text>{line}</Text>
        </Box>
      ))}
      {stats && <Text dimColor>  · {stats}</Text>}
    </Box>
  );
}

function StreamingView({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor italic>  {model}</Text>
      {text.split("\n").map((line, i) => (
        <Box key={i}>
          <Text color="#6a7ec8">┃ </Text>
          <Text>{line}</Text>
        </Box>
      ))}
      <Box>
        <Text color="#6a7ec8">┃ </Text>
        <Text color="#6a7ec8">▊</Text>
      </Box>
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
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streaming, setStreaming] = useState<{ text: string; elapsed: number; tokens: number } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextPct, setContextPct] = useState(0);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  const branch = getBranch();
  const cwd = getShortCwd();
  let nextId = history.length;
  const id = () => String(nextId++);

  useInput((ch, key) => {
    if (key.escape || (ch === "c" && key.ctrl)) {
      if (busy) {
        setBusy(false);
        setStreaming(null);
        setHistory(h => [...h, { id: id(), type: "system", text: "Generation cancelled." }]);
        return;
      }
      setCtrlCHint(true);
      setTimeout(() => setCtrlCHint(false), 3000);
    }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");

    if (text.trim() === "/exit") { exit(); return; }
    if (text.trim() === "/clear") {
      setHistory([]);
      setContextPct(0);
      return;
    }

    setHistory(h => [...h, { id: id(), type: "user", text: text.trim() }]);
    setBusy(true);
    setStreaming({ text: "", elapsed: 0, tokens: 0 });

    const startTime = Date.now();
    let acc = "";
    let tokenCount = 0;

    try {
      for await (const chunk of session.send(text.trim())) {
        if (chunk.content) {
          acc += chunk.content;
          tokenCount++;
          const elapsed = (Date.now() - startTime) / 1000;
          setStreaming({ text: acc, elapsed: +elapsed.toFixed(1), tokens: tokenCount });
        }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokPerSec = tokenCount > 0 ? (tokenCount / +totalTime).toFixed(1) : "0";
      setHistory(h => [...h, {
        id: id(), type: "assistant", model: modelName, text: acc,
        stats: `↑ — · ↓ ${tokenCount} · ${tokPerSec} tok/s · ${totalTime}s`
      }]);
    } catch (err: any) {
      setHistory(h => [...h, { id: id(), type: "system", text: `Error: ${err.message}` }]);
    }

    setStreaming(null);
    setBusy(false);
    setContextPct(p => Math.min(95, p + 2));
  }, [busy]);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "welcome", type: "welcome" as const }, ...history]}>
        {(item: any) => {
          if (item.type === "welcome") return <Welcome key="welcome" modelName={modelName} protocol={model.protocol} cwd={cwd} branch={branch} />;
          switch (item.type) {
            case "user": return <UserMessage key={item.id} text={item.text} />;
            case "assistant": return <AssistantMessage key={item.id} model={item.model} text={item.text} stats={item.stats} />;
            case "system": return <Text key={item.id} dimColor italic>  {item.text}</Text>;
            default: return null;
          }
        }}
      </Static>

      {streaming && <StreamingView model={modelName} text={streaming.text} elapsed={streaming.elapsed} tokens={streaming.tokens} />}

      {ctrlCHint && <Text dimColor italic>  Type /exit to exit.</Text>}

      <Box flexDirection="column" marginTop={1}>
        <Footer mode="chat" model={modelName} contextPct={contextPct} branch={branch} />
        <Text> </Text>
        <Box>
          <Text color="#6a7ec8" bold>❯ </Text>
          {busy
            ? <Text dimColor italic>streaming...</Text>
            : <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="ask a question or describe a task" />
          }
        </Box>
      </Box>
    </Box>
  );
}

render(<App />);
