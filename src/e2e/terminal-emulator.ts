/**
 * A headless terminal emulator for replaying captured pty bytes and reading the
 * visible screen (cli-blueprint §5.2). It wraps `@xterm/headless` (MIT,
 * devDependency of the CLI only) so the resize-leftover test can assert what a
 * REAL terminal shows after the TUI reflows: the emulator rewraps the old
 * full-width frame on resize exactly as a terminal does, so a frame Ink erased
 * with too few rows leaves stale rows behind here too.
 *
 * `replayWithResize` feeds the pre-resize bytes at the start width, resizes the
 * emulator (the terminal rewraps), then feeds the post-resize bytes — mirroring
 * the pty capture's SIGWINCH. `screenLines` returns the visible buffer rows,
 * ANSI already interpreted by the emulator, trailing blanks trimmed.
 */
import { Terminal } from "@xterm/headless";

/** The raw capture a `pty-resize-capture.py` run produced. */
export interface ResizeCapture {
  ok: boolean;
  startCols: number;
  targetCols: number;
  rows: number;
  /** Byte index in `output` (latin-1) at which the resize was issued. */
  resizeIndex: number;
  /** Byte index at which the reflow-settle window ends (exit bytes excluded). */
  endIndex: number;
  /** The raw master bytes, latin-1 encoded (every byte round-trips). */
  output: string;
}

/** Write a chunk into the emulator and wait for it to parse (its write is
 * async with a callback). */
function writeAsync(term: Terminal, data: Uint8Array): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** latin-1 string (one char per byte) back to the original bytes. */
function toBytes(latin1: string): Uint8Array {
  const out = new Uint8Array(latin1.length);
  for (let i = 0; i < latin1.length; i++) out[i] = latin1.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Replay a capture into a fresh emulator: the pre-resize bytes at `startCols`,
 * then `resize(targetCols, rows)` (the terminal rewraps the old frame, exactly
 * as a real terminal does on SIGWINCH), then the post-resize bytes. Returns the
 * settled emulator.
 */
export async function replayWithResize(capture: ResizeCapture): Promise<Terminal> {
  const term = new Terminal({
    cols: capture.startCols,
    rows: capture.rows,
    // A tall scrollback so committed inline history is never lost; we read the
    // visible screen only.
    scrollback: 1000,
    allowProposedApi: true,
  });
  const bytes = toBytes(capture.output);
  const end = capture.endIndex > 0 ? capture.endIndex : bytes.length;
  const pre = bytes.subarray(0, capture.resizeIndex);
  const post = bytes.subarray(capture.resizeIndex, end);
  await writeAsync(term, pre);
  term.resize(capture.targetCols, capture.rows);
  await writeAsync(term, post);
  return term;
}

/**
 * The visible screen rows of the emulator (the viewport, not the scrollback):
 * `rows` lines starting at the active buffer's `viewportY`, each translated to
 * a plain string with trailing blanks trimmed.
 */
export function screenLines(term: Terminal): string[] {
  const buf = term.buffer.active;
  const top = buf.viewportY;
  const lines: string[] = [];
  for (let y = top; y < top + term.rows; y++) {
    const line = buf.getLine(y);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines;
}
