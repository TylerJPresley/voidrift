import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import { TOOL_SCHEMAS } from "../../tools/definitions.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ContextPanel({
  core,
  modelName,
  onClose,
}: {
  core: CoreAPI;
  modelName: string;
  onClose: () => void;
}) {
  // Derive all data from CoreAPI
  const detail = core.models.contextDetail();
  const budget = core.models.context();
  const messages = core.session.messages();
  const [page, setPage] = useState(0);
  const pages = ["overview", "agent", "orbit", "drift", "void"];

  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.leftArrow) setPage(p => (p - 1 + pages.length) % pages.length);
    if (key.rightArrow) setPage(p => (p + 1) % pages.length);
  });

  const totalLimit = detail.limit;

  const focusedFiles = detail.drift.focusedFiles;
  const tools = detail.agent.tools;

  // Token values from API
  const personaTokens = detail.agent.personaTokens;
  const toolsTokens = detail.agent.toolsTokens;
  const boundSkillsTokens = detail.agent.boundSkillsTokens;
  const boundSkills = Array(detail.agent.boundSkills);
  const skillIndex = Array(detail.agent.skillIndex);
  const skillIndexTokens = detail.agent.skillIndexTokens;
  const memoryIndex = Array(detail.agent.memoryIndex);
  const memoryIndexTokens = detail.agent.memoryIndexTokens;

  const activeSkills = Array(detail.orbit.activeSkills);
  const activeSkillsTokens = detail.orbit.activeSkillsTokens;
  const activeMemory = Array(detail.orbit.activeMemory);
  const memoryTokens = detail.orbit.memoryTokens;
  const planTokens = detail.orbit.planTokens;

  const codeMapTokens = detail.drift.codeMapTokens;
  const filesTokens = detail.drift.filesTokens;
  const gitTokens = detail.drift.gitTokens;

  const msgTokens = detail.void.messagesTokens;
  const toolResultTokens = detail.void.toolResultTokens;
  const diagTokens = detail.void.diagnosticsTokens;

  const agentTotal = personaTokens + toolsTokens + boundSkillsTokens + skillIndexTokens + memoryIndexTokens;
  const orbitTotal = activeSkillsTokens + memoryTokens + planTokens;
  const driftTotal = codeMapTokens + filesTokens + gitTokens;
  const voidTotal = msgTokens + toolResultTokens + diagTokens;
  const totalUsed = agentTotal + orbitTotal + driftTotal + voidTotal;
  const freeTokens = Math.max(0, totalLimit - totalUsed);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const pct = (n: number) => totalLimit > 0 ? ((n / totalLimit) * 100).toFixed(1) : "0";

  const turnCount = messages.filter(m => m.role === "user").length;

  // Grid
  const renderGrid = (rows: number, items: Array<{ tokens: number; char: string; color: string }>) => {
    const totalBlocks = rows * 30;
    const blocks: Array<{ char: string; color: string }> = [];

    for (const item of items) {
      const count = Math.round((item.tokens / totalLimit) * totalBlocks);
      for (let i = 0; i < count && blocks.length < totalBlocks; i++) {
        blocks.push({ char: item.char, color: item.color });
      }
    }
    while (blocks.length < totalBlocks) blocks.push({ char: "□", color: "grey" });

    const gridRows = [];
    for (let r = 0; r < rows; r++) {
      const cols = [];
      for (let c = 0; c < 30; c++) {
        const bl = blocks[r * 30 + c];
        cols.push(<Text key={c} color={bl.color}>{bl.char} </Text>);
      }
      gridRows.push(<Box key={r}>{cols}</Box>);
    }
    return gridRows;
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Context</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box>{pages.map((name, i) => (<React.Fragment key={name}><Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${name} ]` : `  ${name}  `}</Text>{i < pages.length - 1 && <Text>  </Text>}</React.Fragment>))}</Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {page === 0 && <>
      <Text bold>Agent <Text dimColor>({fmt(agentTotal)} · {pct(agentTotal)}%) locked to active agent</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: personaTokens, char: "⚙", color: "#61afef" },
            { tokens: toolsTokens, char: "●", color: "#e5c07b" },
            { tokens: boundSkillsTokens, char: "◎", color: "#c678dd" },
            { tokens: skillIndexTokens, char: "▪", color: "#56b6c2" },
            { tokens: memoryIndexTokens, char: "◆", color: "#d19a66" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">⚙</Text> Persona: {fmt(personaTokens)}</Text>
          <Text><Text color="#e5c07b">●</Text> Tool Schemas: {fmt(toolsTokens)} <Text dimColor>({tools.length} tools)</Text></Text>
          <Text><Text color="#c678dd">◎</Text> Bound Skills: {fmt(boundSkillsTokens)} <Text dimColor>({boundSkills.length} loaded)</Text></Text>
          <Text><Text color="#56b6c2">▪</Text> Skill Index: {fmt(skillIndexTokens)} <Text dimColor>({skillIndex.length} available)</Text></Text>
          <Text><Text color="#d19a66">◆</Text> Memory Index: {fmt(memoryIndexTokens)} <Text dimColor>({memoryIndex.length} discovered)</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Orbit <Text dimColor>({fmt(orbitTotal)} · {pct(orbitTotal)}%) stable project landscape</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: activeSkillsTokens, char: "◎", color: "#c678dd" },
            { tokens: memoryTokens, char: "▪", color: "#e5c07b" },
            { tokens: planTokens, char: "◆", color: "#61afef" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#c678dd">◎</Text> Active Skills: {fmt(activeSkillsTokens)} <Text dimColor>({activeSkills.length} triggered)</Text></Text>
          <Text><Text color="#e5c07b">▪</Text> Memory: {fmt(memoryTokens)} <Text dimColor>({activeMemory.length} loaded)</Text></Text>
          <Text><Text color="#61afef">◆</Text> Plan: {fmt(planTokens)} <Text dimColor>{detail.orbit.plan ? "active" : "none"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Drift <Text dimColor>({fmt(driftTotal)} · {pct(driftTotal)}%) active working set</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(4, [
            { tokens: codeMapTokens, char: "●", color: "#98c379" },
            { tokens: filesTokens, char: "◎", color: "cyan" },
            { tokens: gitTokens, char: "▪", color: "#56b6c2" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#98c379">●</Text> File Map: {fmt(codeMapTokens)}</Text>
          <Text><Text color="cyan">◎</Text> Active Files: {fmt(filesTokens)} <Text dimColor>({focusedFiles.length}/3 slots)</Text></Text>
          {focusedFiles.map((f, i) => <Text key={i} dimColor>     {f.path} <Text color="gray">({f.totalLines}L{f.readRanges.length ? `, ${f.readRanges.length} range${f.readRanges.length > 1 ? "s" : ""} read` : ""})</Text></Text>)}
          <Text><Text color="#56b6c2">▪</Text> Workspace Changes: {fmt(gitTokens)} <Text dimColor>{detail.drift.gitStatus ? "modified" : "clean"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>Void <Text dimColor>({fmt(voidTotal)} · {pct(voidTotal)}%) transient conversation</Text></Text>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={4}>
          {renderGrid(8, [
            { tokens: msgTokens, char: "◎", color: "#61afef" },
            { tokens: toolResultTokens, char: "●", color: "#e5c07b" },
            { tokens: diagTokens, char: "✗", color: "red" },
          ])}
        </Box>
        <Box flexDirection="column">
          <Text><Text color="#61afef">◎</Text> Messages: {fmt(msgTokens)} <Text dimColor>({turnCount} turn{turnCount !== 1 ? "s" : ""})</Text></Text>
          <Text><Text color="#e5c07b">●</Text> Tool Results: {fmt(toolResultTokens)}</Text>
          <Text><Text color="red">✗</Text> Diagnostics: {fmt(diagTokens)} <Text dimColor>{detail.void.diagnostics ? "active" : "none"}</Text></Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold>{modelName} · {fmt(totalUsed)}/{fmt(totalLimit)} ({pct(totalUsed)}%) <Text dimColor>Free: {fmt(freeTokens)}</Text></Text>
      </>}
      {page === 1 && (() => {
        const agentLines: React.ReactNode[] = [];
        const allTools = TOOL_SCHEMAS.filter(t => detail.agent.tools.includes(t.name));
        agentLines.push(<Text key="total"><Text bold>Tokens </Text><Text dimColor>{fmt(agentTotal)}</Text></Text>);
        agentLines.push(<Text key="sp0">{" "}</Text>);
        // Tools
        agentLines.push(<Text key="h-tools" bold>Tools <Text dimColor>({allTools.length})</Text></Text>);
        for (const [i, t] of allTools.entries()) {
          const approved = true; // all tools bound are available
          agentLines.push(<Text key={`t-${i}`} dimColor>  {t.name.padEnd(18)} {t.description}</Text>);
        }
        agentLines.push(<Text key="sp1">{" "}</Text>);
        // Bound Skills
        agentLines.push(<Text key="h-skills" bold>Bound Skills <Text dimColor>({boundSkills.length})</Text></Text>);
        if (boundSkills.length === 0) { agentLines.push(<Text key="sk-none" dimColor>  none</Text>); }
        else { for (const [i, s] of boundSkills.entries()) { agentLines.push(<Text key={`sk-${i}`} dimColor>  {s.slice(0, 100)}</Text>); }}
        agentLines.push(<Text key="sp2">{" "}</Text>);
        // Persona
        agentLines.push(<Text key="h-persona" bold>Persona <Text dimColor>({fmt(personaTokens)} tok)</Text></Text>);
        for (const [i, line] of detail.agent.persona.split("\n").entries()) {
          agentLines.push(<Text key={`p-${i}`} dimColor>{line}</Text>);
        }
        agentLines.push(<Text key="sp3">{" "}</Text>);
        return <ScrollView height={20} lines={agentLines} />;
      })()}
      {page === 2 && <Box flexDirection="column">
        <Text><Text bold>Tokens </Text><Text dimColor>{fmt(orbitTotal)}</Text></Text>
        <Text> </Text>
        <Text bold>Active Skills <Text dimColor>({activeSkills.length} triggered)</Text></Text>
        {activeSkills.length === 0 ? <Text dimColor>none</Text> : activeSkills.map((s, i) => <Text key={i} dimColor>{s.slice(0, 100)}…</Text>)}
        <Text> </Text>
        <Text bold>Memory <Text dimColor>({activeMemory.length} loaded)</Text></Text>
        {activeMemory.length === 0 ? <Text dimColor>none</Text> : activeMemory.map((m, i) => <Text key={i} dimColor>{m.slice(0, 100)}…</Text>)}
        <Text> </Text>
        <Text bold>Plan</Text>
        {detail.orbit.plan ? <Text dimColor>{detail.orbit.plan.slice(0, 200)}…</Text> : <Text dimColor>no active plan</Text>}
      </Box>}
      {page === 3 && (() => {
        const driftLines: React.ReactNode[] = [];
        driftLines.push(<Text key="tok"><Text bold>Tokens </Text><Text dimColor>{fmt(driftTotal)}</Text></Text>);
        driftLines.push(<Text key="sp-tok">{" "}</Text>);
        const allPaths: string[] = [];
        // Git status
        driftLines.push(<Text key="gs"><Text bold>Git </Text><Text dimColor>{detail.drift.gitStatus || "clean"}</Text></Text>);
        driftLines.push(<Text key="sp-gs">{" "}</Text>);
        // File Map stats
        driftLines.push(<Text key="fm"><Text bold>File Map </Text><Text dimColor>{allPaths.length} files · {focusedFiles.length} active</Text></Text>);
        driftLines.push(<Text key="sp">{" "}</Text>);
        // Active files at top
        for (const [i, f] of focusedFiles.entries()) {
          driftLines.push(<Text key={`af-${i}`} bold color="#4ec9b0">● {f.path}</Text>);
        }
        // Rest of files
        const activePaths = new Set(focusedFiles.map(f => f.path));
        for (const [i, p] of allPaths.filter(p => !activePaths.has(p)).entries()) {
          driftLines.push(<Text key={`f-${i}`} dimColor>  {p}</Text>);
        }
        return <ScrollView height={20} lines={driftLines} />;
      })()}
      {page === 4 && <Box flexDirection="column">
        <Text><Text bold>Tokens </Text><Text dimColor>{fmt(voidTotal)}</Text></Text>
        <Text> </Text>
        <Text><Text bold>Messages </Text><Text dimColor>{messages.length}</Text></Text>
        {messages.slice(-10).map((m, i) => <Text key={i} dimColor wrap="truncate">[{m.role}] {m.content.slice(0, 100)}{m.content.length > 100 ? "…" : ""}</Text>)}
        {messages.length > 10 && <Text dimColor>  … {messages.length - 10} older</Text>}
        <Text> </Text>
        <Text bold>Diagnostics</Text>
        <Text dimColor>{detail.void.diagnostics || "none"}</Text>
      </Box>}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> Tab  <Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
