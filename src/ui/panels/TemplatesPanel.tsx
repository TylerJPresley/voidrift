import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Table } from "../table.js";
import { trunc } from "./utils.js";
import { openInEditor } from "../../utils/editor.js";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { TemplateService } from "../../templates/service.js";
import type { VoidRiftConfig } from "../../config/loader.js";

export function TemplatesPanel({ templates, config, workspaceRoot, onClose }: { templates: TemplateService; config: VoidRiftConfig; workspaceRoot: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailCursor, setDetailCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ step: "scope" | "name"; scope?: "global" | "workspace" } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const pages = ["system", "custom"];

  const systemSlots = templates.slotsByType("template").filter(s => s.sourcePlugin !== "custom");
  
  // Discover custom templates from filesystem
  const customTemplates: Array<{ key: string; path: string; location: string }> = [];
  const customDirs = [
    { dir: join(process.env.HOME || "", ".config", "voidrift", "templates"), location: "global" },
    { dir: join(workspaceRoot, ".voidrift", "templates"), location: "workspace" },
  ];
  for (const { dir, location } of customDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith(".md")) {
          const key = entry.slice(0, -3);
          if (!systemSlots.find(s => s.key === key)) {
            customTemplates.push({ key, path: join(dir, entry), location });
          }
        }
      }
    } catch {}
  }

  const isCustomPage = page === 1;
  const list = isCustomPage ? customTemplates : systemSlots;

  useInput((input, key) => {
    if (createState) {
      if (key.escape) { setCreateState(null); setCreateName(""); setMessage(null); return; }
      if (createState.step === "scope") {
        if (input === "g") { setCreateState({ step: "name", scope: "global" }); setMessage("Enter template id (lower-case, hyphens only):"); }
        if (input === "w") { setCreateState({ step: "name", scope: "workspace" }); setMessage("Enter template id (lower-case, hyphens only):"); }
      } else if (createState.step === "name") {
        if (key.return && createName.length > 0) {
          const dir = createState.scope === "workspace"
            ? join(workspaceRoot, ".voidrift", "templates")
            : join(process.env.HOME || "", ".config", "voidrift", "templates");
          mkdirSync(dir, { recursive: true });
          const filePath = join(dir, `${createName}.md`);
          if (!existsSync(filePath)) {
            writeFileSync(filePath, `---\nname: "${createName}"\ndescription: ""\ntriggers:\n  extensions: []\n  files: []\n  keywords: []\n---\n\n`, "utf-8");
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
        const item = customTemplates[cursor];
        if (item) {
          const newPath = join(dirname(item.path), `${renameName}.md`);
          if (!existsSync(newPath)) {
            renameSync(item.path, newPath);
            setMessage(`Renamed: ${item.key} → ${renameName}`);
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

    if (detail) {
      if (key.escape) { setDetail(null); setDetailCursor(0); setMessage(null); return; }
      if (isCustomPage) {
        // Custom detail: just open the file
        if (key.return) {
          const item = customTemplates.find(t => t.key === detail);
          if (item && config.editor) {
            const result = openInEditor(item.path, config.editor);
            setMessage(result.success ? `Opened: ${item.path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
          }
        }
      } else {
        // System detail: override cascade
        if (key.upArrow) setDetailCursor(c => Math.max(0, c - 1));
        if (key.downArrow) setDetailCursor(c => Math.min(2, c + 1));
        if (key.return) {
          const slot = systemSlots.find(s => s.key === detail);
          if (slot) {
            if (detailCursor === 0) {
              // View default (built-in) — write to temp and open read-only
              const resolved = templates.resolveSlot(slot);
              const tmpDir = join(workspaceRoot, ".voidrift", "cache", "view");
              mkdirSync(tmpDir, { recursive: true });
              const tmpPath = join(tmpDir, `${detail.replace(/\//g, "_")}.md`);
              writeFileSync(tmpPath, resolved.content, "utf-8");
              if (config.editor) {
                const result = openInEditor(tmpPath, config.editor);
                setMessage(result.success ? `Viewing default (read-only): ${detail}` : result.error || "Failed");
              } else {
                setMessage(`Default written to: ${tmpPath.replace(workspaceRoot, ".")} (set "editor" in config)`);
              }
            } else {
              const scope = detailCursor === 1 ? "global" : "workspace";
              const path = templates.createOverrideForSlot(slot, scope as any);
              if (path && config.editor) {
                const result = openInEditor(path, config.editor);
                setMessage(result.success ? `Opened: ${path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
              } else if (path) {
                setMessage(`Created: ${path.replace(process.env.HOME || "", "~")} (set "editor" in config)`);
              }
            }
          }
        }
      }
      return;
    }

    if (key.escape) onClose();
    if (key.leftArrow) { setPage((p) => (p - 1 + 2) % 2); setCursor(0); setMessage(null); }
    if (key.rightArrow) { setPage((p) => (p + 1) % 2); setCursor(0); setMessage(null); }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(list.length - 1, c + 1));
    if (key.return && list[cursor]) {
      if (isCustomPage) {
        const item = customTemplates[cursor];
        if (item && config.editor) {
          const result = openInEditor(item.path, config.editor);
          setMessage(result.success ? `Opened: ${item.path.replace(process.env.HOME || "", "~")}` : result.error || "Failed");
        }
      } else {
        const item = list[cursor];
        setDetail("key" in item ? item.key : (item as any).key);
        setDetailCursor(0);
        setMessage(null);
      }
    }
    if (input === "c" && isCustomPage) {
      setCreateState({ step: "scope" });
      setMessage("Create template — scope: (g) global  (w) workspace");
    }
    if (input === "r" && isCustomPage && customTemplates[cursor]) {
      setRenaming(true);
      setRenameName("");
      setMessage(`Rename "${customTemplates[cursor].key}" — enter new id:`);
    }
    if (key.delete && isCustomPage && customTemplates[cursor]) {
      const item = customTemplates[cursor];
      unlinkSync(item.path);
      setMessage(`Deleted: ${item.key}`);
    }
  });

  // ─── Detail View ───
  if (detail) {
    if (isCustomPage) {
      const item = customTemplates.find(t => t.key === detail);
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
          <Text bold>Template Details: {detail}</Text>
          <Text color="#5a6aa8">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text> </Text>
          <Text dimColor>{"  "}{"File".padEnd(15)}{"Path"}</Text>
          <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
          <Text>
            <Text color="#4ec9b0">{"▸ "}</Text>
            <Text>{"Template".padEnd(15)}</Text>
            <Text dimColor>{item?.path.replace(process.env.HOME || "", "~").replace(workspaceRoot, ".") || ""}</Text>
          </Text>
          <Text> </Text>
          <Text dimColor><Text color="#61afef" bold>enter</Text> Open  <Text color="#61afef" bold>esc</Text> Back</Text>
          {message && <Text color="#4ec9b0">{message}</Text>}
        </Box>
      );
    }

    const slot = systemSlots.find(s => s.key === detail);
    const wsPath = join(workspaceRoot, ".voidrift", "templates", `${detail}.md`);
    const globalPath = join(process.env.HOME || "", ".config", "voidrift", "templates", `${detail}.md`);
    const wsExists = existsSync(wsPath);
    const globalExists = existsSync(globalPath);
    const activeLevel = wsExists ? "workspace" : globalExists ? "global" : "default";

    const rows = [
      { level: "Default", active: activeLevel === "default", path: "(built-in)", scope: "default" as const },
      { level: "Global", active: activeLevel === "global", path: globalExists ? globalPath.replace(process.env.HOME || "", "~") : undefined, scope: "global" as const },
      { level: "Workspace", active: activeLevel === "workspace", path: wsExists ? wsPath.replace(workspaceRoot, ".") : undefined, scope: "workspace" as const },
    ];

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>Template Details: {detail}</Text>
        <Text dimColor>{slot?.description}</Text>
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
        <Text dimColor><Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {detailCursor === 0 ? "View" : "Open/Create"}  <Text color="#61afef" bold>esc</Text> Back</Text>
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── List View ───
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Templates</Text>
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
      {list.length === 0 ? (
        <Text dimColor>No {pages[page]} templates registered.</Text>
      ) : (<>
        {!isCustomPage ? (
          <>
            <Table
              columns={[
                { key: "label", label: "Label", width: 20 },
                { key: "source", label: "Source", width: 15 },
                { key: "override", label: "Override", width: 15 },
                { key: "description", label: "Description" },
              ]}
              rows={systemSlots.map(slot => {
                const resolved = templates.resolveSlot(slot);
                return { label: slot.label, source: slot.sourcePlugin, override: resolved.source, description: slot.description };
              })}
              cursor={cursor}
            />
          </>
        ) : (
          <>
            <Text dimColor>{"  "}{"Name".padEnd(20)}{"Location".padEnd(15)}</Text>
            <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>
            {customTemplates.map((t, i) => (
              <Box key={t.key} flexDirection="column">
                <Text>
                  <Text color={i === cursor ? "#4ec9b0" : undefined}>{i === cursor ? "▸ " : "  "}</Text>
                  <Text bold color="#61afef">{trunc(t.key, 18, 20)}</Text>
                  <Text>{t.location.padEnd(15)}</Text>
                </Text>
                {i < customTemplates.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
                {i === customTemplates.length - 1 && <Text dimColor color="#333333">{"─".repeat((process.stdout.columns || 80) - 4)}</Text>}
              </Box>
            ))}
          </>
        )}
      </>)}
      <Text> </Text>
      <Text bold>Locations</Text>
      <Text dimColor>  Workspace:  .voidrift/templates/</Text>
      <Text dimColor>  Global:     ~/.config/voidrift/templates/</Text>
      <Text> </Text>
      <Text dimColor><Text color="#61afef" bold>←/→</Text> pages  <Text color="#61afef" bold>↑↓</Text> Navigate  <Text color="#61afef" bold>enter</Text> {isCustomPage ? "Open" : "Details"}  <Text color="#61afef" bold>esc</Text> Close{isCustomPage && <>  │  <Text color="#61afef" bold>c</Text> create  <Text color="#61afef" bold>r</Text> rename  <Text color="#61afef" bold>del</Text> delete</>}</Text>
      {message && <Text color="#4ec9b0">{message}</Text>}
      {createState?.step === "name" && <Text color="#61afef">  &gt; {createName}<Text color="#4ec9b0">█</Text></Text>}
      {renaming && <Text color="#61afef">  &gt; {renameName}<Text color="#4ec9b0">█</Text></Text>}
      <Text> </Text>
    </Box>
  );
}
