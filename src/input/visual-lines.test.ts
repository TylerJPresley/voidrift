/**
 * Pure visual-line geometry tests (cli-blueprint.md §3.1, §3.2, §3.4): wrapping
 * (whitespace-preferred, char-wrap fallback), cursor↔visual mapping, vertical
 * moves with a preserved goal column, fall-through at the edges, and edge cases
 * (empty lines, trailing newline, narrow/width-1 columns, wide/zero-width).
 */
import { describe, it, expect } from "vitest";
import {
  wrapLine,
  toVisualLines,
  cursorToVisual,
  verticalMove,
  isMultiVisual,
} from "./visual-lines.js";

describe("§3.1 wrapLine — whitespace-preferred, char-wrap fallback", () => {
  it("keeps a short line as one segment", () => {
    expect(wrapLine("hello", 10)).toEqual(["hello"]);
  });
  it("breaks at the last whitespace within the width", () => {
    expect(wrapLine("hello world", 8)).toEqual(["hello ", "world"]);
  });
  it("character-wraps a word with no break point", () => {
    expect(wrapLine("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });
  it("yields one empty segment for an empty line", () => {
    expect(wrapLine("", 5)).toEqual([""]);
  });
  it("width 1 breaks every character (no infinite loop)", () => {
    expect(wrapLine("abc", 1)).toEqual(["a", "b", "c"]);
  });
  it("treats zero/negative columns as width 1", () => {
    expect(wrapLine("ab", 0)).toEqual(["a", "b"]);
    expect(wrapLine("ab", -5)).toEqual(["a", "b"]);
  });
  it("counts a surrogate pair as one unit (no split, no loop)", () => {
    expect(wrapLine("😀😀😀", 2)).toEqual(["😀😀", "😀"]);
  });
});

describe("§3.1 toVisualLines — logical lines then wraps, with offsets", () => {
  it("splits on newlines and tracks start offsets", () => {
    const vls = toVisualLines("ab\ncd", 10);
    expect(vls.map((v) => v.text)).toEqual(["ab", "cd"]);
    expect(vls.map((v) => v.start)).toEqual([0, 3]); // "cd" after "ab\n"
  });
  it("keeps an empty logical line as a blank visual row", () => {
    const vls = toVisualLines("a\n\nb", 10);
    expect(vls.map((v) => v.text)).toEqual(["a", "", "b"]);
    expect(vls.map((v) => v.start)).toEqual([0, 2, 3]);
  });
  it("a trailing newline yields a final empty visual line", () => {
    const vls = toVisualLines("a\n", 10);
    expect(vls.map((v) => v.text)).toEqual(["a", ""]);
    expect(vls.map((v) => v.start)).toEqual([0, 2]);
  });
  it("wraps a single logical line into multiple visual lines", () => {
    const vls = toVisualLines("hello world", 8);
    expect(vls.map((v) => v.text)).toEqual(["hello ", "world"]);
    expect(vls.map((v) => v.start)).toEqual([0, 6]);
  });
});

describe("§3.2 cursorToVisual", () => {
  it("maps a cursor to its row and column", () => {
    const vls = toVisualLines("ab\ncd", 10);
    expect(cursorToVisual(vls, 0)).toEqual({ row: 0, col: 0 });
    expect(cursorToVisual(vls, 2)).toEqual({ row: 0, col: 2 }); // end of "ab"
    expect(cursorToVisual(vls, 3)).toEqual({ row: 1, col: 0 }); // start of "cd"
    expect(cursorToVisual(vls, 5)).toEqual({ row: 1, col: 2 }); // end of buffer
  });
});

describe("§3.2/§3.4 verticalMove — goal column, fall-through", () => {
  it("Up on the first visual line falls through (null)", () => {
    expect(verticalMove("ab\ncd", 0, 10, "up", null)).toBeNull();
  });
  it("Down on the last visual line falls through (null)", () => {
    expect(verticalMove("ab\ncd", 5, 10, "down", null)).toBeNull();
  });
  it("Up moves to the previous line keeping the column", () => {
    // cursor at row1 col1 (after 'c') → row0 col1 (after 'a')
    const r = verticalMove("ab\ncd", 4, 10, "up", null);
    expect(r).toEqual({ cursor: 1, goalCol: 1 });
  });
  it("Down moves to the next line keeping the column", () => {
    const r = verticalMove("ab\ncd", 1, 10, "down", null);
    expect(r).toEqual({ cursor: 4, goalCol: 1 });
  });
  it("clamps to a shorter line but preserves the goal column", () => {
    // "abcd\nx\nwxyz": from col3 of row0, Down lands on "x" clamped to col1,
    // the goal column 3 is preserved so a second Down restores col3 on row2.
    const value = "abcd\nx\nwxyz";
    const down1 = verticalMove(value, 3, 10, "down", null);
    expect(down1).toEqual({ cursor: 6, goalCol: 3 }); // "x" end (col1), goal 3
    const down2 = verticalMove(value, down1!.cursor, 10, "down", down1!.goalCol);
    expect(down2).toEqual({ cursor: 10, goalCol: 3 }); // "wxyz" col3
  });
  it("navigates visual lines of a wrapped single logical line", () => {
    // "hello world" at columns 8 → ["hello ","world"]; cursor at col2 of row0.
    const r = verticalMove("hello world", 2, 8, "down", null);
    expect(r).toEqual({ cursor: 8, goalCol: 2 }); // row1 "world" col2
    // Up from the first visual line of the wrapped line falls through.
    expect(verticalMove("hello world", 2, 8, "up", null)).toBeNull();
  });
  it("handles an empty middle line without crashing", () => {
    const r = verticalMove("ab\n\ncd", 1, 10, "down", null);
    expect(r).toEqual({ cursor: 3, goalCol: 1 }); // the empty row, clamped to 0
    expect(r!.cursor).toBe(3);
  });
});

describe("§3.2 isMultiVisual", () => {
  it("is false for a single short line", () => {
    expect(isMultiVisual("hello", 80)).toBe(false);
  });
  it("is true for a newline", () => {
    expect(isMultiVisual("a\nb", 80)).toBe(true);
  });
  it("is true for a wrapped line", () => {
    expect(isMultiVisual("hello world", 8)).toBe(true);
  });
});
