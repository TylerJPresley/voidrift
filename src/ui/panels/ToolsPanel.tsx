import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { trunc } from "./utils.js";
import { TOOL_SCHEMAS } from "../../tools/definitions.js";
import type { AgentRegistry } from "../../agents/registry.js";
import type { MCPEngine } from "../../mcp/engine.js";

export function ToolsPanel({ agents, mcp, onClose }: { agents: AgentRegistry; mcp: MCPEngine; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const agent = agents.active;
  const coreTools = TOOL_SCHEMAS.filter(t => agent.tools.includes(t.name));
  const mcpTools = mcp.connected.flatMap(s => s.tools.map(t => ({ name: t.name, server: s.name, fullName: `mcp_${s.name}_${t.name}`, description: t.description, inputSchema: t.inputSchema })));
  const pages = ["core", "mcp"];

  useInput((_, key) => {
    if (key.escape) { if (detail) setDetail(null); else onClose(); }
    if (!detail) {
      if (key.leftArrow) { setPage(p => (p - 1 + pages.length) % pages.length); setCursor(0); }
      if (key.rightArrow) { setPage(p => (p + 1) % pages.length); setCursor(0); }
      const items = page === 0 ? coreTools : mcpTools;
      if (key.upArrow) setCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));
      if (key.return && items[cursor]) setDetail(page === 0 ? coreTools[cursor].name : mcpTools[cursor].fullName);
    }
  });

  if (detail) {
    const coreT = coreTools.find(x => x.name === detail);
    const mcpT = mcpTools.find(x => x.fullName === detail);
    if (coreT) {
      const approved = agent.allowedTools.includes(coreT.name);
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
          <Text bold>Tools <Text dimColor>›</Text> {coreT.name}</Text>
          <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text> </Text>
          <Text><Text color="#61afef">{"Name:".padEnd(16)}</Text>{coreT.name}</Text>
          <Text><Text color="#61afef">{"Description:".padEnd(16)}</Text>{coreT.description}</Text>
          <Text><Text color="#61afef">{"Approval:".padEnd(16)}</Text>{approved ? <Text color="green">auto-approved</Text> : <Text color="yellow">requires confirmation</Text>}</Text>
          <Text> </Text>
          <Text bold>Parameters</Text>
          <Text dimColor>{"Name".padEnd(16)}{"Type".padEnd(10)}{"Required".padEnd(12)}{"Description"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          {coreT.parameters.map(p => (
            <Text key={p.name}><Text color="#61afef">{p.name.padEnd(16)}</Text><Text dimColor>{p.type.padEnd(10)}</Text>{p.required ? <Text color="yellow">{"required".padEnd(12)}</Text> : <Text dimColor>{"optional".padEnd(12)}</Text>}<Text dimColor>{p.description}</Text></Text>
          ))}
          <Text> </Text>
          <Text dimColor><Text color="#61afef" bold>esc</Text> back</Text>
        </Box>
      );
    }
    if (mcpT) {
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
          <Text bold>Tools <Text dimColor>› MCP ›</Text> {mcpT.name}</Text>
          <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text> </Text>
          <Text><Text color="#61afef">{"Name:".padEnd(16)}</Text>{mcpT.fullName}</Text>
          <Text><Text color="#61afef">{"Server:".padEnd(16)}</Text>{mcpT.server}</Text>
          <Text><Text color="#61afef">{"Description:".padEnd(16)}</Text>{mcpT.description}</Text>
          <Text> </Text>
          <Text bold>Input Schema</Text>
          <Text dimColor>{JSON.stringify(mcpT.inputSchema, null, 2).slice(0, 300)}</Text>
          <Text> </Text>
          <Text dimColor><Text color="#61afef" bold>esc</Text> back</Text>
        </Box>
      );
    }
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Tools <Text dimColor>({agent.name})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box><Text bold color={page === 0 ? "#4ec9b0" : undefined}>{page === 0 ? `[ core (${coreTools.length}) ]` : `  core (${coreTools.length})  `}</Text><Text>  </Text><Text bold color={page === 1 ? "#4ec9b0" : undefined}>{page === 1 ? `[ mcp (${mcpTools.length}) ]` : `  mcp (${mcpTools.length})  `}</Text></Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {page === 0 && <>
        {coreTools.map((t, i) => {
          const approved = agent.allowedTools.includes(t.name);
          return <Text key={t.name}><Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text><Text color={approved ? "green" : "yellow"}>{approved ? "✓ " : "🔒"}</Text><Text bold={i === cursor} color="#61afef">{trunc(t.name, 20, 22)}</Text><Text dimColor>{t.description}</Text></Text>;
        })}
      </>}
      {page === 1 && <>
        {mcpTools.length === 0 && <Text dimColor>No MCP servers connected.</Text>}
        {mcpTools.map((t, i) => (
          <Text key={t.fullName}><Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text><Text bold={i === cursor} color="#61afef">{trunc(t.name, 20, 22)}</Text><Text dimColor>{trunc(t.server, 12, 14)}</Text><Text dimColor>{t.description}</Text></Text>
        ))}
      </>}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> navigate  <Text color="#61afef" bold>enter</Text> details  <Text color="#61afef" bold>esc</Text> close</Text>
    </Box>
  );
}
