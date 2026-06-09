import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export function ResumePanel({ workspaceRoot, currentSessionId, onResume, onClose }: { workspaceRoot: string; currentSessionId: string; onResume: (id: string, messages: Array<{ role: string; content: string }>) => void; onClose: () => void }) {
  const sessionsDir = join(workspaceRoot, ".voidrift", "sessions");
  const sessions: Array<{ id: string; turnCount: number; lastActivity: number; lastMessage: string }> = [];
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir)) {
      const metaPath = join(sessionsDir, name, "system.metadata.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const turnsPath = join(sessionsDir, name, "system.turns.json");
        let lastActivity = meta.startTime || 0;
        if (existsSync(turnsPath)) {
          const turns = JSON.parse(readFileSync(turnsPath, "utf-8"));
          if (turns.length) lastActivity = turns[turns.length - 1].timestamp;
        }
        let lastMessage = "";
        const msgsPath = join(sessionsDir, name, "work.messages.json");
        if (existsSync(msgsPath)) {
          const msgs = JSON.parse(readFileSync(msgsPath, "utf-8"));
          const lastUser = [...msgs].reverse().find((m: any) => m.role === "user");
          if (lastUser) lastMessage = lastUser.content.slice(0, 60).replace(/\n/g, " ");
        }
        sessions.push({ id: name, turnCount: meta.turnCount || 0, lastActivity, lastMessage });
      } catch { continue; }
    }
  }
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);

  const [selected, setSelected] = useState(0);
  useInput((_, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected(s => Math.max(0, s - 1));
    if (key.downArrow) setSelected(s => Math.min(sessions.length - 1, s + 1));
    if (key.return && sessions.length > 0) {
      const s = sessions[selected];
      const msgsPath = join(sessionsDir, s.id, "work.messages.json");
      const msgs = existsSync(msgsPath) ? JSON.parse(readFileSync(msgsPath, "utf-8")) : [];
      onResume(s.id, msgs);
    }
  });

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Conversations</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {sessions.length === 0
        ? <Text dimColor>No saved conversations found.</Text>
        : <Table
            columns={[
              { key: "id", label: "Session", width: 12 },
              { key: "turns", label: "Turns", width: 8 },
              { key: "activity", label: "Activity", width: 12 },
              { key: "message", label: "Last Message" },
            ]}
            rows={sessions.map(s => ({
              id: (s.id === currentSessionId ? "● " : "") + s.id.slice(0, 8),
              turns: String(s.turnCount),
              activity: relativeTime(s.lastActivity),
              message: s.lastMessage,
            }))}
            cursor={selected}
            dividers={false}
          />
      }
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Resume  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
