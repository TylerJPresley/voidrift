/**
 * Reusable Table component for TUI panels.
 *
 * Handles column sizing, truncation with ellipsis, cursor selection,
 * row dividers, and header rendering. Panels declare data, Table renders it.
 */
import React from "react";
import { Box, Text } from "ink";

export interface TableColumn {
  key: string;
  label: string;
  width?: number;  // fixed width including 1 char right padding. Omit for last column (fills remainder).
}

export interface TableRow {
  [key: string]: string | undefined;
  _prefix?: string;      // icon/status before first column (e.g. "✓ " or "🔒")
  _prefixColor?: string; // color for the prefix
}

export interface TableProps {
  columns: TableColumn[];
  rows: TableRow[];
  cursor?: number;
  dividers?: boolean;
  nameColor?: string;    // color for first column content
  nameBold?: boolean;    // bold first column
}

/** Format a cell: truncate + ellipsis if over width, pad to width (includes 1 char padding). */
function formatCell(content: string, width: number): string {
  const max = width - 1;
  if (content.length > max) return content.slice(0, max - 1) + "…" + " ";
  return content.padEnd(width);
}

export function Table({ columns, rows, cursor, dividers = true, nameColor = "#61afef", nameBold = true }: TableProps) {
  const termWidth = process.stdout.columns || 80;
  const cursorWidth = 2;
  const prefixWidth = rows.reduce((max, r) => Math.max(max, (r._prefix || "").length), 0);
  const headerIndent = cursorWidth + prefixWidth;

  // Calculate last column's available width
  const fixedWidth = headerIndent + columns.slice(0, -1).reduce((sum, c) => sum + (c.width || 0), 0);
  const lastColWidth = Math.max(10, termWidth - fixedWidth - 4); // 4 for panel border + paddingX

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text dimColor>
        {" ".repeat(headerIndent)}{columns.map((col, i) => {
          const isLast = i === columns.length - 1;
          return isLast ? col.label : formatCell(col.label, col.width!);
        }).join("")}
      </Text>
      <Text dimColor color="#333333">{"─".repeat(termWidth - 4)}</Text>

      {/* Rows */}
      {rows.map((row, i) => {
        const isSelected = cursor === i;
        return (
          <Box key={i} flexDirection="column">
            <Text>
              <Text color={isSelected ? "#4ec9b0" : undefined}>{isSelected ? "▸ " : "  "}</Text>
              {prefixWidth > 0 && <Text color={row._prefixColor}>{(row._prefix || "").padEnd(prefixWidth)}</Text>}
              {columns.map((col, ci) => {
                const value = row[col.key] || "";
                const isLast = ci === columns.length - 1;
                const isFirst = ci === 0;
                const w = isLast ? lastColWidth : col.width!;
                const formatted = isLast
                  ? (value.length > w ? value.slice(0, w - 1) + "…" : value)
                  : formatCell(value, w);

                if (isFirst) {
                  return <Text key={col.key} bold={nameBold} color={isSelected ? "#4ec9b0" : nameColor}>{formatted}</Text>;
                }
                if (isLast) {
                  return <Text key={col.key} dimColor>{formatted}</Text>;
                }
                return <Text key={col.key}>{formatted}</Text>;
              })}
            </Text>
            {dividers && i < rows.length - 1 && <Text dimColor color="#333333">{"─".repeat(termWidth - 4)}</Text>}
          </Box>
        );
      })}
      {dividers && <Text dimColor color="#333333">{"─".repeat(termWidth - 4)}</Text>}
    </Box>
  );
}
