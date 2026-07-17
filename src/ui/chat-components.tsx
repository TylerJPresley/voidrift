/**
 * Chat UI Presentational Components.
 * Pure render — no business logic, no state mutations beyond local animation.
 */
import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Markdown } from "./markdown.js";
import { describeToolCall } from "./tool-descriptions.js";
import { VERSION } from "../version.js";
import type { CoreAPI } from "../plugins/interface.js";

/** Wrap file paths in tool results with clickable terminal hyperlinks */
function linkifyToolResult(text: string, toolName: string, argsStr: string): string {
  if (!["write_file", "edit_file", "read_file"].includes(toolName)) return text;
  try {
    const args = JSON.parse(argsStr);
    const path = args.path;
    if (!path) return text;
    const absolute = path.startsWith("/") ? path : `${process.cwd()}/${path}`;
    return text.replace(path, `\x1b]8;;file://${absolute}\x1b\\${path}\x1b]8;;\x1b\\`);
  } catch { return text; }
}

export type ToolStatus = "pending" | "executing" | "success" | "error";

export interface ToolCall {
  name: string;
  args: string;
  status: ToolStatus;
  result?: string;
  elapsed?: string;
}

export function Welcome({ workspace, branch }: { workspace: string; branch: string | null }) {
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
          <Text><Text color="#4ec9b0" bold>VoidRift</Text><Text dimColor> {VERSION}</Text></Text>
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
    <Box marginTop={1} marginBottom={1} width={(process.stdout.columns || 80)}>
      <Text color="#6a7ec8">┃ </Text>
      <Text bold wrap="wrap">{text}</Text>
    </Box>
  );
}

export function ToolGroup({ tools }: { tools: ToolCall[] }) {
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
              <Text dimColor wrap="wrap">  {linkifyToolResult(summary.split("\n")[0].slice(0, 80), tool.name, tool.args)}</Text>
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

export function ToolStatusIcon({ status, color }: { status: ToolStatus; color?: string }) {
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
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column" width={(process.stdout.columns || 80) - 1}>
        <Markdown text={text.trim()} />
      </Box>
      {stats && <Text dimColor>  · {stats}</Text>}
    </Box>
  );
}

export function StreamingResponse({ model, text, elapsed, tokens }: { model: string; text: string; elapsed: number; tokens: number }) {
  const [revealed, setRevealed] = useState(0);
  const targetRef = React.useRef(text);
  targetRef.current = text;

  useEffect(() => {
    if (revealed >= text.length) return;
    const chunkSize = Math.max(8, Math.ceil(text.length / 30));
    const t = setInterval(() => {
      setRevealed(r => {
        const next = Math.min(r + chunkSize, targetRef.current.length);
        if (next >= targetRef.current.length) clearInterval(t);
        return next;
      });
    }, 16);
    return () => clearInterval(t);
  }, [text.length]);

  const visibleText = text.slice(0, revealed);
  const done = revealed >= text.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderLeft borderColor="#6a7ec8" borderRight={false} borderTop={false} borderBottom={false} paddingLeft={1} flexDirection="column" width={(process.stdout.columns || 80) - 1}>
        <Markdown text={visibleText.trim()} />
        {!done && <Text color="#6a7ec8">▊</Text>}
      </Box>
      {!done && <Text dimColor>  {elapsed}s · {tokens} tokens</Text>}
      {done && <Text dimColor>  · {elapsed}s · {tokens} tokens</Text>}
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

export function SlashAutocomplete({ input, core: coreRef, selected }: { input: string; core: CoreAPI; selected: number }) {
  const query = input === "" ? "" : input.slice(1).toLowerCase();
  const all = coreRef.session.listCommands()
    .map(h => ({ name: h.name, description: h.description }))
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

export function Footer({ mode, model, contextPct, workspace, branch, tasks }: { mode: string; model: string; contextPct: number; workspace: string; branch: string | null; tasks: number }) {
  const ctxColor = contextPct < 50 ? "green" : contextPct < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(process.stdout.columns || 80)}</Text>
      <Box justifyContent="space-between">
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
