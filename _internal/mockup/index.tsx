import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";

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

// ─── Simulated Scenarios ─────────────────────────────────────────────────────

const SCENARIOS = [
  {
    tools: [{ name: "read_file", args: 'path: "src/config.ts"', result: "export const config = { model: 'qwen2.5-coder-32b', ... }" }],
    response: "The config file has three sections:\n\n**model** — The model identifier sent to the API endpoint.\n**protocol** — Which adapter to use (openai, anthropic, or gemini).\n**base_url** — The endpoint URL for the model API.\n\nEach section maps directly to the adapter factory.",
  },
  {
    tools: [
      { name: "read_file", args: 'path: "REQUIREMENTS.md"', result: "29,529 bytes read" },
      { name: "read_file", args: 'path: "ARCHITECTURE.md"', result: "435 bytes read" },
    ],
    response: "I've reviewed the project artifacts:\n\n```\nREQUIREMENTS.md  — 29KB (EARS notation + BDD)\nARCHITECTURE.md  — stub pointing to plan.md\n```\n\nThe requirements cover **7 sections** including:\n- Core Infrastructure (paths, bootstrap, adapters)\n- TUI & Output (streaming, tools, sessions)\n- Tools & MCP\n\nWhat would you like to work on?",
  },
  {
    tools: [
      { name: "read_file", args: 'path: "src/main.ts"', result: "42 lines read" },
      { name: "edit_file", args: 'path: "src/main.ts"', result: "+3 lines, -1 line" },
    ],
    diff: { summary: "src/main.ts (+3, -1)", lines: [" 22   def process(payload):", "-23       result = api.call(payload)", "+23       try:", "+24           result = api.call(payload)", "+25       except APIError as e:", "+26           raise"] },
    response: "Done. I added error handling to `process()`:\n\n```typescript\ntry {\n  result = api.call(payload);\n} catch (e) {\n  logger.error(`API failed: ${e}`);\n  throw;\n}\n```",
  },
  {
    tools: [{ name: "bash", args: 'command: "bun test"', result: "✓ 31 tests passed (0.8s)" }],
    response: "All tests pass. The test suite covers:\n\n- Config loading (5 tests)\n- Path resolution (4 tests)\n- Adapter factory (8 tests)\n- Session manager (6 tests)\n- Tool registry (8 tests)\n\nNo regressions detected.",
  },
];

// ─── Components ──────────────────────────────────────────────────────────────

