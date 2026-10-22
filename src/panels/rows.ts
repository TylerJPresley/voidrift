/**
 * Pure row helpers for the generic panel renderer (cli-blueprint.md §7.1,
 * panels-blueprint §2, §6). No React, no I/O: a dotted-path field resolver, the
 * four fixed cell formats (`text`/`relative-time`/`bytes`/`count`, §12.6), and
 * the in-memory `/` substring filter. The renderer owns each formatter; the
 * stored row value is never changed (§12.6).
 */
import type { PanelFormat } from "@voidrift/core";

export type Row = Record<string, unknown>;

/**
 * Resolve a column `key` against a row. A dotted key reads a nested field
 * (`a.b.c`); a plain key reads one property. An absent path is `undefined`
 * (rendered as an empty cell), never a throw (§7.1, §12.6).
 */
export function resolvePath(row: unknown, key: string): unknown {
  if (row === null || row === undefined) return undefined;
  if (!key.includes(".")) return (row as Row)[key];
  let node: unknown = row;
  for (const seg of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Row)[seg];
  }
  return node;
}

/** Format an ISO/epoch value as a compact relative age (`5m`/`3h`/`2d`, §12.6). */
function relativeTime(value: unknown, now: number): string {
  if (value === null || value === undefined || value === "") return "";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(ms)) return String(value);
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

/** Format a byte count as `1.2 MiB` / `512 B` (§12.6). */
function bytes(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = n;
  let u = 0;
  while (size >= 1024 && u < units.length - 1) {
    size /= 1024;
    u++;
  }
  return u === 0 ? `${size} B` : `${size.toFixed(1)} ${units[u]}`;
}

/** Format an integer with grouping separators (`1,234`, §12.6). */
function count(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return Math.trunc(n).toLocaleString("en-US");
}

/**
 * Render a cell value by its `format`. An unknown or absent format renders as
 * `text` (§6). `now` is injectable so a test is deterministic.
 */
export function formatCell(value: unknown, format: PanelFormat | undefined, now: number = Date.now()): string {
  switch (format) {
    case "relative-time":
      return relativeTime(value, now);
    case "bytes":
      return bytes(value);
    case "count":
      return count(value);
    case "text":
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

/**
 * Filter rows by a `/` query: a case-insensitive substring match over the
 * displayed text of the given columns (§7.1, §5). An empty query keeps every
 * row. Matching uses the raw cell text (dotted key resolved), not the format,
 * so a filter finds what the user reads.
 */
export function filterRows(rows: Row[], columns: { key: string }[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows;
  return rows.filter((row) =>
    columns.some((c) => {
      const v = resolvePath(row, c.key);
      return v !== undefined && v !== null && String(v).toLowerCase().includes(q);
    }),
  );
}
