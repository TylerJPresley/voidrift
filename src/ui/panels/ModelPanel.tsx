import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { VoidRiftConfig } from "../../config/loader.js";
import type { AgentRegistry } from "../../agents/registry.js";

export function ModelPanel({ config, agents, onClose }: { config: VoidRiftConfig; agents: AgentRegistry; onClose: () => void }) {
  const models = Object.keys(config.models);
  const items = ["auto", ...models];
  const [selected, setSelected] = useState(0);

  const activeAgent = agents.active;
  const currentTier = activeAgent.modelTier;
  const [, forceRender] = useState(0);

  useInput((ch, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(items.length - 1, s + 1));
    if (key.return) {
      const picked = items[selected];
      activeAgent.modelTier = picked === "auto" ? "auto" : picked as any;
      onClose();
    }
    if (ch === "d" || ch === "u" || ch === "f") {
      const picked = items[selected];
      if (picked !== "auto") {
        if (ch === "d") config.tiers.dense = picked;
        if (ch === "u") config.tiers.utility = picked;
        if (ch === "f") config.tiers.flash = picked;
        // Persist tier assignment to global config
        try {
          const globalPath = join(process.env.HOME || "", ".config", "voidrift", "config.json");
          const raw = JSON.parse(readFileSync(globalPath, "utf-8"));
          raw.tiers = { ...raw.tiers, ...config.tiers };
          writeFileSync(globalPath, JSON.stringify(raw, null, 2));
        } catch {}
        forceRender((n) => n + 1);
      }
    }
  });

  const columns = [
    { key: "name", label: "Model", width: 22 },
    { key: "tiers", label: "Tiers", width: 10 },
    { key: "detail", label: "Provider / Model" },
  ];

  const rows = items.map(name => {
    if (name === "auto") {
      const label = currentTier === "auto" ? "✓ auto" : "auto";
      return { name: label, tiers: "", detail: "model router decides per turn" };
    }
    const cfg = config.models[name];
    const tierTags = Object.entries(config.tiers).filter(([, v]) => v === name).map(([k]) => k[0]).join(",");
    const label = name === currentTier ? `✓ ${name}` : name;
    return { name: label, tiers: tierTags ? `[${tierTags}]` : "", detail: `${cfg.protocol}/${cfg.model}` };
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Models <Text dimColor>({activeAgent.name} · {currentTier})</Text></Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      <Table columns={columns} rows={rows} cursor={selected} />
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Select  <Text color="#61afef" bold>d/u/f</Text> Assign tier  <Text color="#61afef" bold>esc</Text> Close</Text>
    </Box>
  );
}
