/**
 * Hand-rolled markdown mapping (cli-blueprint.md §4.3).
 */
import { describe, it, expect } from "vitest";
import { lexMarkdown, parseInline, isUnifiedDiff, closeOpenMarkers } from "./markdown.js";

describe("§4.3 markdown lexing", () => {
  it("maps headings, bullets, ordered lists, code fences, hr, and tables to blocks", () => {
    const src = [
      "# Title",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "",
      "---",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const blocks = lexMarkdown(src);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("bullet");
    expect(kinds).toContain("ordered");
    expect(kinds).toContain("hr");
    expect(kinds).toContain("code");
    expect(kinds).toContain("table");
  });

  it("lexes a blockquote line to a blockquote block (§4.3)", () => {
    const blocks = lexMarkdown("> quoted line\n> second line");
    expect(blocks.every((b) => b.kind === "blockquote")).toBe(true);
    expect(blocks).toHaveLength(2);
  });

  it("tags a language on a fenced code block and routes a diff fence to a diff block", () => {
    const code = lexMarkdown("```python\nprint(1)\n```");
    expect(code[0]).toMatchObject({ kind: "code", lang: "python" });
    const diff = lexMarkdown("```diff\n+added\n-removed\n```");
    expect(diff[0]!.kind).toBe("diff");
  });

  it("renders a partial fenced block (no closing fence) as a code block in place (§4.2)", () => {
    const blocks = lexMarkdown("```ts\nconst a = 1;\nconst b =");
    expect(blocks[0]!.kind).toBe("code");
    expect((blocks[0] as { text: string }).text).toContain("const a = 1;");
  });

  it("parses a table header and rows with inline markers stripped", () => {
    const [table] = lexMarkdown("| **Name** | Val |\n| --- | --- |\n| `a` | 1 |");
    expect(table).toMatchObject({ kind: "table" });
    const t = table as { header: string[]; rows: string[][] };
    expect(t.header).toEqual(["Name", "Val"]);
    expect(t.rows[0]).toEqual(["a", "1"]);
  });

  it("splits inline bold, italic, inline code, and links into segments", () => {
    const segs = parseInline("**b** _i_ `c` [l](https://x.io)");
    const kinds = segs.map((s) => s.kind);
    expect(kinds).toContain("bold");
    expect(kinds).toContain("italic");
    expect(kinds).toContain("code");
    expect(kinds).toContain("link");
    const link = segs.find((s) => s.kind === "link");
    expect(link).toMatchObject({ text: "l", url: "https://x.io" });
  });

  it("sanitizes escape sequences inside markdown text", () => {
    const blocks = lexMarkdown("plain \x1b[31mred\x1b[0m text");
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("\u001b");
    expect(flat).toContain("red");
  });

  it("isUnifiedDiff recognizes an unfenced unified diff", () => {
    expect(isUnifiedDiff("--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y")).toBe(true);
    expect(isUnifiedDiff("just prose with a - dash")).toBe(false);
  });
});

describe("§4.3 streaming safety: unterminated markers never leak raw", () => {
  const partials: Array<[string, string]> = [
    ["dangling bold", "**Current state (as of the handoff"],
    ["dangling italic", "a half *emphasis"],
    ["dangling code", "run `npm test"],
    ["dangling link", "see [the docs]("],
    ["dangling link label", "see [the do"],
  ];
  for (const [label, src] of partials) {
    it(`closes a ${label} so no raw marker shows`, () => {
      const closed = closeOpenMarkers(src);
      // The closed text parses into segments with no literal marker runs left.
      const segs = parseInline(closed);
      const flat = segs.map((s) => ("text" in s ? s.text : "")).join("");
      expect(flat).not.toMatch(/\*\*|`|\]\(/);
      // No segment renders a leading/trailing `**` or backtick as literal text.
      for (const seg of segs) {
        if (seg.kind === "text") expect(seg.text).not.toMatch(/\*\*|`$|^`/);
      }
    });
  }

  it("leaves balanced markers intact", () => {
    expect(closeOpenMarkers("**bold** and `code`")).toBe("**bold** and `code`");
  });

  it("an open fence in partial text still renders as a code block, not raw backticks", () => {
    const blocks = lexMarkdown("intro\n\n```ts\nconst a = 1;");
    expect(blocks.some((b) => b.kind === "code")).toBe(true);
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("```");
  });

  it("a partial stream ending in `**foo` renders bold text, not the raw `**`", () => {
    const segs = parseInline(closeOpenMarkers("**foo"));
    expect(segs.some((s) => s.kind === "bold" && s.text.includes("foo"))).toBe(true);
  });
});
