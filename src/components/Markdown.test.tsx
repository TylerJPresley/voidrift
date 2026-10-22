/**
 * §4.3/§4.5 Markdown and diff component rendering (cli-blueprint.md §4.3, §4.5).
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Markdown, DiffView } from "./Markdown.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";

const caps = detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: 80, rows: 24 });
const theme = resolveTheme(caps);

describe("Markdown component", () => {
  it("renders headings, lists, code, and a diff fence", () => {
    const src = ["# Head", "- a", "- b", "```ts", "const x=1", "```", "```diff", "+add", "-del", "```"].join("\n");
    const r = render(<Markdown source={src} theme={theme} caps={caps} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("Head");
    expect(frame).toContain("a");
    expect(frame).toContain("+add");
    expect(frame).toContain("-del");
    r.unmount();
  });

  it("renders a blank line before and after a heading (§4.3)", () => {
    const src = ["para one", "", "## A Heading", "", "para two"].join("\n");
    const r = render(<Markdown source={src} theme={theme} caps={caps} />);
    const lines = r.lastFrame()!.split("\n");
    const hi = lines.findIndex((l) => l.includes("A Heading"));
    expect(hi).toBeGreaterThan(0);
    expect(lines[hi - 1]!.trim()).toBe("");
    expect(lines[hi + 1]!.trim()).toBe("");
    r.unmount();
  });

  it("separates adjacent paragraphs with a blank line (§4.3)", () => {
    const r = render(<Markdown source={"first para\n\nsecond para"} theme={theme} caps={caps} />);
    const lines = r.lastFrame()!.split("\n");
    const a = lines.findIndex((l) => l.includes("first para"));
    const b = lines.findIndex((l) => l.includes("second para"));
    expect(b - a).toBeGreaterThanOrEqual(2);
    r.unmount();
  });
});

describe("Markdown §4.3 layout over the on-screen content", () => {
  // The exact shapes seen in the round-1 screenshot: a heading, a paragraph, a
  // 3-item bold-prefixed bullet list, a nested list, an ordered list, and a
  // blockquote.
  function frameOf(src: string, cols = 100): { frame: string; lines: string[] } {
    const c = detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 50 });
    const t = resolveTheme(c);
    const r = render(<Markdown source={src} theme={t} caps={c} columns={cols} />);
    const frame = r.lastFrame()!;
    r.unmount();
    return { frame, lines: frame.split("\n") };
  }

  it("an h1 heading is distinct from bold emphasis: it adds a full-width rule row (§4.3)", () => {
    const heading = frameOf("# The big picture (ecosystem)");
    const hi = heading.lines.findIndex((l) => l.includes("The big picture (ecosystem)"));
    expect(hi).toBeGreaterThanOrEqual(0);
    // The line directly beneath the h1 text is a dim horizontal rule.
    expect(heading.lines[hi + 1]!.trim()).toMatch(/^─+$/);

    // The same text as bold emphasis in a paragraph does NOT produce a rule row
    // — so a heading is visually different from `**bold**` emphasis.
    const bold = frameOf("**The big picture (ecosystem)**");
    const bi = bold.lines.findIndex((l) => l.includes("The big picture (ecosystem)"));
    const next = (bold.lines[bi + 1] ?? "").trim();
    expect(next).not.toMatch(/^─+$/);
  });

  it("a 3-item bold-prefixed bullet list is TIGHT: 3 item rows, no blank rows between (§4.3)", () => {
    const src = [
      "Intro paragraph.",
      "",
      "- **CLI** the flagship command line harness",
      "- **VS Code** the editor extension",
      "- **Web** the browser client",
    ].join("\n");
    const { lines } = frameOf(src);
    const idx = ["CLI", "VS Code", "Web"].map((k) => lines.findIndex((l) => l.includes(k)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    // The three bullets occupy three CONSECUTIVE rows — a tight list, not loose.
    expect(idx[1]! - idx[0]!).toBe(1);
    expect(idx[2]! - idx[1]!).toBe(1);
    // Each item carries the `•` bullet glyph.
    for (const i of idx) expect(lines[i]!).toContain("•");
  });

  it("a nested list indents two spaces per level (§4.3)", () => {
    const src = ["- top", "  - child"].join("\n");
    const { lines } = frameOf(src);
    const top = lines.find((l) => l.includes("top"))!;
    const child = lines.find((l) => l.includes("child"))!;
    const lead = (s: string): number => s.length - s.trimStart().length;
    expect(lead(child) - lead(top)).toBe(2);
  });

  it("an ordered list aligns its numbers in a gutter sized to the widest number (§4.3)", () => {
    // Items 1..10: the 1-digit markers are right-padded to align with `10.`.
    const src = Array.from({ length: 10 }, (_, i) => `${i + 1}. item ${i + 1}`).join("\n");
    const { lines } = frameOf(src);
    const first = lines.find((l) => /\bitem 1\b/.test(l))!;
    const tenth = lines.find((l) => /\bitem 10\b/.test(l))!;
    // "1." is padded to the width of "10." so the markers right-align: the `1.`
    // row has a leading space before the `1`.
    const one = first.indexOf("1.");
    const ten = tenth.indexOf("10.");
    expect(one).toBe(ten + 1);
  });

  it("a blockquote renders a dim left bar on each quoted line (§4.3)", () => {
    const { lines } = frameOf("> a quoted note");
    const q = lines.find((l) => l.includes("a quoted note"))!;
    expect(q).toContain("│");
    expect(q.indexOf("│")).toBeLessThan(q.indexOf("a quoted note"));
  });

  it("the whole screenshot block: tight list keeps a 3-item list to 3 rows, blank before/after", () => {
    const src = [
      "## Section",
      "",
      "A short paragraph of prose.",
      "",
      "- one",
      "- two",
      "- three",
      "",
      "After the list.",
    ].join("\n");
    const { lines } = frameOf(src);
    const one = lines.findIndex((l) => l.includes("one"));
    const three = lines.findIndex((l) => l.includes("three"));
    // The 3-item list spans exactly 3 rows (tight).
    expect(three - one).toBe(2);
    // A blank row before the first item and after the last item.
    expect(lines[one - 1]!.trim()).toBe("");
    expect(lines[three + 1]!.trim()).toBe("");
  });
});

describe("Markdown tables (§4.3)", () => {
  // The 3-column table from the screenshot: a long Role cell that must wrap.
  const TABLE = [
    "| Package | Kind | Role |",
    "| --- | --- | --- |",
    "| bedrock | plugin | model providers for amazon bedrock across regions |",
    "| mcp-server | mcp | a typed-verdict judge server reached through the client |",
    "| core | library | the shared engine behind every client |",
    "| cli | product | the flagship command line harness |",
    "| web | product | the browser client user interface |",
    "| desktop | product | the electron desktop application |",
    "| vscode | product | the editor extension integration |",
  ].join("\n");

  function renderAt(cols: number): string {
    const c = detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 40 });
    const t = resolveTheme(c);
    const r = render(<Markdown source={TABLE} theme={t} caps={c} columns={cols} />);
    const frame = r.lastFrame()!;
    r.unmount();
    return frame;
  }

  for (const cols of [120, 80, 60]) {
    it(`at ${cols} columns: bordered, header rule, nothing ellipsis-truncated`, () => {
      const frame = renderAt(cols);
      // Box-drawing borders and a header rule are present.
      expect(frame).toMatch(/[┌┐└┘├┤┬┴┼─│]/);
      // No cell is ellipsis-truncated.
      expect(frame).not.toContain("…");
      expect(frame).not.toContain("bedr…");
      expect(frame).not.toContain("mcp-se…");
      // Every word of the long Role cell survives (wrapped, not cut).
      for (const w of ["providers", "regions", "typed-verdict", "judge"]) {
        expect(frame).toContain(w);
      }
      // All header labels and keys present.
      for (const k of ["Package", "Kind", "Role", "bedrock", "mcp-server"]) {
        expect(frame).toContain(k);
      }
    });
  }

  it("falls back to a stacked key: value list when too narrow for the minimum", () => {
    const frame = renderAt(20);
    // No box border at this width; a stacked list instead, nothing truncated.
    expect(frame).not.toContain("…");
    expect(frame).toContain("Package");
    expect(frame).toContain("bedrock");
    expect(frame).toContain("providers");
  });
});

describe("DiffView component", () => {
  it("renders each diff line preserving the marker", () => {
    const r = render(<DiffView diff={"@@ -1 +1 @@\n+added\n-removed\n context"} theme={theme} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("@@ -1 +1 @@");
    expect(frame).toContain("+added");
    expect(frame).toContain("-removed");
    expect(frame).toContain("context");
    r.unmount();
  });
});
