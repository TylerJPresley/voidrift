/**
 * Autocomplete engine (cli-blueprint.md §3.3).
 *
 * Pure matching over two domains chosen by the buffer: slash commands when the
 * buffer begins with `/` (case-insensitive prefix against `session.listCommands`),
 * else file paths matched against the last whitespace word (prefix first, then
 * substring against the full path or basename, from `workspace.files`). Slash
 * results are NOT capped and window in an 8-row view; file results cap at 10 and
 * window in a 5-row view; each window scrolls with the cursor (§3.3).
 */

import { mergeCommands } from "../commands-catalog.js";

export interface Candidate {
  /** The value inserted on selection. */
  value: string;
  /** The display label (e.g. `/help`). */
  label: string;
  /** An optional description (slash commands show theirs). */
  description?: string;
}

export const MAX_RESULTS = 10;
/** The file dropdown window (5 rows, §3.3). */
export const WINDOW = 5;
/** The slash-command dropdown window (8 rows, §3.3). */
export const COMMAND_WINDOW = 8;

/** Compute slash-command candidates from the buffer and command list (§3.3).
 * The CLI's built-in commands (§7.3) are merged with the plugin command names
 * from `session.listCommands()` so completion lists both with descriptions. */
export function completeCommands(buffer: string, commands: readonly string[]): Candidate[] {
  const q = buffer.replace(/^\//, "").toLowerCase();
  return mergeCommands(commands)
    .filter((c) => c.name.toLowerCase().startsWith(q))
    .map((c) => ({
      value: `/${c.name}`,
      label: `/${c.name}`,
      ...(c.description ? { description: c.description } : {}),
    }));
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** The last whitespace-separated word of the buffer (the file-match target). */
export function lastWord(buffer: string): string {
  const parts = buffer.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/** Compute file-path candidates against the last word (prefix then substring). */
export function completeFiles(buffer: string, files: readonly string[]): Candidate[] {
  const word = lastWord(buffer);
  if (word === "") return [];
  const lower = word.toLowerCase();
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const f of files) {
    const fl = f.toLowerCase();
    if (fl.startsWith(lower) || basename(fl).startsWith(lower)) prefix.push(f);
    else if (fl.includes(lower) || basename(fl).includes(lower)) contains.push(f);
  }
  const ordered = [...prefix, ...contains].slice(0, MAX_RESULTS);
  return ordered.map((f) => ({ value: f, label: f }));
}

/**
 * Compute the visible window and whether more exist, scrolling the window so the
 * cursor stays visible past the last visible row (§3.3). `size` is the window
 * height — 8 for slash commands, 5 for files (default `WINDOW`, the file size).
 */
export function windowFor(
  candidates: Candidate[],
  cursor: number,
  size: number = WINDOW,
): { visible: Candidate[]; offset: number; more: number } {
  if (candidates.length <= size) {
    return { visible: candidates, offset: 0, more: 0 };
  }
  let offset = 0;
  if (cursor >= size) offset = cursor - size + 1;
  if (offset > candidates.length - size) offset = candidates.length - size;
  const visible = candidates.slice(offset, offset + size);
  const more = candidates.length - (offset + size);
  return { visible, offset, more: Math.max(0, more) };
}
