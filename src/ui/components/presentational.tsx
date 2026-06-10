import React, { useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import { Markdown } from "../markdown.js";
import type { HistoryItem } from "./types.js";

// ─── Presentational Components ───────────────────────────────────────────────

export function Welcome({ model, workspace, branch }: { model: string; workspace: string; branch: string | null }) {
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

export function UserMessage({ text, isFirst }: { text: string; isFirst?: boolean }) {
  return (
    <Box marginTop={isFirst ? 0 : 1} marginBottom={1}>
      <Text color="#6a7ec8">┃ </Text>
      <Text bold>{text}</Text>
    </Box>
  );
}

export function ToolGroup({ tools, describeToolCall }: { tools: any[]; describeToolCall: (name: string, argsStr: string) => { label: string; description: string; color: string } }) {
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

export function ToolStatusIcon({ status, color }: { status: "pending" | "executing" | "success" | "error"; color?: string }) {
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

export function DiffDisplay({ summary, lines }: { summary: string; lines: string[] }) {
  let addLine = 0;
  let delLine = 0;
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

export function AssistantMessage({ model, text, stats, prevType }: { model: string; text: string; stats?: string; prevType?: string }) {
  return (
    <Box flexDirection="column" marginTop={prevType === "user" ? 0 : 1}>
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column">
        <Markdown text={text.trim()} />
      </Box>
      {stats && <Text dimColor>  · {stats}</Text>}
    </Box>
  );
}

export function StreamingResponse({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
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

export function ThinkingIndicator({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color="yellow">  {frames[frame]} {label}</Text>;
}

export function SlashAutocomplete({ input, registry, selected }: { input: string; registry: any; selected: number }) {
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

export function Footer({ mode, model, contextPct, workspace, branch }: { mode: string; model: string; contextPct: number; workspace: string; branch: string | null }) {
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
