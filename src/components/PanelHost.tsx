import React from "react";
import { Box, Text, useInput } from "ink";
import type { BoundPanel, BoundPanelAction, BoundPanelColumn, BoundPanelRegistry } from "../panels/types.js";
import type { Row } from "../panels/rows.js";
import { filterRows, formatCell, resolvePath } from "../panels/rows.js";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { sanitize, displayWidth, cutToWidth } from "../render/theme.js";

/** Render one cell: resolve the dotted key, apply the format, sanitize, then fit
 * the fixed width with a `…` truncation (§7.1, §6). */
function cell(row: Row, col: BoundPanelColumn, now: number): string {
  const text = sanitize(formatCell(resolvePath(row, col.key), col.format, now));
  const width = col.width;
  if (width === undefined) return text;
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text.padEnd(width);
}

/** The effective columns/actions/rows for the active page (or the panel). */
function activeView(panel: BoundPanel, pageIndex: number): {
  columns: BoundPanelColumn[];
  actions: Record<string, BoundPanelAction> | undefined;
  rows: Row[];
} {
  const page = panel.pages?.[pageIndex];
  if (page) {
    return {
      columns: page.columns ?? panel.columns,
      actions: page.actions ?? panel.actions,
      rows: page.getItems(),
    };
  }
  return { columns: panel.columns, actions: panel.actions, rows: panel.getItems() };
}

type Mode = { kind: "list" } | { kind: "filter" } | { kind: "detail" } | { kind: "confirm"; hotkey: string };

/**
 * The panel host (§7.1): ONE generic renderer of a registered `BoundPanel`,
 * with NO per-panel code. It builds every panel from the declaration — title,
 * optional description, tab pages, the data table (fixed widths, per-cell
 * format, `…` truncation), a `row C of N` indicator, the footer, and a notice
 * region — and renders `detail` and `confirm` the same generic way.
 *
 * A row carries a cursor only when the active page/panel declares `actions` or
 * `detail`; otherwise arrows only scroll and no `▸` marker shows (§6). `/`
 * filters in memory; `←→` switch pages; an action with `confirm` prompts `y/n`
 * in the notice area and runs its op only on `y`. `Escape` unwinds ONE level:
 * confirm/prompt → detail → filter → list → closed (§3.6, §7.1). An unknown
 * name or a failing source renders an inline notice, never a crash.
 */
