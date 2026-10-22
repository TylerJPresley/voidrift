/**
 * Visual-line geometry for the multi-line input editor (cli-blueprint.md §3.1,
 * §3.2, §3.4). A pure module (no React, no I/O): the App wires it and InputBar
 * renders exactly the segments it computes, so navigation and rendering always
 * agree (§3.1 pin 1).
 *
 * A **visual line** is a logical line (the buffer split on `\n`) further wrapped
 * at the terminal width `columns`, preferring a whitespace break with a
 * character-wrap fallback (§3.1). Each visual line carries its `start` offset
 * into the buffer so a cursor position maps to a visual (row, col) and back.
 *
 * Width is counted in Unicode code points (via `Array.from`), so a surrogate
 * pair is one column and never split; this keeps wide/zero-width characters
 * from crashing or looping. `columns < 1` is treated as `1` (one code point per
 * visual line) so a zero/negative width never loops.
 */

/** One visual line: its text, and its start offset within the buffer. */
export interface VisualLine {
  readonly text: string;
  /** Offset of this segment's first character within the whole buffer. */
  readonly start: number;
}

/** A visual cursor position: the visual row and the code-point column in it. */
export interface VisualPos {
  readonly row: number;
  readonly col: number;
}

/** Wrap one logical line (no `\n`) into visual segments at `columns`, preferring
 * a whitespace break with a character-wrap fallback (§3.1). Returns segment
 * strings only; offsets are assigned by {@link toVisualLines}. An empty line
 * yields one empty segment so a blank line still occupies a visual row. */
export function wrapLine(line: string, columns: number): string[] {
  const width = Math.max(1, Math.floor(columns));
  const chars = Array.from(line); // code points: a surrogate pair is one unit
  if (chars.length === 0) return [""];
  const segments: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const remaining = chars.length - i;
    if (remaining <= width) {
      segments.push(chars.slice(i).join(""));
      break;
    }
    // Prefer the last whitespace at or before the width boundary; fall back to
    // a hard character break when the window holds no break point.
    let breakAt = -1;
    for (let j = i + width; j > i; j--) {
      if (/\s/.test(chars[j - 1] ?? "")) {
        breakAt = j;
        break;
      }
    }
    if (breakAt <= i) breakAt = i + width; // character-wrap fallback
    segments.push(chars.slice(i, breakAt).join(""));
    i = breakAt;
  }
  return segments;
}

/** Split the buffer into visual lines: logical lines (split on `\n`) each
 * wrapped at `columns`. Every segment carries its `start` offset into the
 * buffer. A trailing `\n` yields a final empty visual line (the cursor can sit
 * on the blank row after it). */
export function toVisualLines(value: string, columns: number): VisualLine[] {
  const out: VisualLine[] = [];
  let offset = 0;
  const logical = value.split("\n");
  for (let li = 0; li < logical.length; li++) {
    const line = logical[li] ?? "";
    const segs = wrapLine(line, columns);
    let segStart = offset;
    for (const seg of segs) {
      out.push({ text: seg, start: segStart });
      segStart += Array.from(seg).length;
    }
    // Advance past this logical line and the `\n` that followed it (if any).
    offset += Array.from(line).length;
    if (li < logical.length - 1) offset += 1; // the `\n`
  }
  return out;
}

/** The number of code points in a visual line's text. */
function lineLen(text: string): number {
  return Array.from(text).length;
}

/** Map a buffer cursor (a code-point offset) to a visual (row, col). The cursor
 * belongs to the LAST visual line whose `start <= cursor`, except when it sits
 * exactly at a wrap boundary that is not a logical-line break: there it belongs
 * to the start of the next segment (so Down from the row above lands correctly).
 */
export function cursorToVisual(lines: VisualLine[], cursor: number): VisualPos {
  for (let row = lines.length - 1; row >= 0; row--) {
    const line = lines[row]!;
    const end = line.start + lineLen(line.text);
    // The cursor sits on this row when it is within [start, end]; the row that
    // ENDS at the cursor also owns it (end-of-buffer / end-of-line).
    if (cursor >= line.start && cursor <= end) {
      return { row, col: cursor - line.start };
    }
  }
  return { row: 0, col: 0 };
}

/** Clamp a visual column to a row's length. */
function clampCol(lines: VisualLine[], row: number, col: number): number {
  const line = lines[row]!;
  return Math.min(col, lineLen(line.text));
}

/** The result of a vertical (Up/Down) move over visual lines. */
export interface VerticalMove {
  /** The new buffer cursor (a code-point offset). */
  readonly cursor: number;
  /** The goal column to preserve across consecutive vertical moves. */
  readonly goalCol: number;
}

/**
 * Move the cursor one visual line up or down, preserving the goal column
 * (§3.2/§3.4 pin 2). Returns the new cursor and goal column, or `null` when the
 * move falls off the edge — Up on the first visual line, Down on the last — so
 * the caller lets the key fall through to the index axis (§3.2 pin 3).
 *
 * `goalCol` is the column the cursor "wants"; pass the current visual column on
 * the first vertical move and the returned `goalCol` on subsequent ones. The
 * landing column is `min(goalCol, targetLineLen)`; the goal column itself is
 * preserved (not clamped) so walking through a short line keeps the intent.
 */
export function verticalMove(
  value: string,
  cursor: number,
  columns: number,
  dir: "up" | "down",
  goalCol: number | null,
): VerticalMove | null {
  const lines = toVisualLines(value, columns);
  const pos = cursorToVisual(lines, cursor);
  const targetRow = dir === "up" ? pos.row - 1 : pos.row + 1;
  if (targetRow < 0 || targetRow >= lines.length) return null; // fall through
  const goal = goalCol ?? pos.col;
  const col = clampCol(lines, targetRow, goal);
  // The cursor offset is the target line's start plus the (code-point) column.
  const line = lines[targetRow]!;
  const prefix = Array.from(line.text).slice(0, col).join("");
  const newCursor = line.start + Array.from(prefix).length;
  return { cursor: newCursor, goalCol: goal };
}

/** Whether the buffer spans more than one visual line at `columns` (a newline
 * or a wrap). Single-line buffers keep today's index-axis behaviour (§3.2). */
export function isMultiVisual(value: string, columns: number): boolean {
  return toVisualLines(value, columns).length > 1;
}
