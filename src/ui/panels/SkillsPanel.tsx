import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { trunc } from "./utils.js";
import { openInEditor } from "../../utils/editor.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { SkillManager } from "../../skills/manager.js";
import type { VoidRiftConfig } from "../../config/loader.js";
import type { AgentRegistry } from "../../agents/registry.js";

export function SkillsPanel({ skills, config, workspaceRoot, agents, onClose }: { skills: SkillManager; config: VoidRiftConfig; workspaceRoot: string; agents: AgentRegistry; onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Use indexed skills from the manager (already parsed with agents/active)
  const allAgentIds = [...agents.listInteractive(), ...agents.listTask()].map(a => a.id);
  const skillList = skills.indexed.map(s => {
    const hasInvalidAgents = s.agents.some(id => !allAgentIds.includes(id));
    const missingMeta = !s.name || !s.description;
    const raw = readFileSync(s.filePath, "utf-8");
    const missingStructure = !raw.includes("triggers:") || !raw.includes("agents:") || !raw.includes("active:");
    return {
      name: s.name,
      path: s.filePath,
      location: s.filePath.includes(".config/voidrift") ? "global" : "workspace",
      active: s.active,
      invalid: hasInvalidAgents || missingMeta || missingStructure,
    };
  });

  useInput((input, key) => {
    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const dir = createState.scope === "workspace"
            ? join(workspaceRoot, ".voidrift", "skills")
            : join(process.env.HOME || "", ".config", "voidrift", "skills");
          mkdirSync(dir, { recursive: true });
          const filePath = join(dir, `${createName}.md`);
          if (!existsSync(filePath)) {
            writeFileSync(filePath, `---\nname: "${createName}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\nagents: []\nactive: true\n---\n\n`, "utf-8");
          }
          setCreateState(null);
          setCreateName("");
          if (config.editor) {
            openInEditor(filePath, config.editor);
            setMessage(`Created ${createName} — editing`);
          } else {
            setMessage(`Created: ${filePath.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
          }
        } else if (key.backspace || key.delete) {
          setCreateName(n => n.slice(0, -1));
        } else if (input && /^[a-z0-9-]$/.test(input)) {
          setCreateName(n => n + input);
        }
      }
      return;
    }

    if (renaming) {
      if (key.escape) { setRenaming(false); setRenameName(""); setMessage(null); return; }
      if (key.return && renameName.length > 0) {
        const item = skillList[cursor];
        if (item) {
          const newPath = join(dirname(item.path), `${renameName}.md`);
          if (!existsSync(newPath)) {
            renameSync(item.path, newPath);
            setMessage(`Renamed: ${item.name} → ${renameName}`);
          } else {
            setMessage(`"${renameName}" already exists`);
          }
        }
        setRenaming(false);
        setRenameName("");
      } else if (key.backspace || key.delete) {
        setRenameName(n => n.slice(0, -1));
      } else if (input && /^[a-z0-9-]$/.test(input)) {
        setRenameName(n => n + input);
      }
      return;
    }

    if (key.escape) onClose();
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(skillList.length - 1, c + 1));
    if (key.return && skillList[cursor]) {
      if (config.editor) {
        const result = openInEditor(skillList[cursor].path, config.editor);
        setMessage(result.success ? `Opened: ${skillList[cursor].path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
      }
    }
    if (input === "c") {
      setCreateState({ step: "scope" });
      setMessage("Create skill — scope: (g) global  (w) workspace");
    }
    if (input === "r" && skillList[cursor]) {
      setRenaming(true);
      setRenameName("");
      setMessage(`Rename "${skillList[cursor].name}" — enter new id:`);
    }
    if (confirmDelete) {
      if (input === "y") {
        unlinkSync(skillList[cursor].path);
        setMessage(`Deleted: ${skillList[cursor].name}`);
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
        setMessage(null);
      }
      return;
    }
    if (key.delete && skillList[cursor]) {
      setConfirmDelete(true);
      setMessage(`Delete "${skillList[cursor].name}"? (y/n)`);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Skills</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {skillList.length === 0 ? (
        <Text dimColor>No skills found.</Text>
      ) : (<>
        <Text dimColor>{"  "}{"Name".padEnd(20)}{"Location".padEnd(15)}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {skillList.map((s, i) => (
          <Box key={`${s.location}-${s.name}`} flexDirection="column">
            <Text>
              <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
              <Text bold color={s.invalid ? "red" : "#61afef"}>{s.invalid ? "[X] " : ""}{trunc(s.name, 18, 20)}</Text>
              <Text>{s.location.padEnd(15)}</Text>
            </Text>
            {i < skillList.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
            {i === skillList.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
          </Box>
        ))}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/skills/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/skills/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
    </Box>
  );
}
