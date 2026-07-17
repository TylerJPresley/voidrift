import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function HistoryPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const [entries, setEntries] = useState<Array<{ timestamp: string; source: string; message: string; data?: any }>>([]);
  const termHeight = process.stdout.rows || 24;
  const viewHeight = termHeight - 7;

  useEffect(() => {
    setEntries(core.audit.list(200) as any[]);
  }, []);

  useInput((_, key) => { if (key.escape) onClose(); });

  const displayEntries = entries.slice(-50);
  const lines = displayEntries.map((e, i) => {
    const ts = e.timestamp?.slice(11, 19) || "";
    const detail = e.data ? (e.data.toolName || e.data.text?.slice(0, 40) || JSON.stringify(e.data).slice(0, 40)) : "";
    return <Text key={i}><Text dimColor>{ts}</Text> <Text color="#61afef">{(e.source || "").padEnd(8)}</Text> <Text>{(e.message || "").padEnd(30)}</Text> <Text dimColor>{detail}</Text></Text>;
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Audit History <Text dimColor>({entries.length} entries)</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <ScrollView height={viewHeight} lines={lines} />
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Scroll  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
