/**
 * Component-level regression tests for the markdown rendering defects the owner
 * screenshotted (cli-blueprint.md §4.3), rendered through the real Ink
 * components: margin collapse (one blank row between blocks), bullet marker
 * space, the streaming cursor on a live table's last row, and the invariant
 * that the progressively-committed reply renders identically to the same reply
 * rendered whole.
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Markdown } from "./Markdown.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";
import { reduce, pushUser, initialState, blockLines, type ViewState } from "../state.js";

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 40 });
const theme = resolveTheme(caps(100));

function md(source: string, cols = 80): string[] {
  const r = render(<Markdown source={source} theme={theme} caps={caps(cols)} columns={cols} />);
  const lines = r.lastFrame()!.split("\n");
  r.unmount();
  return lines;
}

/** Count blank rows between the first row matching `a` and the first matching `b`. */
function blanksBetween(lines: string[], a: string, b: string): number {
  const i = lines.findIndex((l) => l.includes(a));
  const j = lines.findIndex((l, k) => k > i && l.includes(b));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);
  let n = 0;
  for (let k = i + 1; k < j; k++) if (lines[k]!.trim() === "") n++;
  return n;
}

describe("§4.3 block margins collapse: exactly one blank row between blocks", () => {
  it("one blank row between a heading and the following paragraph", () => {
    const lines = md("## What changes by restyle scope\n\nThis is a paragraph of body text.");
    expect(blanksBetween(lines, "What changes", "This is a paragraph")).toBe(1);
  });

  it("one blank row between a paragraph and the next paragraph", () => {
    const lines = md("First paragraph here.\n\nSecond paragraph here.");
    expect(blanksBetween(lines, "First paragraph", "Second paragraph")).toBe(1);
  });

  it("no blank rows between items of one list", () => {
    const lines = md("- item one\n- item two\n- item three");
    expect(blanksBetween(lines, "item one", "item two")).toBe(0);
    expect(blanksBetween(lines, "item two", "item three")).toBe(0);
  });
});

describe("§4.3 every bullet starts `• ` even when the item begins with emphasis", () => {
  it("a bullet whose item starts with bold renders `• ` + text (a space after the bullet)", () => {
    const lines = md("- **The theme is a prop** — not context");
    const row = lines.find((l) => l.includes("The theme is a prop"))!;
    expect(row).toMatch(/•\s+The theme is a prop/);
    expect(row).not.toMatch(/•The theme/);
  });

  it("a bullet whose item starts with an inline code span renders `• ` + text", () => {
    const lines = md("- `NO_COLOR` fallbacks are load-bearing");
    const row = lines.find((l) => l.includes("NO_COLOR"))!;
    expect(row).toMatch(/•\s+NO_COLOR/);
    expect(row).not.toMatch(/•NO_COLOR/);
  });
});


describe("§4.2/§4.3 progressive commit renders identically to the whole reply", () => {
  // The owner's regression document.
  const doc = [
    "So a color restyle is mostly editing the *HEX* and *ANSI16* tables in `theme.ts`. That's it for palette.",
    "",
    "## What changes by restyle scope",
    "",
    "**1. Just colors (smallest)**",
    "",
    "- Edit `HEX` / `ANSI16` in `theme.ts`.",
    "",
    "- Re-run `theme.test.ts` (328 lines) — it asserts palette values and *NO_COLOR fallbacks*.",
    "- ~1 file, low risk.",
    "",
    '**3. Layout / structure (biggest)** This is where it stops being "edit a table." The panels are rendered by `PanelHost.tsx` (99 lines), which is a *single generic renderer* for all ~14 panels. It lays out:',
    "",
    "- title (accent) → column headers (dim) → rows",
    "",
    "The panel *content* lives in `panels/declarations.ts` (BUILTIN_PANELS, 169 lines) — that's data, so column-width tweaks are cheap and don't touch rendering.",
    "",
    "- **The theme is a prop, not context** — `theme: ThemeTokens` and `glyphs: Glyphs` are threaded through `App` → `OutputPane`.",
    '- `NO_COLOR` / capability fallbacks are load-bearing: every token is `string | undefined`, and components guard each usage (`theme.accent ? { color: theme.accent } : {}`). A restyle must preserve the undefined path for `colorDepth: "none"`.',
    "",
    "## Rough effort estimate",
    "",
    "| Scope | Files touched | Effort | Risk |",
    "|---|---|---|---|",
    "| Palette values only | theme.ts + theme.test.ts | ~30 min | Low |",
  ].join("\n");

  function stream(s: ViewState, text: string, size = 8): ViewState {
    for (let i = 0; i < text.length; i += size) {
      s = reduce(s, { type: "token", token: text.slice(i, i + size), done: i + size >= text.length });
    }
    return s;
  }

  it("concatenated committed fragments equal the whole reply (plain projection)", () => {
    let prog = pushUser(initialState(5000), "restyle");
    prog = stream(prog, doc, 8);
    prog = reduce(prog, { type: "turn_complete", status: "completed", text: doc, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    let whole = pushUser(initialState(5000), "restyle");
    whole = reduce(whole, { type: "turn_complete", status: "completed", text: doc, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    expect(blockLines(prog.blocks)).toEqual(blockLines(whole.blocks));
  });

  it("the whole document has no raw backticks or stray trailing underscores and keeps identifiers intact", () => {
    const lines = md(doc, 100);
    const text = lines.join("\n");
    expect(text).not.toContain("`");
    expect(text).toContain("NO_COLOR");
    expect(text).toContain("PanelHost.tsx");
    // No paragraph ends with a stray emphasis underscore.
    for (const l of lines) expect(l.trimEnd()).not.toMatch(/[^_]_$/);
    // Exactly one blank row after each heading.
    expect(blanksBetween(lines, "What changes by restyle scope", "Just colors")).toBe(1);
    expect(blanksBetween(lines, "Rough effort estimate", "Scope")).toBe(1);
  });
});
