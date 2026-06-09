import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CoreRegistry } from "../../registry/core.js";

export function HelpPanel({ registry, sessionId, workspace, onClose }: { registry: CoreRegistry; sessionId: string; workspace: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const pages = ["general", "commands", "shortcuts", "context"];
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.leftArrow) setPage((p) => (p - 1 + 4) % 4);
    if (key.rightArrow) setPage((p) => (p + 1) % 4);
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Help</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box><Text bold color={page === 0 ? "#4ec9b0" : undefined}>{page === 0 ? "[ general ]" : "  general  "}</Text><Text>  </Text><Text bold color={page === 1 ? "#4ec9b0" : undefined}>{page === 1 ? "[ commands ]" : "  commands  "}</Text><Text>  </Text><Text bold color={page === 2 ? "#4ec9b0" : undefined}>{page === 2 ? "[ shortcuts ]" : "  shortcuts  "}</Text><Text>  </Text><Text bold color={page === 3 ? "#4ec9b0" : undefined}>{page === 3 ? "[ context ]" : "  context  "}</Text></Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {page === 0 && <>
        <Text>VoidRift — AI Engineering Harness</Text>
        <Text dimColor>Codebase understanding, permissioned edits, terminal execution.</Text>
        <Text> </Text>
        <Text><Text color="#61afef">Version:      </Text>0.1.0</Text>
        <Text><Text color="#61afef">Workspace:    </Text>{workspace}</Text>
        <Text><Text color="#61afef">Session:      </Text>{sessionId}</Text>
        <Text> </Text>
        <Text dimColor>Type / to see available commands</Text>
      </>}
      {page === 1 && (() => {
        const hooks = registry.listSlashCommandHooks();
        const core = hooks.filter(c => !c.source || c.source === "core");
        const plugins = new Map<string, typeof hooks>();
        hooks.filter(c => c.source && c.source !== "core").forEach(c => {
          const group = plugins.get(c.source!) || [];
          group.push(c);
          plugins.set(c.source!, group);
        });
        return <>
          <Text bold>Core</Text>
          {core.map((c) => <Text key={c.name}><Text color="#61afef">  {"/" + c.name.padEnd(14)}</Text><Text dimColor>{c.description}</Text></Text>)}
          {[...plugins.entries()].map(([source, cmds]) => <Box key={source} flexDirection="column" marginTop={1}>
            <Text bold>Plugin: {source}</Text>
            {cmds.map((c) => <Text key={c.name}><Text color="#c678dd">  {"/" + c.name.padEnd(14)}</Text><Text dimColor>{c.description}</Text></Text>)}
          </Box>)}
        </>;
      })()}
      {page === 2 && <>
        <Text bold>Input</Text>
        <Text><Text color="#61afef">{"TAB".padEnd(16)}</Text>Autocomplete command/path</Text>
        <Text><Text color="#61afef">{"SHIFT+TAB".padEnd(16)}</Text>Cycle mode (plan → chat → vibe)</Text>
        <Text><Text color="#61afef">{"Enter".padEnd(16)}</Text>Submit input</Text>
        <Text> </Text>
        <Text bold>Session</Text>
        <Text><Text color="#61afef">{"ESC".padEnd(16)}</Text>Cancel generation / close panel</Text>
        <Text><Text color="#61afef">{"Ctrl+C ×2".padEnd(16)}</Text>Exit VoidRift</Text>
      </>}
      {page === 3 && <>
        <Text>Context is assembled in four layers ordered by ascending volatility.</Text>
        <Text>Stable layers are cached by the provider. Volatile layers are discarded.</Text>
        <Text> </Text>
        <Text bold color="#98c379">Agent</Text><Text dimColor> Locked to the active agent. Rebuilds when you switch agents.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Persona</Text> the instructions that define the active agent's personality, expertise, and behavior</Text>
        <Text>  • <Text color="#61afef">Tool Schemas</Text> descriptions of every action the agent can perform, so it knows what's available</Text>
        <Text>  • <Text color="#61afef">Bound Skills</Text> technical guidelines permanently attached to this agent (e.g. framework standards)</Text>
        <Text>  • <Text color="#61afef">Skill Discovery Index</Text> a lightweight directory of all skills that could be loaded on demand</Text>
        <Text>  • <Text color="#61afef">Memory Index</Text> a lightweight directory of all saved lessons and learnings available to recall</Text>
        <Text> </Text>
        <Text bold color="#61afef">Orbit</Text><Text dimColor> Stable project landscape. Changes rarely (~5% of turns). Usually cached.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Plan</Text> the step-by-step roadmap the agent is following to complete a task</Text>
        <Text>  • <Text color="#61afef">Active Skills</Text> technical guidelines loaded because the current work triggered them</Text>
        <Text>  • <Text color="#61afef">Active Memory</Text> full lessons and learnings the agent pulled into working memory</Text>
        <Text> </Text>
        <Text bold color="#e5c07b">Drift</Text><Text dimColor> Active working set in motion. Changes on tool use (~30-40% of turns).</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">File Map</Text> a structural overview of every file in the workspace (names, exports, headings)</Text>
        <Text>  • <Text color="#61afef">Active Files</Text> detailed summaries of the specific files the agent is currently working with</Text>
        <Text>  • <Text color="#61afef">Workspace Changes</Text> which files have been modified, added, or deleted since the last save point</Text>
        <Text> </Text>
        <Text bold color="#e06c75">Void</Text><Text dimColor> Transient conversation. Changes every turn. Compacted or discarded.</Text>
        <Text> </Text>
        <Text>  • <Text color="#61afef">Messages</Text> the back-and-forth conversation between you and the agent</Text>
        <Text>  • <Text color="#61afef">Diagnostics</Text> errors or warnings from the last build, test, or validation run</Text>
      </>}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> cycle pages  <Text color="#61afef" bold>esc</Text> close</Text>
    </Box>
  );
}
