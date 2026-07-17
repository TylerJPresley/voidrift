import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { trunc } from "./utils.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function SkillsPanel({ core, onClose }: { core: CoreAPI; onClose: () => void }) {
  const config = core.workspace.config();
  const skills = { indexedSkills: core.skills.list().skills.map(s => ({ ...s, filePath: s.filePath, content: "", triggers: s.triggers, sourcePlugin: "filesystem" })) };
  const allAgentIds = core.agents.list().agents.map(a => a.id);
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pages = ["core", "custom"];

  const coreSkills = skills.indexedSkills.filter(s => s.filePath === "(builtin)");
  const customSkills = skills.indexedSkills.filter(s => s.filePath !== "(builtin)").map(s => {
    const hasInvalidAgents = s.agents.some(id => !allAgentIds.includes(id));
    const missingMeta = !s.name || !s.description;
    const missingStructure = !(s.triggers?.extensions?.length || s.triggers?.files?.length || s.triggers?.keywords?.length);
    return {
      name: s.name,
      description: s.description,
      path: s.filePath,
      location: s.filePath.includes(".config/voidrift") ? "global" : "workspace",
      active: s.active,
      invalid: hasInvalidAgents || missingMeta || missingStructure,
    };
  });

  const isCorePage = page === 0;

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === "y") {
        const item = customSkills[cursor];
        if (item) { core.skills.delete(item.name); setMessage(`Deleted: ${item.name}`); }
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
        setMessage(null);
      }
      return;
    }

    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter skill id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const filePath = core.skills.create(createName, createState.scope as "workspace" | "global");
          setCreateState(null);
          setCreateName("");
          const result = core.editor.open(filePath);
          setMessage(result.success ? `Created ${createName} — editing` : `Created: ${createName} (${result.error || "set editor in config"})`);
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
        const item = customSkills[cursor];
        if (item) {
          const result = core.skills.rename(item.name, renameName);
          setMessage(result.success ? `Renamed: ${item.name} → ${renameName}` : result.error || "Rename failed");
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

    // ─── Core Detail View ───
    if (detail && isCorePage) {
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); return; }
      if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setDetailCursor(c => Math.min(2, c + 1));
      if (key.return) {
        const skill = coreSkills.find(s => s.name === detail);
        if (!skill) return;

        if (detailCursor === 0) {
          // View default (built-in)
          const content = `---\nname: "${skill.name}"\ndescription: "${skill.description}"\ntriggers:\n  keywords: [${(skill.triggers.keywords || []).map(k => `"${k}"`).join(", ")}]\nagents: [${skill.agents.map(a => `"${a}"`).join(", ")}]\nactive: ${skill.active}\n---\n\n${skill.content}\n`;
          const result = core.editor.viewReadonly(content, `${detail}_skill.md`);
          setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "No editor configured");
        } else {
          const scope = detailCursor === 1 ? "global" : "workspace";
          const path = core.skills.createOverride(detail!, scope as "workspace" | "global");
          const result = core.editor.open(path);
          setMessage(result.success ? `Opened: ${core.workspace.shortenPath(path)}` : result.error || "No editor configured");
        }
      }
      return;
    }

    // ─── List View ───
    if (key.escape) onClose();
    if (key.leftArrow) { setPage(p => (p - 1 + 2) % 2); setCursor(0); setMessage(null); }
    if (key.rightArrow) { setPage(p => (p + 1) % 2); setCursor(0); setMessage(null); }

    const list = isCorePage ? coreSkills : customSkills;
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(list.length - 1, c + 1));

    if (isCorePage) {
      if (key.return && coreSkills[cursor]) {
        setDetail(coreSkills[cursor].name);
        setDetailCursor(0);
        setMessage(null);
      }
    } else {
      if (key.return && customSkills[cursor]) {
        const result = core.editor.editValidated(customSkills[cursor].path, "skill");
        setMessage(result.success ? (result.changed ? `Edited: ${core.workspace.shortenPath(customSkills[cursor].path)}` : "No changes.") : result.error || "Failed");
      }
      if (input === "c") {
        setCreateState({ step: "scope" });
        setMessage("Create skill — scope: (g) global  (w) workspace");
      }
      if (input === "r" && customSkills[cursor]) {
        setRenaming(true);
        setRenameName("");
        setMessage(`Rename "${customSkills[cursor].name}" — enter new id:`);
      }
      if (key.delete && customSkills[cursor]) {
        setConfirmDelete(true);
        setMessage(`Delete "${customSkills[cursor].name}"? (y/n)`);
      }
    }
  });

  // ─── Core Detail View ───
  if (detail && isCorePage) {
    const skill = coreSkills.find(s => s.name === detail);
    if (!skill) { setDetail(null); return null; }
    const wsPath = `.voidrift/skills/${detail}.md`;
    const globalPath = `~/.config/voidrift/skills/${detail}.md`;
    const activeLevel = skill.overrideLevel || "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)" },
      { level: "Global", active: activeLevel === "global", path: activeLevel === "global" ? globalPath : undefined },
      { level: "Workspace", active: activeLevel === "workspace", path: activeLevel === "workspace" ? wsPath : undefined },
    ];

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Skills <Text dimColor>[core]</Text> <Text dimColor>›</Text> {detail}</Text>
        <Text dimColor>{skill.description}</Text>
        <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        <Text> </Text>
        <Text dimColor>{"Level".padEnd(17)}{"Status".padEnd(12)}{"Path"}</Text>
        <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
        {rows.map((row, idx) => (
          <Text key={row.level}>
            <Text color={idx === detailCursor ? "#4ec9b0" : undefined}>{idx === detailCursor ? "▸ " : "  "}</Text>
            <Text>{row.level.padEnd(15)}</Text>
            <Text>{(row.active ? "active" : "—").padEnd(12)}</Text>
            <Text dimColor>{row.path || ""}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Back  │  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Skills</Text>
      <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Box>
        {pages.map((p, i) => (
          <React.Fragment key={p}>
            <Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${p} ]` : `  ${p}  `}</Text>
            {i < pages.length - 1 && <Text>  </Text>}
          </React.Fragment>
        ))}
      </Box>
      <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
      <Text> </Text>
      {isCorePage ? (<>
        {coreSkills.length === 0 ? (
          <Text dimColor>No core skills registered.</Text>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Name", width: 20 },
              { key: "override", label: "Override", width: 12 },
              { key: "description", label: "Description" },
            ]}
            rows={coreSkills.map(s => ({
              name: s.name,
              override: s.overrideLevel || "default",
              description: s.description || "",
            }))}
            cursor={cursor}
          />
        )}
      </>) : (<>
        {customSkills.length === 0 ? (
          <Text dimColor>No custom skills found.</Text>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Name", width: 20 },
              { key: "location", label: "Location", width: 12 },
              { key: "description", label: "Description" },
            ]}
            rows={customSkills.map(s => ({
              name: (s.invalid ? "[X] " : "") + s.name,
              location: s.location,
              description: s.description || "",
            }))}
            cursor={cursor}
          />
        )}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/skills/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/skills/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>esc</Text> Close  │  <Text color="#61afef" bold>enter</Text> {isCorePage ? "Details" : "Open"}{!isCorePage && <>  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
    </Box>
  );
}
