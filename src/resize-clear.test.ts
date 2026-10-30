/**
 * Unit tests for the width-decrease frame clear (cli-blueprint §5.2). The pty
 * emulator e2e proves the end-to-end behaviour; these prove the escape logic
 * fast and without a TTY: a width DECREASE erases the rewrapped frame's full
 * physical extent and resets Ink, while a width INCREASE, a height-only change,
 * and a decrease with no rewrap emit nothing and never reset Ink.
 */
import { describe, it, expect, vi } from "vitest";
import { installResizeClear, type ResizeStdout } from "./resize-clear.js";

/** A fake stdout that records writes and lets a test fire `resize` and set size. */
function fakeStdout(columns: number): ResizeStdout & {
  writes: string[];
  fire: () => void;
  set: (cols: number) => void;
} {
  let listener: (() => void) | null = null;
  const writes: string[] = [];
  const out = {
    columns,
    rows: 40,
    writes,
    write(data: string): boolean {
      writes.push(data);
      return true;
    },
    on(_event: "resize", l: () => void): void {
      listener = l;
    },
    off(): void {
      listener = null;
    },
    fire(): void {
      listener?.();
    },
    set(cols: number): void {
      out.columns = cols;
    },
  };
  return out;
}

/** A wide frame: one short spinner row + a 100-col rule + a 100-col status line,
 * so it rewraps to more physical rows at 40 cols. */
const WIDE_FRAME =
  "  Thinking · 1.0s\n\n" + "\u2500".repeat(100) + "\n" + "[Chat] voidrift · local".padEnd(100, " ") + "\n";

describe("installResizeClear", () => {
  it("erases and resets Ink on a width decrease that rewraps", () => {
    const out = fakeStdout(100);
    const resetInk = vi.fn();
    installResizeClear(out, resetInk);
    out.write(WIDE_FRAME); // Ink paints the wide frame (sniffed)
    out.writes.length = 0;
    out.set(40);
    out.fire();
    // An erase sequence was emitted (CSI 2K rows) and Ink was reset once.
    const emitted = out.writes.join("");
    expect(emitted).toMatch(/\u001b\[2K/);
    expect(resetInk).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a width increase", () => {
    const out = fakeStdout(60);
    const resetInk = vi.fn();
    installResizeClear(out, resetInk);
    out.write(WIDE_FRAME);
    out.writes.length = 0;
    out.set(100);
    out.fire();
    expect(out.writes.join("")).toBe("");
    expect(resetInk).not.toHaveBeenCalled();
  });

  it("does nothing on a height-only change (columns unchanged)", () => {
    const out = fakeStdout(80);
    const resetInk = vi.fn();
    installResizeClear(out, resetInk);
    out.write(WIDE_FRAME);
    out.writes.length = 0;
    out.fire(); // columns stayed 80
    expect(out.writes.join("")).toBe("");
    expect(resetInk).not.toHaveBeenCalled();
  });

  it("does nothing on a decrease when the frame does not rewrap (all rows fit)", () => {
    const out = fakeStdout(100);
    const resetInk = vi.fn();
    installResizeClear(out, resetInk);
    out.write("  Thinking · 1.0s\n\n[Chat] voidrift\n"); // short rows, fit at 80
    out.writes.length = 0;
    out.set(80);
    out.fire();
    expect(out.writes.join("")).toBe("");
    expect(resetInk).not.toHaveBeenCalled();
  });

  it("stops sniffing and handling resize after dispose", () => {
    const out = fakeStdout(100);
    const resetInk = vi.fn();
    const dispose = installResizeClear(out, resetInk);
    out.write(WIDE_FRAME); // sniffed while installed
    dispose();
    out.writes.length = 0;
    out.set(40);
    out.fire(); // handler removed — no erase, no reset
    expect(out.writes.join("")).toBe("");
    expect(resetInk).not.toHaveBeenCalled();
  });
});
