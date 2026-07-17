/**
 * Declarative Panel Renderer.
 *
 * Takes a PanelSchema and renders it using Ink components.
 * Handles: pages, cursor navigation, detail view, actions, footer.
 * Plugins never touch React — they describe data, this renders it.
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "./scroll-view.js";
import { Table } from "./table.js";
import type { PanelSchema, PanelLayout, PanelAction, DetailView } from "./panel-schema.js";

export function DeclarativePanel({ schema, onClose }: { schema: PanelSchema; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const cursorRef = React.useRef(0);
  cursorRef.current = cursor;
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<{ placeholder: string; resolve: (v: string | null) => void } | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [, refresh] = useState(0);

  const activePage = schema.pages?.[page];
  const termWidth = process.stdout.columns || 80;
  const termHeight = process.stdout.rows || 24;

  // Get items for list layouts
  const getListItems = useCallback(() => {
    const layout = schema.layout;
    if (layout.type !== "list") return [];
    return layout.getItems(activePage);
  }, [schema, activePage]);

  const items = schema.layout.type === "list" ? getListItems() : [];

  // Handle action execution
  const executeAction = useCallback(async (action: PanelAction, selected?: Record<string, string>) => {
    try {
      await action.handler(selected, activePage, {
        close: onClose,
        refresh: () => refresh(n => n + 1),
        setMessage,
        prompt: (placeholder: string) => new Promise<string | null>((resolve) => {
          setPromptState({ placeholder, resolve });
          setPromptValue("");
        }),
      });
      refresh(n => n + 1);
    } catch (err: any) {
      setMessage(err.message || "Action failed");
    }
  }, [activePage]);

  useInput((ch, key) => {
    // ─── Detail View Input ─────────────────────────────────────────
    if (detail && schema.detail) {
      if (key.escape) { setDetail(null); setMessage(null); return; }
      // Detail actions
      if (schema.detail.actions) {
        for (const action of schema.detail.actions) {
          if ((action.key === "enter" && key.return) ||
              (action.key === "delete" && key.delete) ||
              (action.key === ch)) {
            executeAction(action, detail);
            return;
          }
        }
      }
      return;
    }

    // ─── Main View Input ───────────────────────────────────────────
    // ─── Prompt Input ───────────────────────────────────────────────
    if (promptState) {
      if (key.escape) { promptState.resolve(null); setPromptState(null); setPromptValue(""); return; }
      if (key.return) { promptState.resolve(promptValue); setPromptState(null); setPromptValue(""); return; }
      if (key.backspace) { setPromptValue(v => v.slice(0, -1)); return; }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) { setPromptValue(v => v + ch); return; }
      return;
    }

    if (key.escape) { onClose(); return; }

    // Page navigation
    if (schema.pages?.length) {
      if (key.leftArrow) { setPage(p => (p - 1 + schema.pages!.length) % schema.pages!.length); setCursor(0); setMessage(null); return; }
      if (key.rightArrow) { setPage(p => (p + 1) % schema.pages!.length); setCursor(0); setMessage(null); return; }
    }

    // Cursor navigation (list layouts)
    if (schema.layout.type === "list" && schema.layout.cursor) {
      if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(items.length - 1, c + 1)); return; }
    }

    // Enter → open detail
    if (key.return && schema.detail) {
      const currentItems = schema.layout.type === "list" ? (schema.layout as any).getItems(activePage) : [];
      if (currentItems[cursorRef.current]) {
        setDetail(currentItems[cursorRef.current]);
        setMessage(null);
        return;
      }
    }

    // Actions
    if (schema.actions) {
      const currentItems = schema.layout.type === "list" ? (schema.layout as any).getItems(activePage) : [];
      for (const action of schema.actions) {
        if ((action.key === "enter" && key.return) ||
            (action.key === "delete" && key.delete) ||
            (action.key === ch)) {
          executeAction(action, currentItems[cursorRef.current]);
          return;
        }
      }
    }
  });

  // ─── Detail Rendering ────────────────────────────────────────────────────
  if (detail && schema.detail) {
    const detailLayout = typeof schema.detail.layout === "function"
      ? schema.detail.layout(detail)
      : schema.detail.layout;
    const detailTitle = schema.detail.getTitle(detail);

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
        <Text bold>{schema.title} <Text dimColor>›</Text> {detailTitle}</Text>
        <Text color="#5a6aa8">{"─".repeat(termWidth - 4)}</Text>
        <Text> </Text>
        <LayoutRenderer layout={detailLayout} page={activePage} height={termHeight - 10} />
        <Text> </Text>
        <FooterBar actions={schema.detail.actions} hasEscape={true} />
        {message && <Text color="#4ec9b0">{message}</Text>}
      </Box>
    );
  }

  // ─── Main Rendering ──────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>{schema.title}</Text>
      <Text color="#5a6aa8">{"─".repeat(termWidth - 4)}</Text>
      {schema.pages && (
        <>
          <Box>
            {schema.pages.map((p, i) => (
              <React.Fragment key={p}>
                <Text bold color={page === i ? "#4ec9b0" : undefined}>{page === i ? `[ ${p} ]` : `  ${p}  `}</Text>
                {i < schema.pages!.length - 1 && <Text>  </Text>}
              </React.Fragment>
            ))}
          </Box>
          <Text dimColor color="#333333">{"─".repeat(termWidth - 4)}</Text>
        </>
      )}
      <Text> </Text>
      <LayoutRenderer layout={schema.layout} page={activePage} cursor={cursor} height={termHeight - 12} />
      <Text> </Text>
      {schema.locations && (
        <>
          <Text bold>Locations</Text>
          {schema.locations.map((loc, i) => (
            <Text key={i} dimColor>  {loc.label}:  {loc.path}</Text>
          ))}
          <Text> </Text>
        </>
      )}
      <FooterBar
        actions={schema.actions}
        hasPages={!!schema.pages?.length}
        hasCursor={schema.layout.type === "list" && schema.layout.cursor}
        hasDetail={!!schema.detail}
        hasEscape={true}
        custom={schema.footer}
      />
      {promptState && <Box><Text color="#61afef">  &gt; </Text><Text>{promptValue}</Text><Text color="#4ec9b0">█</Text><Text dimColor>  {promptState.placeholder}</Text></Box>}
      {message && <Text color="#4ec9b0">{message}</Text>}
    </Box>
  );
}

// ─── Layout Renderer ─────────────────────────────────────────────────────────

function LayoutRenderer({ layout, page, cursor, height }: { layout: PanelLayout; page?: string; cursor?: number; height?: number }) {
  switch (layout.type) {
    case "list":
      return <ListRenderer layout={layout} page={page} cursor={cursor} height={height} />;
    case "text":
      return <TextRenderer layout={layout} page={page} />;
    case "keyvalue":
      return <KeyValueRenderer layout={layout} page={page} />;
    case "scroll":
      return <ScrollRenderer layout={layout} page={page} height={height} />;
  }
}

function ListRenderer({ layout, page, cursor, height }: { layout: import("./panel-schema.js").ListLayout; page?: string; cursor?: number; height?: number }) {
  const items = layout.getItems(page);
  if (items.length === 0) return <Text dimColor>No items.</Text>;

  // Limit visible rows to fit within available height (each row = 2 lines with dividers, 1 without)
  const rowHeight = layout.dividers !== false ? 2 : 1;
  const headerHeight = 2; // header + separator
  const maxRows = height ? Math.max(1, Math.floor((height - headerHeight) / rowHeight)) : items.length;

  // Scroll window follows cursor
  let scrollStart = 0;
  if (cursor !== undefined && cursor >= maxRows) {
    scrollStart = Math.min(cursor - maxRows + 1, items.length - maxRows);
  }
  scrollStart = Math.max(0, scrollStart);
  const visibleItems = items.slice(scrollStart, scrollStart + maxRows);
  // Adjust cursor to be relative to the visible slice
  const adjustedCursor = cursor !== undefined ? cursor - scrollStart : undefined;

  return (
    <Table
      columns={layout.columns.map(c => ({ key: c.key, label: c.label, width: c.width }))}
      rows={visibleItems}
      cursor={layout.cursor ? adjustedCursor : undefined}
      dividers={layout.dividers}
    />
  );
}

function TextRenderer({ layout, page }: { layout: import("./panel-schema.js").TextLayout; page?: string }) {
  const content = layout.getContent(page);
  return (
    <Box flexDirection="column">
      {content.split("\n").map((line, i) => <Text key={i}>{line || " "}</Text>)}
    </Box>
  );
}

function KeyValueRenderer({ layout, page }: { layout: import("./panel-schema.js").KeyValueLayout; page?: string }) {
  const entries = layout.getEntries(page);
  const maxLabel = Math.max(...entries.map(e => e.label.length), 8);
  return (
    <Box flexDirection="column">
      {entries.map((e, i) => (
        <Text key={i}>
          <Text color="#61afef">{(e.label + ":").padEnd(maxLabel + 2)}</Text>
          <Text color={e.color}>{e.value}</Text>
        </Text>
      ))}
    </Box>
  );
}

function ScrollRenderer({ layout, page, height }: { layout: import("./panel-schema.js").ScrollLayout; page?: string; height?: number }) {
  const rawLines = layout.getLines(page);
  const lines = rawLines.map((l, i) => <Text key={i} color={l.color}>{l.text || " "}</Text>);
  return <ScrollView height={height || 15} lines={lines} />;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function FooterBar({ actions, hasPages, hasCursor, hasDetail, hasEscape, custom }: {
  actions?: PanelAction[];
  hasPages?: boolean;
  hasCursor?: boolean;
  hasDetail?: boolean;
  hasEscape?: boolean;
  custom?: string;
}) {
  if (custom) return <Text dimColor>{custom}</Text>;

  const parts: string[] = [];
  if (hasPages) parts.push("\x1b[34m←/→\x1b[0m pages");
  if (hasCursor) parts.push("\x1b[34m↑↓\x1b[0m navigate");
  if (hasDetail) parts.push("\x1b[34menter\x1b[0m details");
  if (actions) {
    for (const a of actions) {
      if (a.key === "enter" && hasDetail) continue;
      if (a.key === "enter" && !hasDetail) { parts.push(`\x1b[34menter\x1b[0m ${a.label}`); continue; }
      if (a.key !== "enter") parts.push(`\x1b[34m${a.key}\x1b[0m ${a.label}`);
    }
  }
  if (hasEscape) parts.push("\x1b[34mesc\x1b[0m close");

  return (
    <Text dimColor>
      {hasPages && <><Text color="#61afef" bold>←/→</Text>{" pages  "}</>}
      {hasCursor && <><Text color="#61afef" bold>↑↓</Text>{" Navigate  "}</>}
      <Text color="#61afef" bold>esc</Text>{" Close"}
      {(actions?.length || hasDetail) && "  │  "}
      {hasDetail && <><Text color="#61afef" bold>enter</Text>{" Details  "}</>}
      {actions?.filter(a => !(a.key === "enter" && hasDetail)).map((a, i) => (
        <React.Fragment key={i}><Text color="#61afef" bold>{a.key}</Text>{` ${a.label}  `}</React.Fragment>
      ))}
    </Text>
  );
}
