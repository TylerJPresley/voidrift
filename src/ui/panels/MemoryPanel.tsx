import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MemoryRegistry } from "../../session/memory.js";
import type { ContextManager } from "../../session/context.js";

export function MemoryPanel({ memory, context, onClose }: { memory: MemoryRegistry; context: ContextManager; onClose: () => void }) {
  const entries = memory.all;
  const [selected, setSelected] = useState(0);
  const [, forceUpdate] = useState(0);

  const activeMemory = context.context.orbit.activeMemory;
  const isLoaded = (id: string) => {
    const body = memory.loadBody(id);
    return body ? activeMemory.includes(body) : false;
  };

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(entries.length - 1, s + 1));
    if (ch === "l" && entries[selected]) {
      const body = memory.loadBody(entries[selected].id);
      if (body && !activeMemory.includes(body)) {
        context.loadMemory(body);
        forceUpdate((n) => n + 1);
      }
    }
    if (ch === "u" && entries[selected]) {
      const body = memory.loadBody(entries[selected].id);
      if (body) {
        const idx = activeMemory.indexOf(body);
        if (idx !== -1) {
          context.unloadMemory(idx);
          forceUpdate((n) => n + 1);
        }
      }
    }
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Memory</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {entries.length === 0 && <Text dimColor>No memories indexed.</Text>}
      {entries.map((m, i) => (
        <Text key={m.id}>
          <Text color={i === selected ? "#4ec9b0" : undefined}>{i === selected ? "▸ " : "  "}</Text>
          <Text color="#61afef">[{m.id}]</Text>{" "}
          {isLoaded(m.id) ? <Text color="green" bold>[LOADED] </Text> : ""}
          {m.title} — <Text dimColor>{m.summary}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>l</Text> Load  <Text color="#61afef" bold>u</Text> Unload  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
