import React from "react";
import { Box, Text, useInput } from "ink";
import { fmtMs } from "./utils.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function StatsPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const s = core.models.stats();
  const b = core.models.context();
  const ctxColor = b.percentage < 50 ? "green" : b.percentage < 80 ? "yellow" : "red";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Session Summary</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Text><Text color="#61afef">Session:   </Text><Text dimColor>{s.sessionId}</Text></Text>
      <Text><Text color="#61afef">Duration:  </Text>{s.duration}</Text>
      <Text><Text color="#61afef">Turns:     </Text>{s.turns}</Text>
      <Text> </Text>
      <Text bold>Performance</Text>
      <Text><Text color="#61afef">Wall Time:   </Text>{s.duration}</Text>
      <Text><Text color="#61afef">Tool Time:   </Text>{fmtMs(s.tools.totalTimeMs)}</Text>
      <Text> </Text>
      <Text bold>Tools</Text>
      <Text><Text color="#61afef">Calls:        </Text>{s.tools.total} ( <Text color="green">✓ {s.tools.success}</Text> <Text color="red">× {s.tools.failed}</Text> )</Text>
      <Text><Text color="#61afef">Success Rate: </Text><Text color="green">{s.tools.total > 0 ? Math.round((s.tools.success / s.tools.total) * 100) : 0}%</Text></Text>
      {Object.keys(s.tools.perTool).length > 0 && (
        <>
          <Text> </Text>
          <Text bold>  Per-Tool Breakdown</Text>
          {Object.entries(s.tools.perTool).map(([name, count]) => (
            <Text key={name}>    <Text dimColor>{name.padEnd(24)}</Text>{String(count).padStart(4)} calls</Text>
          ))}
        </>
      )}
      <Text> </Text>
      <Text bold>Model Usage</Text>
      <Text dimColor>{"Model".padEnd(28)}{"Turns".padStart(6)}{"Input".padStart(8)}{"Output".padStart(8)}{"tok/s".padStart(7)}</Text>
      <Text dimColor color="#333333">{"─".repeat(57)}</Text>
      {s.models.map((m) => (
        <Text key={m.name}>{m.name.padEnd(28)}{String(m.turns).padStart(6)}{String(m.inputTokens).padStart(8)}{String(m.outputTokens).padStart(8)}{(m.totalTimeMs > 0 ? (m.outputTokens / (m.totalTimeMs / 1000)).toFixed(1) : "—").padStart(7)}</Text>
      ))}
      <Text> </Text>
      <Text><Text color="#61afef">Context: </Text><Text color={ctxColor}>◎ {b.percentage}%</Text><Text dimColor> ({b.used} / {b.limit})</Text></Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