export function PanelHost({
  name,
  registry,
  onClose,
  theme,
  glyphs,
  columns: termColumns,
  rows: termRows,
}: {
  name: string;
  registry: BoundPanelRegistry;
  onClose: () => void;
  theme: ThemeTokens;
  glyphs: Glyphs;
  columns?: number;
  rows?: number;
}): React.ReactElement {
  const definition: BoundPanel | undefined = registry[name];
  const [pageIndex, setPageIndex] = React.useState(0);
  const [selected, setSelected] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>({ kind: "list" });
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const now = Date.now();
  let view: { columns: BoundPanelColumn[]; actions: Record<string, BoundPanelAction> | undefined; rows: Row[] } | null = null;
  let failed = false;
  try {
    view = definition ? activeView(definition, pageIndex) : null;
  } catch {
    failed = true;
  }

  const selectable = Boolean(view && (view.actions || definition?.detail));
  const allRows = view?.rows ?? [];
  const rows = view ? filterRows(allRows, view.columns, query) : [];
  const cursor = Math.min(selected, Math.max(0, rows.length - 1));
  const selectedRow = selectable ? rows[cursor] : undefined;

  // Reset the cursor and clear the notice on a page switch (pin 8).
  const switchPage = (delta: number): void => {
    const count = definition?.pages?.length ?? 0;
    if (count === 0) return;
    setPageIndex((p) => (p + delta + count) % count);
    setSelected(0);
    setNotice(null);
    setQuery("");
  };

  const runAction = (action: BoundPanelAction): void => {
    const row = selectedRow;
    if (row === undefined) return;
    void Promise.resolve(action.handler?.(row))
      .then(() => setNotice({ text: `${action.label} done`, tone: "ok" }))
      .catch((e) => setNotice({ text: `${action.label} failed: ${e instanceof Error ? e.message : String(e)}`, tone: "error" }));
  };

  useInput((input, key) => {
    // The notice clears on the next key (§7.1).
    if (notice) setNotice(null);

    // Confirm prompt: y runs the op, any other key / Escape cancels (§7.1, pin 6).
    if (mode.kind === "confirm") {
      const action = view?.actions?.[mode.hotkey];
      setMode({ kind: "list" });
      if ((input === "y" || input === "Y") && action) runAction(action);
      return;
    }

    if (key.escape) {
      // Unwind ONE level (§3.6): detail → list; filter → list; else close.
      if (mode.kind === "detail" || mode.kind === "filter") return setMode({ kind: "list" });
      return onClose();
    }

    if (mode.kind === "detail") return; // only Escape leaves a detail view.

    if (mode.kind === "filter") {
      if (key.return) return setMode({ kind: "list" });
      if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
      if (input && !key.ctrl && !key.meta) return setQuery((q) => q + input);
      return;
    }

    // List mode.
    if (!definition || failed || !view) return;
    if (input === "/") return setMode({ kind: "filter" });
    if (key.leftArrow) return switchPage(-1);
    if (key.rightArrow) return switchPage(1);
    if (key.upArrow) return setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSelected((s) => Math.min(Math.max(0, rows.length - 1), s + 1));
    if (key.pageUp) return setSelected((s) => Math.max(0, s - 10));
    if (key.pageDown) return setSelected((s) => Math.min(Math.max(0, rows.length - 1), s + 10));
    if (key.return && definition.detail && selectedRow !== undefined) return setMode({ kind: "detail" });
    // A keyed action: confirm first if declared, else run now (§7.1, pin 6).
    if (input && view.actions && view.actions[input]) {
      if (selectedRow === undefined) return;
      const action = view.actions[input]!;
      if (action.confirm !== undefined) return setMode({ kind: "confirm", hotkey: input });
      return runAction(action);
    }
  });

  const border = theme.border;
  const accent = theme.accent;
  const dim = theme.dim;
  const errorColor = theme.error;
  // The frame is drawn at exactly the terminal width so its right border is
  // always on screen; the inner content area of a round border with paddingX:1
  // is `columns - 2 (borders) - 2 (padding)`. Every rendered line is then
  // `<= columns` and ends with a border glyph (owner feedback 1 & 3).
  const frameWidth = termColumns;
  const innerWidth = Math.max(1, (termColumns ?? 80) - 4);
  const boxProps = {
    flexDirection: "column" as const,
    borderStyle: "round" as const,
    paddingX: 1 as const,
    ...(frameWidth ? { width: frameWidth } : {}),
    ...(border ? { borderColor: border } : {}),
  };

  if (!definition) {
    return (
      <Box {...boxProps}>
        <Text {...(errorColor ? { color: errorColor } : {})}>Unknown panel: {sanitize(name)}</Text>
      </Box>
    );
  }
  if (failed || !view) {
    return (
      <Box {...boxProps}>
        <Text {...(errorColor ? { color: errorColor } : {})}>Error loading panel data</Text>
      </Box>
    );
  }

  const marker = glyphs.caretRight; // ▸ / > — the selected-row marker (§7.1).
  // A separator spans the FULL inner frame width, edge to edge inside the
  // border, at any terminal width (owner feedback 1). The inner dividers use
  // the dim token (a dim grey), not the border token — the outer frame keeps
  // the border colour. Under NO_COLOR both tokens are undefined, so nothing
  // changes (glyphs only).
  const sep = (key?: string): React.ReactElement => (
    <Text key={key} {...(dim ? { color: dim } : {})}>
      {"─".repeat(innerWidth)}
    </Text>
  );
  // One blank row — the single unit of spacing between regions (owner feedback
  // 2). Ink collapses an empty-string Text to zero height, so a single space
  // is used to force a rendered blank line inside the frame.
  const gap = (key?: string): React.ReactElement => <Text key={key}>{" "}</Text>;
  // Cut an already-sanitized line to the inner width with a `…` so a long cell
  // never wraps or widens the frame (owner feedback 3). Only cuts when needed.
  const fit = (line: string): string => {
    if (displayWidth(line) <= innerWidth) return line;
    const [head] = cutToWidth(line, Math.max(0, innerWidth - 1));
    return head + "…";
  };

  // The detail view: the selected row's own fields, built from the declaration
  // alone — no extra op (§7.1, §12.6). Layout (owner correction): title row,
  // full-width separator, ONE blank (content padding above), key/value rows,
  // ONE blank (content padding below), full-width separator, footer — the
  // title and footer touch no padding; every line is cut to the inner width so
  // none widens the frame (owner feedback 3).
  if (mode.kind === "detail" && selectedRow !== undefined) {
    return (
      <Box {...boxProps}>
        <Text {...(accent ? { color: accent } : {})}>{fit(sanitize(definition.detail?.title ?? definition.title))}</Text>
        {sep("ds0")}
        {gap("dg1")}
        {view.columns.map((c) => (
          <Text key={c.key} {...(dim ? { color: dim } : {})}>
            {fit(sanitize(c.label) + ": " + sanitize(formatCell(resolvePath(selectedRow, c.key), c.format, now)))}
          </Text>
        ))}
        {gap("dg2")}
        {sep("ds1")}
        <Text {...(dim ? { color: dim } : {})}>{fit("esc back")}</Text>
      </Box>
    );
  }

  // Cap the visible table at half the terminal height (§7.1) — a window of rows
  // with a `row C of N` indicator when it overflows. Computed before the footer
  // so the collapse test can account for the indicator sharing the footer row.
  const maxTableRows = Math.max(3, Math.floor((termRows ?? 24) / 2) - 8);
  const overflow = rows.length > maxTableRows;
  const start = overflow ? Math.min(Math.max(0, cursor - Math.floor(maxTableRows / 2)), Math.max(0, rows.length - maxTableRows)) : 0;
  const windowRows = rows.slice(start, start + maxTableRows);

  // The footer: navigation on the left, keyed actions after it, and a right-
  // aligned `row C of N` indicator on the SAME row. Collapse navigation to
  // `? keys` when nav + actions + indicator would not fit the inner width
  // (pin 4).
  const navParts: string[] = [];
  if (selectable) navParts.push("↑↓ move");
  if ((definition.pages?.length ?? 0) > 1) navParts.push("←→ tab");
  if (definition.detail) navParts.push("↵ open");
  navParts.push("esc close");
  navParts.push("/ filter");
  const nav = navParts.join("  ");
  const actionsText = view.actions
    ? Object.entries(view.actions)
        .map(([k, a]) => `${k} ${a.label}`)
        .join("  ")
    : "";
  const indicatorWidth = overflow ? `row ${cursor + 1} of ${rows.length}`.length + 2 : 0;
  const collapse = nav.length + actionsText.length + 3 + indicatorWidth > innerWidth;
  const navText = collapse ? "? keys" : nav;

  const header = fit((selectable ? "  " : "") + view.columns.map((c) => cell({ [c.key]: c.label } as Row, c, now)).join("  "));

  // Build the layout blocks (owner correction): the HEADER (title, optional
  // description, optional tab row) touches the top border with no padding; the
  // TABLE is the only padded region (one blank above and below); the FOOTER and
  // the optional NOTICE touch no padding. Full-width separators sit between the
  // header and the table's top padding, and between the table's bottom padding
  // and the footer. Every line is pre-fitted to the inner width so none widens
  // the frame (owner feedback 3).
  const headerRows: React.ReactElement[] = [];

  // Header: title (+ optional description).
  headerRows.push(
    <Text key="title" {...(accent ? { color: accent } : {})}>{fit(sanitize(definition.title))}</Text>,
  );
  if (definition.description) {
    headerRows.push(<Text key="desc" {...(dim ? { color: dim } : {})}>{fit(sanitize(definition.description))}</Text>);
  }

  // Header: tab row (only for a tabbed panel) — still part of the header, no
  // padding.
  if (definition.pages && definition.pages.length > 0) {
    headerRows.push(
      <Text key="tabs">
        {definition.pages.map((p, i) => (
          <Text key={p.key} {...(i === pageIndex ? (accent ? { color: accent, bold: true } : { bold: true }) : dim ? { color: dim } : {})}>
            {i === pageIndex ? `[${sanitize(p.label)}]` : ` ${sanitize(p.label)} `}
            {i < definition.pages!.length - 1 ? "  " : ""}
          </Text>
        ))}
      </Text>,
    );
  }

  // The table (header + windowed rows). On the selected row, ONLY the first
  // column is bold accent (the rest render plain); every data line is still
  // pre-fitted so it never overflows the frame (§7.1 marker + spec). This is
  // the one padded region (owner correction).
  const tableBlock: React.ReactElement[] = [
    <Text key="header" {...(dim ? { color: dim } : {})}>{header}</Text>,
  ];
  if (rows.length === 0) {
    tableBlock.push(<Text key="empty" {...(dim ? { color: dim } : {})}>(nothing to show)</Text>);
  } else {
    for (let i = 0; i < windowRows.length; i++) {
      const row = windowRows[i]!;
      const abs = start + i;
      const isCursor = selectable && abs === cursor;
      const rendered = view.columns.map((c) => cell(row, c, now));
      // Fit the whole data line (marker column + joined cells) to the inner
      // width, then split the fitted line back into the first column and the
      // remainder so the selected row can bold only its first column.
      const prefix = selectable ? (isCursor ? `${marker} ` : "  ") : "";
      const joined = fit(prefix + rendered.join("  "));
      const firstLen = (rendered[0] ?? "").length;
      const headEnd = Math.min(joined.length, prefix.length + firstLen);
      const firstCol = joined.slice(prefix.length, headEnd);
      const restCols = joined.slice(headEnd);
      tableBlock.push(
        <Text key={abs}>
          {selectable ? <Text {...(accent ? { color: accent } : {})}>{joined.slice(0, prefix.length)}</Text> : null}
          <Text {...(isCursor ? (accent ? { color: accent, bold: true } : { bold: true }) : {})}>{firstCol}</Text>
          <Text>{restCols}</Text>
        </Text>,
      );
    }
  }

  // The footer — nav (left) then keyed actions, with the `row C of N` indicator
  // right-aligned on the SAME row (only when the table overflows). The footer
  // collapses nav to `? keys` when nav + actions + indicator would not fit
  // (pin 4). No padding around the footer (owner correction).
  const indicator = overflow ? `row ${cursor + 1} of ${rows.length}` : "";
  const footerRow = (
    <Box key="footer" justifyContent="space-between">
      <Text>
        <Text {...(dim ? { color: dim } : {})}>{mode.kind === "filter" ? `/ ${sanitize(query)}▊` : navText}</Text>
        {actionsText
          ? view.actions
            ? Object.entries(view.actions).map(([k, a], i) => (
                <Text key={k}>
                  {i === 0 ? "  " : "  "}
                  <Text {...(accent ? { color: accent } : {})}>{k}</Text>
                  <Text {...(dim ? { color: dim } : {})}> {sanitize(a.label)}</Text>
                </Text>
              ))
            : null
          : null}
      </Text>
      {indicator ? <Text {...(dim ? { color: dim } : {})}>{indicator}</Text> : <Text> </Text>}
    </Box>
  );

  // The optional notice/confirm row — a full-width separator then the row, with
  // NO extra padding (owner correction). Present only while a confirm prompt or
  // a notice exists.
  let noticeRow: React.ReactElement | null = null;
  if (mode.kind === "confirm") {
    noticeRow = (
      <Text key="confirm" {...(accent ? { color: accent } : {})}>
        {fit(sanitize(confirmPrompt(view.actions?.[mode.hotkey])) + "  y / n")}
      </Text>
    );
  } else if (notice) {
    noticeRow = (
      <Text key="notice" {...(notice.tone === "error" ? (errorColor ? { color: errorColor } : {}) : accent ? { color: accent } : {})}>
        {fit(sanitize(notice.text))}
      </Text>
    );
  }

  // Assemble (owner correction): header (no padding) · ├sep┤ · blank · table ·
  // blank · ├sep┤ · footer · [├sep┤ · notice]. The table is the only region
  // with content padding (one blank above and below); the header touches the
  // top border and the footer/notice touch the bottom with no blank beside
  // them.
  const children: React.ReactElement[] = [
    ...headerRows,
    sep("s-top"),
    gap("ga-table"),
    ...tableBlock,
    gap("gb-table"),
    sep("s-footer"),
    footerRow,
  ];
  if (noticeRow) {
    children.push(sep("s-notice"), noticeRow);
  }

  return <Box {...boxProps}>{children}</Box>;
}

/** The confirm prompt text: the action's `confirm` string, or a default. */
function confirmPrompt(action: BoundPanelAction | undefined): string {
  if (!action) return "Confirm?";
  if (typeof action.confirm === "string") return action.confirm;
  return `${action.label}?`;
}
