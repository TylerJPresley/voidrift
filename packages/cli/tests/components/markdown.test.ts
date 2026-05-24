import { describe, it, expect } from "vitest";
import { parseMarkdownLines } from "../../src/components/markdown.tsx";

describe("parseMarkdownLines", () => {
  it("parses plain text", () => {
    const lines = parseMarkdownLines("hello world");
    expect(lines).toEqual([{ type: "text", content: "hello world" }]);
  });

  it("parses headers", () => {
    const lines = parseMarkdownLines("# Title\n## Subtitle\n### H3");
    expect(lines[0]).toEqual({ type: "header", content: "Title", level: 1 });
    expect(lines[1]).toEqual({ type: "header", content: "Subtitle", level: 2 });
    expect(lines[2]).toEqual({ type: "header", content: "H3", level: 3 });
  });

  it("parses fenced code blocks", () => {
    const lines = parseMarkdownLines("```typescript\nconst x = 1;\n```");
    expect(lines[0]).toEqual({ type: "code_start", content: "", lang: "typescript" });
    expect(lines[1]).toEqual({ type: "code_line", content: "const x = 1;" });
    expect(lines[2]).toEqual({ type: "code_end", content: "" });
  });

  it("parses unordered lists", () => {
    const lines = parseMarkdownLines("- item one\n- item two\n  - nested");
    expect(lines[0]).toEqual({ type: "list_item", content: "item one", level: 0 });
    expect(lines[1]).toEqual({ type: "list_item", content: "item two", level: 0 });
    expect(lines[2]).toEqual({ type: "list_item", content: "nested", level: 1 });
  });

  it("parses ordered lists", () => {
    const lines = parseMarkdownLines("1. first\n2. second");
    expect(lines[0]).toEqual({ type: "list_item", content: "first", level: 0 });
    expect(lines[1]).toEqual({ type: "list_item", content: "second", level: 0 });
  });

  it("handles mixed content", () => {
    const md = "# Header\n\nSome text with **bold**.\n\n```\ncode\n```\n\n- list";
    const lines = parseMarkdownLines(md);
    expect(lines[0].type).toBe("header");
    expect(lines[1].type).toBe("text"); // empty line
    expect(lines[2].type).toBe("text"); // "Some text..."
    expect(lines[3].type).toBe("text"); // empty line
    expect(lines[4].type).toBe("code_start");
    expect(lines[5].type).toBe("code_line");
    expect(lines[6].type).toBe("code_end");
    expect(lines[7].type).toBe("text"); // empty line
    expect(lines[8].type).toBe("list_item");
  });

  it("does not parse markdown inside code blocks", () => {
    const lines = parseMarkdownLines("```\n# not a header\n- not a list\n```");
    expect(lines[1]).toEqual({ type: "code_line", content: "# not a header" });
    expect(lines[2]).toEqual({ type: "code_line", content: "- not a list" });
  });
});