function Welcome() {
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
          <Text dimColor>qwen2.5-coder-32b (OpenAI)</Text>
          <Text dimColor>~/Projects/voidrift</Text>
          <Text dimColor>gemini-core</Text>
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

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {tools.map((tool, i) => {
        const icon = tool.status === "success" ? "✓" : tool.status === "error" ? "✗" : tool.status === "executing" ? "⠹" : "○";
        const iconColor = tool.status === "success" ? "green" : tool.status === "error" ? "red" : "yellow";
        return (
          <Box key={i}>
            <Text color={iconColor}>{icon} </Text>
            <Text color="#61afef" bold>{tool.name}</Text>
            <Text dimColor> ({tool.args})</Text>
            {tool.elapsed && <Text dimColor> · {tool.elapsed}</Text>}
          </Box>
        );
      })}
      {tools.some(t => t.result) && (
        <Box marginLeft={2} flexDirection="column">
          {tools.filter(t => t.result).map((t, i) => (
            <Text key={i} dimColor>{t.result}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function DiffDisplay({ summary, lines }: { summary: string; lines: string[] }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>{summary}</Text>
      {lines.map((line, i) => {
        const color = line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined;
        return <Text key={i} color={color} dimColor={!color}>{line}</Text>;
      })}
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

function StreamingResponse({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
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

function ThinkingIndicator({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color="yellow">  {frames[frame]} {label}</Text>;
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
          <Text>🛡  4.2k</Text>
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

function StatsPanel({ onClose }: { onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1} paddingY={1}>
      <Text bold>Session Summary</Text>
      <Text> </Text>
      <Text><Text color="#61afef">Session:   </Text><Text dimColor>a3f7c912-8b4e</Text></Text>
      <Text><Text color="#61afef">Duration:  </Text><Text>12m 34s</Text></Text>
      <Text><Text color="#61afef">Turns:     </Text><Text>8</Text></Text>
      <Text> </Text>
      <Text bold>Performance</Text>
      <Text><Text color="#61afef">Wall Time:   </Text><Text>12m 34s</Text></Text>
      <Text><Text color="#61afef">API Time:    </Text><Text>2m 08s (17%)</Text></Text>
      <Text><Text color="#61afef">Tool Time:   </Text><Text>1m 12s (10%)</Text></Text>
      <Text> </Text>
      <Text bold>Tools</Text>
      <Text><Text color="#61afef">Calls:        </Text><Text>14 ( <Text color="green">✓ 13</Text> <Text color="red">× 1</Text> )</Text></Text>
      <Text><Text color="#61afef">Success Rate: </Text><Text color="green">93%</Text></Text>
      <Text> </Text>
      <Text bold>Model Usage</Text>
      <Text dimColor>{'Model'.padEnd(30)}{'Turns'.padStart(6)}{'Input'.padStart(8)}{'Output'.padStart(8)}{'Cache'.padStart(8)}{'tok/s'.padStart(7)}</Text>
      <Text dimColor>{'─'.repeat(67)}</Text>
      <Text>{'qwen2.5-coder-32b (local)'.padEnd(30)}{'5'.padStart(6)}{'12,840'.padStart(8)}{'3,205'.padStart(8)}{'—'.padStart(8)}{'42.1'.padStart(7)}</Text>
      <Text>{'claude-sonnet-4 (anthropic)'.padEnd(30)}{'3'.padStart(6)}{'8,420'.padStart(8)}{'1,105'.padStart(8)}{'6,200'.padStart(8)}{'68.3'.padStart(7)}</Text>
      <Text dimColor>{'─'.repeat(67)}</Text>
      <Text bold>{'Total'.padEnd(30)}{'8'.padStart(6)}{'21,260'.padStart(8)}{'4,310'.padStart(8)}{'6,200'.padStart(8)}{'—'.padStart(7)}</Text>
      <Text> </Text>
      <Text><Text color="#61afef">Context: </Text><Text color="green">◎ 34%</Text><Text dimColor> (21,260 / 62,000)</Text></Text>
      <Text> </Text>
      <Text dimColor>↑/↓ Scroll · <Text color="#61afef">esc</Text> Close</Text>
    </Box>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streaming, setStreaming] = useState<{ model: string; text: string; elapsed: number; tokens: number } | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<ToolCall[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextPct, setContextPct] = useState(12);
  const [ctrlC, setCtrlC] = useState(false);
  const [panel, setPanel] = useState<"stats" | null>(null);

  let nextId = history.length + 1;
  const id = () => String(nextId++);

  useInput((ch, key) => {
    if (key.escape) {
      if (panel) { setPanel(null); return; }
      if (busy) {
        setBusy(false);
        setThinking(null);
        setStreaming(null);
        setPendingTools(null);
        setHistory(h => [...h, { id: id(), type: "system", text: "Generation cancelled." }]);
      }
    }
    if (ch === "c" && key.ctrl) {
      if (ctrlC) exit();
      setCtrlC(true);
      setTimeout(() => setCtrlC(false), 2000);
    }
  });

  const simulate = useCallback(async (userText: string) => {
    setBusy(true);
    const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];

    // Thinking phase
    const thinkLabels = ["Thinking...", "Analyzing...", "Reading codebase...", "Planning approach..."];
    setThinking(thinkLabels[Math.floor(Math.random() * thinkLabels.length)]);
    await sleep(600 + Math.random() * 800);

    // Tool execution phase
    setThinking(null);
    const tools: ToolCall[] = scenario.tools.map(t => ({ ...t, status: "pending" as ToolStatus }));
    setPendingTools([...tools]);

    for (let i = 0; i < tools.length; i++) {
      tools[i].status = "executing";
      setPendingTools([...tools]);
      await sleep(200 + Math.random() * 400);
      tools[i].status = "success";
      tools[i].elapsed = `${(0.1 + Math.random() * 0.4).toFixed(1)}s`;
      setPendingTools([...tools]);
      await sleep(100);
    }

    // Commit tools to history
    setPendingTools(null);
    setHistory(h => [...h, { id: id(), type: "tools", tools }]);

    // Diff if present
    if ("diff" in scenario && scenario.diff) {
      setHistory(h => [...h, { id: id(), type: "diff", summary: scenario.diff!.summary, lines: scenario.diff!.lines }]);
    }

    // Streaming response phase
    const words = scenario.response.split(" ");
    let acc = "";
    const startTime = Date.now();
    for (let i = 0; i < words.length; i++) {
      acc += (i > 0 ? " " : "") + words[i];
      const elapsed = ((Date.now() - startTime) / 1000);
      setStreaming({ model: "qwen2.5-coder-32b", text: acc, elapsed: +elapsed.toFixed(1), tokens: i + 1 });
      await sleep(20 + Math.random() * 40);
    }

    // Finalize
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const tokPerSec = (words.length / +totalTime).toFixed(1);
    setStreaming(null);
    setHistory(h => [...h, {
      id: id(), type: "assistant", model: "qwen2.5-coder-32b", text: acc,
      stats: `↑ ${100 + Math.floor(Math.random() * 400)} · ↓ ${words.length} · ${tokPerSec} tok/s · ${totalTime}s`
    }]);
    setContextPct(p => Math.min(95, p + 2 + Math.floor(Math.random() * 4)));
    setBusy(false);
  }, []);

  const handleSubmit = useCallback((text: string) => {
    if (!text.trim() || busy) return;
    setInput("");

    if (text.trim() === "/quit") { exit(); return; }
    if (text.trim() === "/clear") {
      setHistory([]);
      setContextPct(5);
      setPanel(null);
      return;
    }
    if (text.trim() === "/stats") { setPanel("stats"); return; }

    setHistory(h => [...h, { id: id(), type: "user", text: text.trim() }]);
    simulate(text.trim());
  }, [busy, simulate, exit]);

  return (
    <Box flexDirection="column">
      {/* Static completed history */}
      <Static items={[{ id: "welcome" } as any, ...history]}>
        {(item: any) => {
          if (item.id === "welcome") return <Welcome key="welcome" />;
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

      {/* Live: pending tools */}
      {pendingTools && <ToolGroup tools={pendingTools} />}

      {/* Live: thinking */}
      {thinking && <ThinkingIndicator label={thinking} />}

      {/* Live: streaming response */}
      {streaming && <StreamingResponse {...streaming} />}

      {/* Ctrl+C warning */}
      {ctrlC && <Text color="yellow">  Press Ctrl+C again to exit.</Text>}

      {/* Footer + Input */}
      <Box flexDirection="column" marginTop={1}>
        <Footer mode="chat" model="qwen2.5-coder-32b" contextPct={contextPct} branch="gemini-core" />
        <Text> </Text>
        <Box>
          <Text color="#6a7ec8" bold>❯ </Text>
          {busy
            ? <Text dimColor italic>working... (esc to cancel)</Text>
            : panel
              ? <Text dimColor italic>esc to close</Text>
              : <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="ask a question or describe a task" />
          }
        </Box>
      </Box>

      {/* Panel (slash command output — below input) */}
      {panel === "stats" && <StatsPanel onClose={() => setPanel(null)} />}
    </Box>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

render(<App />);
