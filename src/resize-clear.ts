/**
 * Width-decrease frame clear (cli-blueprint.md §5.2).
 *
 * The CLI renders INLINE on the primary screen (no alternate screen). Ink 8's
 * `resized()` clears the live region with `log.clear()`, which erases
 * `previousLineCount` LOGICAL lines. On a width DECREASE the terminal has
 * already rewrapped the previous full-width frame (dim rules, the status line)
 * into MORE physical rows than there are logical lines, so Ink erases too few
 * rows and the top of the old frame is left behind — the user sees several
 * stale `⠠ Thinking · N s` spinner lines and duplicate rules.
 *
 * The fix stays entirely in the CLI (no fork, no Ink patch, no alternate
 * screen): a `resize` listener registered on the SAME stdout BEFORE Ink's own
 * (Node fires listeners in registration order) computes the physical rows the
 * LAST frame now occupies at the NEW width — the sum over the frame's logical
 * lines of `ceil(displayWidth(line) / newWidth)` — erases exactly that region,
 * then resets Ink's log bookkeeping so its following repaint draws a fresh frame
 * from the top with no residual rows. A width INCREASE or a height-only change
 * is left untouched (Ink repaints correctly there), so scrollback is never
 * disturbed.
 *
 * The last frame is sniffed from Ink's own writes: Ink's non-incremental
 * renderer writes the WHOLE frame text on every render, so the last write that
 * carries printable content is the current frame. Only the printable rows are
 * kept (escape prefixes/suffixes stripped) to measure the wrap.
 */
import { displayWidth } from "./render/theme.js";

const ESC = "\u001b";
// A CSI/escape matcher for stripping control sequences when measuring a row.
const ANSI_RE = /\u001b\[[0-9;?]*[a-zA-Z]|\u001b[()][AB012]|\u001b[=><]/g;

/** The writable side we observe and write erase sequences to. */
export interface ResizeStdout {
  write(data: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
  columns?: number | undefined;
  rows?: number | undefined;
}

/** The frame text Ink last wrote, split into logical lines (ANSI stripped for
 * measurement only). Extract the printable payload from a single Ink write:
 * strip a leading run of control sequences (the return-prefix + eraseLines) and
 * a trailing cursor move, keep the rest verbatim so each `\n` is a logical line.
 */
function framePayload(write: string): string | null {
  // Strip a leading run of escape sequences (cursor moves + eraseLines) that
  // Ink emits before the frame text; keep from the first printable byte.
  let i = 0;
  while (i < write.length) {
    if (write[i] === ESC) {
      // Skip one CSI/escape sequence.
      const rest = write.slice(i);
      const m = rest.match(/^\u001b\[[0-9;?]*[a-zA-Z]|^\u001b[()][AB012]|^\u001b[=><]/);
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    break;
  }
  const payload = write.slice(i);
  // A write with no printable content at all (a pure cursor/erase sequence) is
  // not a frame — ignore it so the tracked frame is the last REAL paint.
  const printable = payload.replace(ANSI_RE, "");
  if (printable.replace(/[\r\n]/g, "").trim() === "") return null;
  return payload;
}

/**
 * Observe Ink's writes on `stdout` to keep the last painted frame, and install a
 * `resize` handler (registered BEFORE Ink's by calling `install()` before
 * `render()`) that, on a width DECREASE, erases ONLY the extra physical rows the
 * rewrapped previous frame now occupies ABOVE the region Ink itself will erase.
 * Returns a disposer that removes the handler and restores `stdout.write`.
 *
 * Ink's `resized()` runs AFTER this handler (registration order) and erases
 * `previousLineCount` physical rows from the bottom of the frame — correct for
 * the rows it painted, but short by the rewrap excess at the top. This handler
 * erases exactly that excess and PRESERVES the cursor (save/restore) so Ink's
 * own erase + repaint is undisturbed and the frame is not double-cleared.
 */
export function installResizeClear(stdout: ResizeStdout, resetInk: () => void): () => void {
  let lastFrame = "";
  let lastColumns = stdout.columns ?? 80;

  const originalWrite = stdout.write.bind(stdout);
  const sniffingWrite = (data: string): unknown => {
    if (typeof data === "string") {
      const payload = framePayload(data);
      if (payload !== null) lastFrame = payload;
    }
    return originalWrite(data);
  };
  (stdout as { write: (d: string) => unknown }).write = sniffingWrite;

  // A stdout without a usable `resize` emitter (a non-TTY or a test fake) gets
  // only the sniffing write wrapper; there is no resize to clear for. Return a
  // disposer that restores `write`.
  if (typeof stdout.on !== "function") {
    return () => {
      (stdout as { write: (d: string) => unknown }).write = originalWrite;
    };
  }

  const onResize = (): void => {
    const newColumns = stdout.columns ?? lastColumns;
    const oldColumns = lastColumns;
    const decreased = newColumns < oldColumns;
    lastColumns = newColumns;
    if (!decreased || newColumns <= 0 || lastFrame === "") return;

    // The frame's logical rows (drop the trailing empty element of a trailing
    // newline). Each row wrapped to one physical row at the OLD width and now
    // wraps to `ceil(displayWidth(row)/newColumns)` physical rows at the new
    // width; a blank row is one physical row either way.
    const rows = lastFrame.split("\n");
    if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    const logical = rows.length;
    let physical = 0;
    for (const row of rows) {
      const w = displayWidth(row.replace(ANSI_RE, ""));
      physical += w <= 0 ? 1 : Math.ceil(w / newColumns);
    }
    // Ink will erase `logical` physical rows from the bottom; only the rewrap
    // EXCESS above that region leaks. Nothing to do when nothing rewrapped.
    const excess = physical - logical;
    if (excess <= 0) return;

    // The cursor sits at the bottom physical row of the rewrapped frame. Erase
    // the FULL physical extent going up (every row of the rewrapped old frame,
    // including the stale top rows Ink's logical-line erase leaves behind),
    // ending with the cursor at column 0 of the top row. Then reset Ink's log so
    // its following repaint draws the whole frame from this cleared top.
    let seq = "";
    for (let r = 0; r < physical; r++) {
      seq += `${ESC}[2K`; // erase current row
      if (r < physical - 1) seq += `${ESC}[1A`; // up to the next row
    }
    seq += `${ESC}[G`; // column 0 of the top row
    originalWrite(seq);
    resetInk();
  };

  stdout.on("resize", onResize);
  return () => {
    stdout.off?.("resize", onResize);
    (stdout as { write: (d: string) => unknown }).write = originalWrite;
  };
}
