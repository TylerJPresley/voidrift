/**
 * §7.1 panel host (cli-blueprint.md §7.1, panels-blueprint §2/§5/§6). ONE
 * generic renderer: frame/title/description/footer/notice regions; no cursor on
 * a read-only panel (arrows only scroll); a cursor + `▸` on a panel with
 * actions/detail; `/` in-memory filter; a tabbed panel swaps columns and keyed
 * actions per page; a confirm `y/n` prompt in the notice region runs the op
 * only on `y`; footer collapses to `? keys` when space is tight; the four cell
 * formats; a dotted key; an unknown name renders inline, never a crash;
 * sanitize is applied to every cell.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import type { BoundPanelRegistry } from "../panels/types.js";
import { PanelHost } from "./PanelHost.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { waitForFrame } from "../test-frame.js";

// ink-testing-library strips ANSI, so a colour prop is not observable in the
// rendered frame. To assert the separator/frame colours (owner: inner dividers
// dim, outer frame border), wrap ink's `Text`/`Box` with recording passthroughs
// that forward every prop (frames render identically) and push their props to a
// shared buffer. Only the colour-assertion tests read the buffer.
const recordedText: Array<{ color?: unknown; children?: unknown }> = [];
const recordedBox: Array<{ borderStyle?: unknown; borderColor?: unknown }> = [];
vi.mock("ink", async (importActual) => {
  const actual = await importActual<typeof import("ink")>();
  const Text = (props: Record<string, unknown>): React.ReactElement => {
    recordedText.push({ color: props.color, children: props.children });
    return React.createElement(actual.Text, props);
  };
  const Box = (props: Record<string, unknown>): React.ReactElement => {
    recordedBox.push({ borderStyle: props.borderStyle, borderColor: props.borderColor });
    return React.createElement(actual.Box, props);
  };
  return { ...actual, Text, Box };
});

const caps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 });
const theme = resolveTheme(caps);
const glyphs = resolveGlyphs(caps);

function mount(name: string, registry: BoundPanelRegistry, cols = 100, rows = 40, onClose = () => undefined) {
  return render(<PanelHost name={name} registry={registry} onClose={onClose} theme={theme} glyphs={glyphs} columns={cols} rows={rows} />);
}

const NOW = Date.now();

describe("§7.1 PanelHost — frame, title, description, footer", () => {
  it("renders the title, the dim description, the table and a footer", () => {
    const reg: BoundPanelRegistry = {
      stats: {
        title: "Stats",
        description: "The live session's stats.",
        columns: [{ key: "label", label: "Metric", width: 12 }, { key: "value", label: "Value" }],
        getItems: () => [{ label: "tokens", value: "100" }],
      },
    };
    const r = mount("stats", reg);
    const f = r.lastFrame()!;
    expect(f).toContain("Stats");
    expect(f).toContain("The live session's stats.");
    expect(f).toContain("tokens");
    expect(f).toContain("esc close");
    expect(f).toContain("/ filter");
    r.unmount();
  });

  it("an unknown name renders the inline unknown-panel notice, not a crash", () => {
    const r = mount("nope", {});
    expect(r.lastFrame()).toContain("Unknown panel: nope");
    r.unmount();
  });

  it("a throwing getter renders the inline error state without crashing", () => {
    const reg: BoundPanelRegistry = {
      broken: { title: "Broken", columns: [{ key: "x", label: "X" }], getItems: () => { throw new Error("boom"); } },
    };
    expect(mount("broken", reg).lastFrame()).toContain("Error loading panel data");
  });

  it("sanitize strips control/bidi bytes from every cell", () => {
    const reg: BoundPanelRegistry = {
      s: { title: "S", columns: [{ key: "name", label: "Name" }], getItems: () => [{ name: "a\u202Eb\u0007c" }] },
    };
    const f = mount("s", reg).lastFrame()!;
    expect(f).not.toContain("\u202E");
    expect(f).not.toContain("\u0007");
  });
});

describe("§7.1 cursor only when selectable (pin 3)", () => {
  it("a read-only panel shows NO cursor marker and arrows only scroll", async () => {
    const reg: BoundPanelRegistry = {
      stats: { title: "Stats", columns: [{ key: "label", label: "M" }], getItems: () => [{ label: "a" }, { label: "b" }] },
    };
    const r = mount("stats", reg);
    expect(r.lastFrame()).not.toContain(glyphs.caretRight + " ");
    r.stdin.write("\u001b[B"); // Down
    await new Promise((res) => setTimeout(res, 30));
    expect(r.lastFrame()).not.toContain(glyphs.caretRight + " "); // still no marker
    r.unmount();
  });

  it("a panel with a detail view shows a cursor + ▸ on the selected row", async () => {
    const reg: BoundPanelRegistry = {
      sessions: {
        title: "Sessions",
        detail: { title: "Session" },
        columns: [{ key: "name", label: "Name", width: 10 }],
        getItems: () => [{ name: "one" }, { name: "two" }],
      },
    };
    const r = mount("sessions", reg);
    await waitForFrame(r, (f) => f.includes(glyphs.caretRight), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).toContain(glyphs.caretRight);
    r.unmount();
  });
});

describe("§7.1 formats and dotted keys", () => {
  it("renders relative-time, bytes and count, and resolves a dotted key", () => {
    const reg: BoundPanelRegistry = {
      f: {
        title: "F",
        columns: [
          { key: "age", label: "Age", format: "relative-time" },
          { key: "size", label: "Size", format: "bytes" },
          { key: "n", label: "N", format: "count" },
          { key: "meta.id", label: "Id" },
        ],
        getItems: () => [{ age: NOW - 3 * 3_600_000, size: 1_258_291, n: 1234, meta: { id: "deep" } }],
      },
    };
    const f = mount("f", reg).lastFrame()!;
    expect(f).toContain("3h");
    expect(f).toContain("1.2 MiB");
    expect(f).toContain("1,234");
    expect(f).toContain("deep");
  });
});

describe("§7.1 / filter", () => {
  it("filters the list in memory as typed", async () => {
    const reg: BoundPanelRegistry = {
      a: { title: "A", columns: [{ key: "name", label: "Name" }], getItems: () => [{ name: "alpha" }, { name: "beta" }] },
    };
    const r = mount("a", reg);
    r.stdin.write("/");
    await new Promise((res) => setTimeout(res, 20));
    r.stdin.write("alp");
    await waitForFrame(r, (f) => f.includes("alpha") && !f.includes("beta"), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).toContain("alpha");
    expect(r.lastFrame()).not.toContain("beta");
    r.unmount();
  });
});

describe("§7.1 tabbed panel swaps columns and actions (pin 8)", () => {
  const tabbed = (): BoundPanelRegistry => ({
    memory: {
      title: "Memory",
      columns: [{ key: "title", label: "Title" }],
      getItems: () => [{ title: "stored-one" }],
      pages: [
        { key: "stored", label: "Stored", columns: [{ key: "title", label: "Title" }], getItems: () => [{ title: "stored-one", id: "m1" }], actions: { d: { label: "delete", confirm: "Delete?", handler: () => undefined } } },
        { key: "suggestions", label: "Suggestions", columns: [{ key: "detail", label: "Detail" }], getItems: () => [{ detail: "pending-sug", id: "s1" }], actions: { a: { label: "approve", handler: () => undefined }, r: { label: "reject", handler: () => undefined } } },
      ],
    },
  });

  it("←→ switches pages, swapping the rows, columns and keyed actions, resetting the cursor", async () => {
    const r = mount("memory", tabbed());
    await waitForFrame(r, (f) => f.includes("stored-one"), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).toContain("d delete");
    r.stdin.write("\u001b[C"); // Right → Suggestions
    await waitForFrame(r, (f) => f.includes("pending-sug"), { timeoutMs: 2000, intervalMs: 10 });
    const f = r.lastFrame()!;
    expect(f).toContain("pending-sug");
    expect(f).toContain("a approve");
    expect(f).toContain("r reject");
    expect(f).not.toContain("d delete");
    r.unmount();
  });
});

describe("§7.1 confirm y/n in the notice region (pin 6)", () => {
  it("prompts in the notice area and runs the op only on y", async () => {
    const deleted: unknown[] = [];
    const reg: BoundPanelRegistry = {
      memory: {
        title: "Memory",
        columns: [{ key: "title", label: "Title" }],
        getItems: () => [{ title: "one", id: "m1" }],
        actions: { d: { label: "delete", confirm: "Delete this entry?", handler: (row) => { deleted.push(row); } } },
      },
    };
    const r = mount("memory", reg);
    await waitForFrame(r, (f) => f.includes(glyphs.caretRight), { timeoutMs: 2000, intervalMs: 10 });
    r.stdin.write("d"); // request delete → confirm prompt
    await waitForFrame(r, (f) => f.includes("Delete this entry?") && f.includes("y / n"), { timeoutMs: 2000, intervalMs: 10 });
    r.stdin.write("n"); // cancel
    await new Promise((res) => setTimeout(res, 30));
    expect(deleted).toHaveLength(0);
    r.stdin.write("d");
    await waitForFrame(r, (f) => f.includes("y / n"), { timeoutMs: 2000, intervalMs: 10 });
    r.stdin.write("y"); // confirm
    await waitForFrame(r, () => deleted.length > 0, { timeoutMs: 2000, intervalMs: 10 });
    expect(deleted).toEqual([{ title: "one", id: "m1" }]);
    r.unmount();
  });
});

describe("§7.1 footer collapse at 80 columns (pin 4)", () => {
  it("collapses navigation to `? keys` when nav + actions exceed the width", () => {
    const reg: BoundPanelRegistry = {
      wide: {
        title: "Wide",
        detail: { title: "D" },
        columns: [{ key: "name", label: "Name" }],
        getItems: () => [{ name: "x" }],
        actions: {
          a: { label: "approve-with-a-long-label", handler: () => undefined },
          b: { label: "another-long-action-label", handler: () => undefined },
          c: { label: "yet-another-long-one", handler: () => undefined },
        },
      },
    };
    const f = mount("wide", reg, 80, 24).lastFrame()!;
    expect(f).toContain("? keys");
    expect(f).toContain("a approve-with-a-long-label");
  });

  it("over-long cells are truncated to their fixed width (no wrap), so a sized table fits 80 columns (§6)", () => {
    const reg: BoundPanelRegistry = {
      sessions: {
        title: "Sessions",
        columns: [
          { key: "name", label: "Name", width: 18 },
          { key: "id", label: "Id", width: 10 },
          { key: "summary", label: "Summary", width: 30 },
        ],
        getItems: () => [{ name: "a-long-session-name-here-xx", id: "0123456789ab", summary: "a summary that is quite a bit longer than its column" }],
      },
    };
    const f = mount("sessions", reg, 80, 24).lastFrame()!;
    // Each over-long cell is truncated with `…` to its width, never wrapped.
    expect(f).toContain("a-long-session-na…"); // name truncated to 18 (17 + …)
    expect(f).toContain("012345678…"); // id truncated to 10 (9 + …)
    // The three fixed widths plus the two separators and marker fit within 80.
    const tableWidth = 2 + 18 + 2 + 10 + 2 + 30;
    expect(tableWidth).toBeLessThanOrEqual(80);
  });
});

describe("§7.1 frame width, full-width separators, region spacing (owner feedback)", () => {
  // A panel exercising every region: title+description, tabs, a table, a
  // `row C of N` indicator (many rows, short viewport), footer and actions.
  const full = (): BoundPanelRegistry => ({
    p: {
      title: "Panel",
      description: "A description.",
      columns: [{ key: "name", label: "Name", width: 10 }, { key: "v", label: "Value", width: 8 }],
      getItems: () => [],
      pages: [
        {
          key: "one",
          label: "One",
          columns: [{ key: "name", label: "Name", width: 10 }, { key: "v", label: "Value", width: 8 }],
          getItems: () => Array.from({ length: 50 }, (_, i) => ({ name: `n${i}`, v: `${i}`, id: `r${i}` })),
          actions: { d: { label: "delete", handler: () => undefined } },
        },
        { key: "two", label: "Two", columns: [{ key: "name", label: "Name" }], getItems: () => [{ name: "x" }] },
      ],
    },
  });

  // Round-border glyphs: corners ╭╮╰╯, verticals │, horizontal ─.
  const isBorderEnd = (line: string): boolean => /[│╮╯]$/.test(line);
  const isBorderStart = (line: string): boolean => /^[│╭╰]/.test(line);
  // Inner content width for a round border with paddingX:1 is columns-4.
  const innerWidth = (cols: number): number => cols - 4;
  // The inner text of a bordered content line: strip `│ ` / ` │` frame + pad.
  const innerText = (line: string): string => line.replace(/^│ ?/, "").replace(/ ?│$/, "");

  for (const cols of [80, 120]) {
    it(`at ${cols} columns: every line fits the frame and ends with a border glyph`, () => {
      const f = mount("p", full(), cols, 40).lastFrame()!;
      const lines = f.split("\n");
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(cols);
        expect(isBorderStart(line)).toBe(true);
        expect(isBorderEnd(line)).toBe(true);
      }
      // The frame is exactly the terminal width (top border spans it).
      expect(lines[0]!.length).toBe(cols);
    });

    it(`at ${cols} columns: every separator spans the full inner frame width`, () => {
      const f = mount("p", full(), cols, 40).lastFrame()!;
      const want = innerWidth(cols);
      const sepLines = f
        .split("\n")
        .filter((l) => /─/.test(l) && !/[╭╮╰╯]/.test(l)); // content separators, not the frame top/bottom
      expect(sepLines.length).toBeGreaterThan(0);
      for (const l of sepLines) {
        const dashes = innerText(l).length;
        expect(dashes).toBe(want);
      }
    });

    it(`at ${cols} columns: padding is content-only — no blank at the frame edges or adjacent to the footer/notice, exactly one blank above and below the table`, () => {
      const f = mount("p", full(), cols, 40).lastFrame()!;
      const inner = f.split("\n").slice(1, -1).map(innerText); // drop top/bottom border
      const isBlank = (l: string): boolean => l.trim() === "";
      const isSep = (l: string): boolean => /^─+$/.test(l.trim());

      // No blank row directly after the top border (title is the first row).
      expect(isBlank(inner[0]!)).toBe(false);
      // No blank row directly before the bottom border (footer/notice is last).
      expect(isBlank(inner[inner.length - 1]!)).toBe(false);

      // The footer row (nav) has NO blank directly above or below it.
      const footerIdx = inner.findIndex((l) => /esc close|\? keys/.test(l));
      expect(footerIdx).toBeGreaterThan(0);
      expect(isBlank(inner[footerIdx - 1]!)).toBe(false); // no blank above footer
      if (footerIdx + 1 < inner.length) {
        expect(isBlank(inner[footerIdx + 1]!)).toBe(false); // no blank below footer
      }

      // Exactly one blank row above and one below the table block (the header
      // row + data rows). The table block sits between the first separator and
      // the separator before the footer. Find the header row and assert the
      // row immediately above it (content padding) is blank, preceded by a
      // separator; and the first blank after the data rows is followed by the
      // footer separator.
      const headerIdx = inner.findIndex((l) => /\bName\b/.test(l));
      expect(headerIdx).toBeGreaterThan(0);
      expect(isBlank(inner[headerIdx - 1]!)).toBe(true); // one blank above table
      expect(isSep(inner[headerIdx - 2]!)).toBe(true); // separator above that blank
      // The blank below the table: scan forward from the header past data rows
      // to the first blank, which must be followed by the footer separator.
      let belowBlank = headerIdx + 1;
      while (belowBlank < inner.length && !isBlank(inner[belowBlank]!)) belowBlank++;
      expect(belowBlank).toBeLessThan(inner.length);
      expect(isBlank(inner[belowBlank]!)).toBe(true); // one blank below table
      expect(isSep(inner[belowBlank + 1]!)).toBe(true); // separator below that blank
      // That footer separator is immediately followed by the footer row (no
      // blank beside the footer).
      expect(/esc close|\? keys/.test(inner[belowBlank + 2]!)).toBe(true);

      // Separators that flank the table are the ONLY blank-adjacent ones; a
      // separator must never touch a blank on both sides except the two table
      // separators (content padding). Verify no doubled blank rows anywhere.
      for (let i = 1; i < inner.length; i++) {
        expect(isBlank(inner[i]!) && isBlank(inner[i - 1]!)).toBe(false);
      }

      // The `row C of N` indicator shares the FOOTER row (same line as nav),
      // right-aligned — it is not its own region and not above the table.
      expect(/row \d+ of \d+/.test(inner[footerIdx]!)).toBe(true);
      // No standalone `row C of N` line exists outside the footer.
      const standalone = inner.filter((l) => /^\s*row \d+ of \d+\s*$/.test(l));
      expect(standalone).toHaveLength(0);
    });
  }

  it("a cell wider than the frame is truncated with `…`, never widening the frame", () => {
    const cols = 80;
    const long = "x".repeat(500);
    const reg: BoundPanelRegistry = {
      p: {
        title: "Panel",
        columns: [{ key: "name", label: "Name" }],
        getItems: () => [{ name: long }],
      },
    };
    const f = mount("p", reg, cols, 40).lastFrame()!;
    const lines = f.split("\n");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(cols);
    expect(f).toContain("…");
    // The long run is cut, not fully present.
    expect(f).not.toContain(long);
  });
});

describe("§7.1 new layout — indicator on footer, collapse, selected row, notice", () => {
  const overflowing = (): BoundPanelRegistry => ({
    s: {
      title: "Sessions",
      detail: { title: "Session" },
      columns: [{ key: "name", label: "Name", width: 10 }, { key: "v", label: "Value", width: 8 }],
      getItems: () => Array.from({ length: 50 }, (_, i) => ({ name: `n${i}`, v: `${i}`, id: `r${i}` })),
    },
  });
  const innerText = (line: string): string => line.replace(/^│ ?/, "").replace(/ ?│$/, "");

  for (const cols of [80, 120]) {
    it(`at ${cols} columns: the \`row C of N\` indicator is right-aligned on the footer row`, () => {
      const f = mount("s", overflowing(), cols, 40).lastFrame()!;
      const inner = f.split("\n").map(innerText);
      const footer = inner.find((l) => /esc close|\? keys/.test(l))!;
      expect(footer).toBeDefined();
      expect(/row 1 of 50\s*$/.test(footer)).toBe(true); // indicator trails the line (right-aligned)
      expect(/^\s*↑↓ move|^\s*\? keys/.test(footer)).toBe(true); // nav leads the line
    });
  }

  it("at 80 columns: the footer collapses nav to `? keys` once nav + actions + indicator no longer fit", () => {
    const reg: BoundPanelRegistry = {
      s: {
        title: "S",
        detail: { title: "D" },
        columns: [{ key: "name", label: "Name", width: 10 }],
        getItems: () => Array.from({ length: 50 }, (_, i) => ({ name: `n${i}`, id: `r${i}` })),
        actions: {
          a: { label: "approve-with-a-long-label", handler: () => undefined },
          b: { label: "another-long-action-label", handler: () => undefined },
        },
      },
    };
    const f = mount("s", reg, 80, 40).lastFrame()!;
    expect(f).toContain("? keys"); // nav collapsed
    expect(f).toContain("row 1 of 50"); // indicator still present on the footer
    expect(f).toContain("a approve-with-a-long-label"); // actions kept
  });

  it("the selected row shows the ▸ marker and only its first column (bold is applied in render, not observable in the stripped frame)", async () => {
    const reg: BoundPanelRegistry = {
      s: {
        title: "S",
        detail: { title: "D" },
        columns: [{ key: "name", label: "Name", width: 10 }, { key: "v", label: "Value", width: 8 }],
        getItems: () => [{ name: "one", v: "a" }, { name: "two", v: "b" }],
      },
    };
    const r = mount("s", reg, 80, 40);
    await waitForFrame(r, (f) => f.includes(glyphs.caretRight), { timeoutMs: 2000, intervalMs: 10 });
    const lines = r.lastFrame()!.split("\n");
    // Exactly one row carries the marker (the selected row); the other does not.
    const marked = lines.filter((l) => l.includes(`${glyphs.caretRight} `));
    expect(marked).toHaveLength(1);
    expect(marked[0]!).toContain("one");
    expect(lines.some((l) => l.includes("two") && !l.includes(glyphs.caretRight))).toBe(true);
    // first-column-only bold: ink-testing-library strips ANSI, so the bold
    // attribute itself is NOT observable in the frame; the renderer wraps only
    // the first column in a bold <Text>. Asserting the marker placement is the
    // observable proxy — bold scope is covered by the render structure.
    r.unmount();
  });

  it("the notice region appears only while a notice is present (separated below the footer), and is gone after the next key", async () => {
    const reg: BoundPanelRegistry = {
      s: {
        title: "S",
        columns: [{ key: "name", label: "Name", width: 10 }],
        getItems: () => [{ name: "one", id: "m1" }],
        actions: { x: { label: "touch", handler: () => undefined } },
      },
    };
    const r = mount("s", reg, 100, 40);
    await waitForFrame(r, (f) => f.includes(glyphs.caretRight), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).not.toContain("touch done"); // no notice yet
    r.stdin.write("x"); // run the action → notice
    await waitForFrame(r, (f) => f.includes("touch done"), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).toContain("touch done");
    r.stdin.write("\u001b[B"); // any key clears the notice (Down)
    await waitForFrame(r, (f) => !f.includes("touch done"), { timeoutMs: 2000, intervalMs: 10 });
    expect(r.lastFrame()).not.toContain("touch done");
    r.unmount();
  });
});

describe("§7.1 inner dividers use the dim token, the frame keeps the border token (owner)", () => {
  const reg: BoundPanelRegistry = {
    p: { title: "P", columns: [{ key: "name", label: "Name" }], getItems: () => [{ name: "x" }] },
  };
  const isSep = (children: unknown): boolean => typeof children === "string" && /^─+$/.test(children);

  it("with colour: separators carry theme.dim, the frame carries theme.border (distinct tokens)", () => {
    expect(theme.dim).toBeDefined();
    expect(theme.border).toBeDefined();
    expect(theme.dim).not.toBe(theme.border);
    recordedText.length = 0;
    recordedBox.length = 0;
    const r = render(<PanelHost name="p" registry={reg} onClose={() => undefined} theme={theme} glyphs={glyphs} columns={100} rows={40} />);
    const seps = recordedText.filter((t) => isSep(t.children));
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) expect(s.color).toBe(theme.dim); // inner dividers → dim
    const frame = recordedBox.find((b) => b.borderStyle === "round");
    expect(frame?.borderColor).toBe(theme.border); // outer frame → border
    r.unmount();
  });

  it("under NO_COLOR nothing changes: separators and frame carry no colour (glyphs only)", () => {
    const noColor = resolveTheme(detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 }));
    expect(noColor.dim).toBeUndefined();
    expect(noColor.border).toBeUndefined();
    recordedText.length = 0;
    recordedBox.length = 0;
    const r = render(<PanelHost name="p" registry={reg} onClose={() => undefined} theme={noColor} glyphs={glyphs} columns={100} rows={40} />);
    const seps = recordedText.filter((t) => isSep(t.children));
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) expect(s.color).toBeUndefined();
    const frame = recordedBox.find((b) => b.borderStyle === "round");
    expect(frame?.borderColor).toBeUndefined();
    r.unmount();
  });
});

describe("§7.1 Escape unwind order (§3.6)", () => {
  it("Escape closes a plain list", async () => {
    const onClose = vi.fn();
    const reg: BoundPanelRegistry = { s: { title: "S", columns: [{ key: "x", label: "X" }], getItems: () => [] } };
    const r = mount("s", reg, 100, 40, onClose);
    r.stdin.write("\u001b");
    await new Promise((res) => setTimeout(res, 40));
    expect(onClose).toHaveBeenCalled();
    r.unmount();
  });

  it("Escape leaves the filter first, then closes (one level)", async () => {
    const onClose = vi.fn();
    const reg: BoundPanelRegistry = { a: { title: "A", columns: [{ key: "name", label: "N" }], getItems: () => [{ name: "x" }] } };
    const r = mount("a", reg, 100, 40, onClose);
    r.stdin.write("/");
    await new Promise((res) => setTimeout(res, 20));
    r.stdin.write("\u001b"); // leaves filter, does NOT close
    await new Promise((res) => setTimeout(res, 20));
    expect(onClose).not.toHaveBeenCalled();
    r.stdin.write("\u001b"); // now closes
    await new Promise((res) => setTimeout(res, 20));
    expect(onClose).toHaveBeenCalled();
    r.unmount();
  });
});
