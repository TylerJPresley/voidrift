import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "../scroll-view.js";
import type { PolicyEngine } from "../../security/policy-engine.js";

export function PolicyPanel({ engine, onClose }: { engine: PolicyEngine; onClose: () => void }) {
  useInput((_, key) => { if (key.escape) onClose(); });
  const rules = engine.getRules();
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Policy Rules <Text dimColor>({rules.length})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Text dimColor>{"  "}{"Decision".padEnd(10)}{"Tool".padEnd(18)}{"Pattern".padEnd(25)}{"Source".padEnd(12)}{"Label"}</Text>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      {rules.length === 0 ? <Text dimColor>No rules loaded.</Text> : rules.map((r, i) => (
        <Text key={i}>
          {"  "}
          <Text color={r.decision === "allow" ? "green" : r.decision === "deny" ? "red" : "yellow"}>{r.decision.padEnd(10)}</Text>
          <Text>{(r.tool).padEnd(18)}</Text>
          <Text dimColor>{(r.pattern || "*").padEnd(25)}</Text>
          <Text>{(r.source).padEnd(12)}</Text>
          <Text dimColor>{r.label || ""}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
