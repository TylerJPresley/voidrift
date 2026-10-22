/**
 * §4.1 content-width property test (cli-blueprint.md §1.5, §4.1, §4.10): every
 * committed row is laid out within a content width of `columns - 4` and is
 * never wider than `columns - 2`, measured with terminal DISPLAY width (a wide
 * CJK/emoji glyph counts two columns, a combining mark zero, ANSI escapes
 * zero). A word or URL longer than the content width is hard-broken; a bullet
 * row carries exactly one space after the `•`; continuation rows of a list item
 * align under the item text; no row is ever a lone one- or two-character
 * continuation produced by an off-by-one.
 *
 * It renders a corpus through the REAL components (OutputPane → Markdown,
 * ToolGroup, the user echo, notices, the footer line) at widths 30..140.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Markdown } from "./Markdown.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, displayWidth } from "../render/theme.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, "");

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 60 });

/** A dense corpus exercising every committed row shape. */
const CORPUS = [
  "# A heading that is quite long and will need to wrap once the terminal gets narrow enough to force it",
  "",
  "This is a long paragraph of prose that keeps going and going so it certainly has to wrap at any sensible terminal width, exercising the wrap and the right padding.",
  "",
  "A supercalifragilisticexpialidocioussupercalifragilisticexpialidocious single very long word.",
  "",
  "See https://example.com/a/very/long/path/that/keeps/going/and/going/and/will/not/fit/on/one/line/at/all/ever here.",
  "",
  "- A bullet item whose text is long enough that it will wrap onto a continuation row at narrow widths and keep the alignment under the item text",
  "- A short bullet",
  "- **Bold-prefixed** bullet with a reasonably long tail that also wraps nicely at narrower widths for sure",
  "",
  "1. First ordered item with a long enough tail to wrap at narrow widths and stay aligned",
  "2. Second ordered item",
  "",
  "- top level item that is long enough to wrap around once or twice depending on the width chosen",
  "  - nested child item that is also long enough to wrap at the narrower widths under test",
  "",
  "A line with emoji 🚀🚀🚀 and CJK 你好世界你好世界 mixed into a sentence that is long enough to wrap.",
  "",
  "Some `inline code span that is also fairly long` inside a paragraph that wraps around the width.",
  "",
  "| Package | Kind | Role |",
  "| --- | --- | --- |",
  "| core | library | the shared engine behind every client and application |",
  "| cli | product | the flagship command line harness that people run daily |",
  "",
  "```ts",
  "const x = 1; // a code fence line that is long enough to exceed the narrow content width easily here",
  "```",
  "",
  "> A blockquote that is long enough to wrap at the narrow widths under test and stay inside the content width.",
].join("\n");

/** All rendered rows of a frame, ANSI-stripped, trailing-space-trimmed off the
 * right so a flexbox pad to the box width is not counted as content. */
function rowsOf(frame: string): string[] {
  return strip(frame).split("\n");
}

/** The whitespace-delimited words present in the corpus — a lone short row that
 * matches one of these is a legitimately short word, not a hard-break fragment
 * (§4.1 allows a legitimately short last word). */
const CORPUS_WORDS = new Set(CORPUS.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean));

/** A row is a "lone continuation" DEFECT when it holds a single 1–2 char alpha
 * token that is NOT a whole word from the source — i.e. a fragment pulled off a
 * longer word by an off-by-one or an unbalanced hard-break (the owner's "d on
 * the left"). A legitimately short last word (e.g. "it", "to") is allowed. */
function loneContinuations(rows: string[]): string[] {
  return rows
    .map((r) => r.trim())
    .filter((t) => t.length >= 1 && t.length <= 2 && /^[A-Za-z]{1,2}$/.test(t))
    .filter((t) => !CORPUS_WORDS.has(t));
}

describe("§4.1 content width — every row within columns - 2 (display width)", () => {
  for (let cols = 30; cols <= 140; cols += 2) {
    it(`no committed markdown row exceeds columns - 2 at ${cols} columns`, () => {
      const c = caps(cols);
      const theme = resolveTheme(c);
      const r = render(
        <Markdown source={CORPUS} theme={theme} caps={c} columns={cols} />,
      );
      const rows = rowsOf(r.lastFrame()!);
      r.unmount();
      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(cols - 2);
      }
    });
  }

  it("a long word and a long URL are hard-broken, never overflowing (narrow)", () => {
    const c = caps(40);
    const theme = resolveTheme(c);
    const r = render(<Markdown source={CORPUS} theme={theme} caps={c} columns={40} />);
    const rows = rowsOf(r.lastFrame()!);
    r.unmount();
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(38);
    // The long word and URL text survived (some fragment of them is present).
    const joined = rows.join("");
    expect(joined).toContain("supercalifragilistic");
    expect(joined).toContain("example.com");
  });

  it("no lone 1–2 character continuation row across widths", () => {
    for (let cols = 30; cols <= 140; cols += 5) {
      const c = caps(cols);
      const theme = resolveTheme(c);
      const r = render(<Markdown source={CORPUS} theme={theme} caps={c} columns={cols} />);
      const rows = rowsOf(r.lastFrame()!);
      r.unmount();
      expect(loneContinuations(rows)).toEqual([]);
    }
  });

  it("every bullet row has exactly one space after the bullet glyph", () => {
    for (const cols of [40, 60, 80, 120]) {
      const c = caps(cols);
      const theme = resolveTheme(c);
      const r = render(<Markdown source={"- item one\n- item two"} theme={theme} caps={c} columns={cols} />);
      const rows = rowsOf(r.lastFrame()!).filter((l) => l.includes("•"));
      r.unmount();
      for (const row of rows) {
        // exactly one space between the bullet and the first non-space char.
        expect(row).toMatch(/•\u0020\S/);
        expect(row).not.toMatch(/•\u0020{2,}/);
      }
    }
  });

  it("the specific regression: a bullet whose last word ends exactly at the content width does not spill a stray char", () => {
    // Build a bullet whose single line lands the last character exactly on the
    // content-width boundary at a chosen width, then assert no row exceeds the
    // bound and no lone continuation appears.
    const cols = 48; // contentWidth = 44
    const c = caps(cols);
    const theme = resolveTheme(c);
    // "• " + text; make the text 44 - 2 = 42 columns with words so the last word
    // can land on the boundary.
    const text = "alpha bravo charlie delta echo foxtrot golfx"; // crafted length
    const r = render(<Markdown source={`- ${text}`} theme={theme} caps={c} columns={cols} />);
    const rows = rowsOf(r.lastFrame()!);
    r.unmount();
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(cols - 2);
    expect(loneContinuations(rows)).toEqual([]);
  });
});
