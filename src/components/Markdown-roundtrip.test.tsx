/**
 * §4.3 round-trip property (cli-blueprint.md §4.3): for a corpus of markdown
 * documents, the rendered output with styles stripped, bullets/indents
 * normalised and whitespace runs collapsed EQUALS the plain text derived from
 * the source — so no space is lost and no markup marker character is ever
 * visible — at every width 30..140. Plus explicit cases for each owner defect.
 *
 * Rendered through the REAL Ink components (Markdown), the single source of
 * truth for layout (§4.1).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Markdown } from "./Markdown.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";
import { parseInline, lexMarkdown, type InlineSeg } from "../render/markdown.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const OSC8 = /\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const strip = (s: string): string => s.replace(OSC8, "").replace(ANSI, "");

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 200 });

/** The expected visible plain text of one block's inline content (no markers). */
const inlineText = (segs: InlineSeg[]): string => segs.map((s) => s.text).join("");

/** Collapse all whitespace (newlines, bullets, indents) to single spaces. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Derive the expected plain text of a whole markdown document from its token
 * tree: every block's inline text, joined, whitespace-collapsed. Code fences
 * and tables are excluded from this prose round-trip (tested separately). */
function expectedPlain(doc: string): string {
  const blocks = lexMarkdown(doc).filter((b) => b.kind !== "code" && b.kind !== "diff" && b.kind !== "table" && b.kind !== "hr");
  const parts: string[] = [];
  for (const b of blocks) {
    if ("segs" in b) {
      if (b.kind === "ordered") parts.push(`${b.marker}.`);
      parts.push(inlineText(b.segs));
    }
  }
  return norm(parts.join(" "));
}

/** Render a doc, strip styles, collapse whitespace. Code-fence and table rows
 * are dropped (box-drawing + verbatim code are not part of the prose round
 * trip); bullets are normalised away by the whitespace collapse plus removing
 * the `•` glyph. */
function renderedPlain(doc: string, cols: number): string {
  const c = caps(cols);
  const theme = resolveTheme(c);
  const r = render(<Markdown source={doc} theme={theme} caps={c} columns={cols} />);
  const frame = strip(r.lastFrame()!);
  r.unmount();
  const text = frame
    .split("\n")
    .filter((l) => !/[│┌┐└┘├┤┬┴┼]/.test(l)) // table chrome
    .filter((l) => !/^─+$/.test(l.trim())) // hr / h1 rule
    .join(" ")
    .replace(/[•]/g, " "); // bullet glyph
  return norm(text);
}

const PROSE_DOCS = [
  "is a **Node.js monorepo** (npm workspaces) with a deliberate split into **13 packages**, each exactly one of **four kinds**.",
  "the folder name *is* the future repo name; run via `npm run check:graph`, rules from `blueprint.md` §3.",
  "## The big picture (ecosystem)",
  "- `boot.ts` / `facade.ts` — startup",
  "- `entities/`, `substrate/` — domain",
  "tooling: `build-order.mjs` (ordered build), `check-package-graph.mjs`.",
  "**`@voidrift/core`** (pkgs/voidrift-core/) and **`voidrift`** (pkgs/voidrift/).",
  "see **`blueprint.md` + `*-blueprint.md`** and `*-command.ts` too.",
  "**One-way flow:** every package depends only on **libraries**.",
  "a paragraph with **bold**, *italic*, `code`, a [link](https://example.com/path), and nested **bold *and italic* mix**.",
  "escapes stay literal: a \\* b \\_ c \\` d and done.",
  "emoji 🚀 and CJK 你好世界 mixed with text that is reasonably long for wrapping checks.",
].join("\n\n");

describe("§4.3 round-trip: styles stripped & whitespace collapsed equals the token-tree plain text", () => {
  for (let cols = 30; cols <= 140; cols += 10) {
    it(`round-trips at ${cols} columns`, () => {
      expect(renderedPlain(PROSE_DOCS, cols)).toBe(expectedPlain(PROSE_DOCS));
    });
  }

  it("never leaves a markup marker character visible in rendered prose", () => {
    // The only backtick/asterisk that may legitimately appear is one produced
    // by an escape (`\\\``) or kept literal inside a code span; the whole
    // expected plain text already accounts for those, so compare to it rather
    // than forbidding the characters outright.
    for (const cols of [30, 48, 72, 100, 140]) {
      const out = renderedPlain(PROSE_DOCS, cols);
      expect(out).not.toContain("**"); // no doubled emphasis marker ever
      expect(out).not.toContain("]("); // no markdown link syntax ever
      // No backtick EXCEPT the one escaped backtick in the corpus.
      expect((out.match(/`/g) ?? []).length).toBe(1);
    }
  });
});

describe("§4.3 defect cases rendered through the component", () => {
  const render1 = (src: string, cols = 100): string => renderedPlain(src, cols);
  it("spaces are preserved around styled runs (defect 1)", () => {
    expect(render1("is a **Node.js monorepo** (npm workspaces) with a split into **13 packages**, one of **four kinds**"))
      .toBe("is a Node.js monorepo (npm workspaces) with a split into 13 packages, one of four kinds");
    expect(render1("the folder name *is* the future repo name")).toBe("the folder name is the future repo name");
    expect(render1("run via `npm run check:graph`")).toBe("run via npm run check:graph");
  });
  it("code spans inside bold and markers inside code are literal (defect 2)", () => {
    expect(render1("**`@voidrift/core`** (pkgs/voidrift-core/)")).toBe("@voidrift/core (pkgs/voidrift-core/)");
    expect(render1("**`blueprint.md` + `*-blueprint.md`**")).toBe("blueprint.md + *-blueprint.md");
    expect(render1("`*-command.ts`")).toBe("*-command.ts");
  });
});

// Guard: the token tree used by the round-trip reference is itself marker-free.
describe("§4.3 token tree is the source of truth", () => {
  it("parseInline flattens with no visible markers", () => {
    const t = parseInline("**`blueprint.md` + `*-blueprint.md`**");
    const text = t.map((s) => s.text).join("");
    expect(text).toBe("blueprint.md + *-blueprint.md");
  });
});
