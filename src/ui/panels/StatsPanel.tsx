import React from "react";
import { Box, Text, useInput } from "ink";
import { fmtMs } from "./utils.js";
import type { StatsTracker } from "../../session/stats.js";
import type { TokenBudgetWatcher } from "../../output/budget.js";

export function StatsPanel({ stats, budget, onClose }: { stats: StatsTracker; budget: TokenBudgetWatcher; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const s = stats.current;
  const b = budget.state;
  const ctxColor = b.percentage < 50 ? "green" : b.percentage < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Session Summary</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Text><Text color="#61afef">Session:   </Text><Text dimColor>{s.sessionId}</Text></Text>
      <Text><Text color="#61afef">Duration:  </Text>{stats.durationFormatted}</Text>
      <Text><Text color="#61afef">Turns:     </Text>{s.turns}</Text>
      <Text> </Text>
      <Text bold>Performance</Text>
      <Text><Text color="#61afef">Wall Time:   </Text>{stats.durationFormatted}</Text>
      <Text><Text color="#61afef">Tool Time:   </Text>{fmtMs(s.tools.totalTimeMs)}</Text>
      <Text> </Text>
      <Text bold>Tools</Text>
      <Text><Text color="#61afef">Calls:        </Text>{s.tools.total} ( <Text color="green">✓ {s.tools.success}</Text> <Text color="red">× {s.tools.failed}</Text> )</Text>
      <Text><Text color="#61afef">Success Rate: </Text><Text color="green">{s.tools.total > 0 ? Math.round((s.tools.success / s.tools.total) * 100) : 0}%</Text></Text>
      <Text> </Text>
      <Text bold>Model Usage</Text>
      <Text dimColor>{"Model".padEnd(28)}{"Turns".padStart(6)}{"Input".padStart(8)}{"Output".padStart(8)}{"tok/s".padStart(7)}</Text>
      <Text dimColor color="#333333">{"─".repeat(57)}</Text>
      {[...s.modelUsage.entries()].map(([name, u]) => (
        <Text key={name}>{name.padEnd(28)}{String(u.turns).padStart(6)}{String(u.inputTokens).padStart(8)}{String(u.outputTokens).padStart(8)}{(u.totalTimeMs > 0 ? (u.outputTokens / (u.totalTimeMs / 1000)).toFixed(1) : "—").padStart(7)}</Text>
      ))}
      <Text> </Text>
      <Text><Text color="#61afef">Context: </Text><Text color={ctxColor}>◎ {b.percentage}%</Text><Text dimColor> ({b.used} / {b.limit})</Text></Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
