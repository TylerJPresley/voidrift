import React from "react";
import { Box, Text, useInput } from "ink";
import type { TaskScheduler } from "../../orchestration/scheduler.js";

export function TasksPanel({
  scheduler,
  onClose,
}: {
  scheduler?: TaskScheduler;
  onClose: () => void;
}) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const tasks = scheduler ? scheduler.all : [];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Background Tasks</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {tasks.length === 0 ? (
        <Text dimColor>No active background tasks.</Text>
      ) : (
        tasks.map((task) => (
          <Text key={task.id}>
            <Text color={task.status === "active" ? "green" : "grey"}>● </Text>
            <Text color="#61afef">[{task.id}]</Text>{" "}
            <Text bold>({task.type})</Text> {task.instruction} — <Text dimColor>Status: {task.status}</Text>
          </Text>
        ))
      )}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
