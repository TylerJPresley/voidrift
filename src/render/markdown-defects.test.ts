/**
 * Regression tests for the markdown rendering defects the owner screenshotted
 * (cli-blueprint.md §4.3): margin collapse, tight list fragments, CommonMark
 * flanking for inline emphasis, the bullet marker space, and the streaming
 * cursor. These drive the pure parser (`parseInline`, `closeOpenMarkers`,
 * `lexMarkdown`) and the block layout; the component-level cursor and
 * progressive==whole invariants live in the OutputPane suite.
 */
import { describe, it, expect } from "vitest";
import { parseInline, closeOpenMarkers, lexMarkdown } from "./markdown.js";

const flat = (segs: ReturnType<typeof parseInline>): string =>
  segs.map((s) => ("text" in s ? s.text : "")).join("");

describe("§4.3 inline emphasis follows CommonMark flanking rules", () => {
  it("leaves intra-word underscores (NO_COLOR, UNICODE_GLYPHS, snake_case) literal", () => {
    for (const id of ["NO_COLOR", "UNICODE_GLYPHS", "snake_case"]) {
      const segs = parseInline(`a ${id} end`);
      expect(flat(segs)).toBe(`a ${id} end`);
      expect(segs.some((s) => s.kind === "italic")).toBe(false);
    }
  });

  it("does not append a stray closing underscore for an intra-word underscore", () => {
    const segs = parseInline(`components guard each usage for colorDepth: "none".`);
    expect(flat(segs)).not.toMatch(/_$/);
    const segs2 = parseInline(`capability fallbacks for NO_COLOR don't touch rendering.`);
    expect(flat(segs2).endsWith("rendering.")).toBe(true);
    expect(flat(segs2)).not.toMatch(/_$/);
  });

  it("renders a real italic span while keeping an identifier inside it literal", () => {
    const segs = parseInline("it asserts *NO_COLOR fallbacks*.");
    const italic = segs.find((s) => s.kind === "italic");
    expect(italic).toBeDefined();
    expect((italic as { text: string }).text).toContain("NO_COLOR");
  });

  it("renders inline code as a code segment (no raw backticks) and keeps markers inside it literal", () => {
    const segs = parseInline("rendered by `PanelHost.tsx` (99 lines)");
    expect(flat(segs)).not.toContain("`");
    expect(segs.some((s) => s.kind === "code" && s.text === "PanelHost.tsx")).toBe(true);
    const segs2 = parseInline("a span `x_*y` here");
    expect(segs2.some((s) => s.kind === "code" && s.text === "x_*y")).toBe(true);
    expect(segs2.some((s) => s.kind === "italic")).toBe(false);
  });

  it("parses bold and italic in a paragraph that also contains identifiers", () => {
    const segs = parseInline("a *single generic renderer* threads NO_COLOR and **bold** too");
    expect(segs.some((s) => s.kind === "italic" && s.text.includes("single generic"))).toBe(true);
    expect(segs.some((s) => s.kind === "bold" && s.text === "bold")).toBe(true);
    expect(flat(segs)).toContain("NO_COLOR");
  });
});

describe("§4.3 closeOpenMarkers is tail-only and flanking-aware", () => {
  it("never appends a closer for an intra-word underscore (committed text)", () => {
    expect(closeOpenMarkers('colorDepth: "none".')).toBe('colorDepth: "none".');
    expect(closeOpenMarkers("fallbacks for NO_COLOR are load-bearing")).toBe(
      "fallbacks for NO_COLOR are load-bearing",
    );
  });

  it("does not scan inside an inline code span for markers", () => {
    // A lone backtick-delimited span whose content holds a `_` must not be
    // treated as an open emphasis run.
    expect(closeOpenMarkers("guard (`theme.accent ? x : {}`) here")).toBe(
      "guard (`theme.accent ? x : {}`) here",
    );
  });

  it("still closes a genuinely dangling emphasis marker on the live tail", () => {
    expect(closeOpenMarkers("a half *emphasis")).toBe("a half *emphasis*");
    const segs = parseInline(closeOpenMarkers("**foo"));
    expect(segs.some((s) => s.kind === "bold" && s.text.includes("foo"))).toBe(true);
  });
});

describe("§4.3 list fragments render as one tight list", () => {
  it("consecutive list fragments carry no inter-fragment blank — mergeable blocks", () => {
    // A list the progressive commit split on an internal blank line.
    const whole = lexMarkdown("- one\n- two\n- three");
    const frag = lexMarkdown("- one");
    const frag2 = lexMarkdown("- two\n- three");
    const whichKinds = (bs: ReturnType<typeof lexMarkdown>) => bs.map((b) => b.kind);
    expect(whichKinds(whole)).toEqual(["bullet", "bullet", "bullet"]);
    // Each fragment is itself a run of bullet blocks with no paragraph in between.
    expect(whichKinds(frag)).toEqual(["bullet"]);
    expect(whichKinds(frag2)).toEqual(["bullet", "bullet"]);
  });

  it("a bullet whose text begins with bold/inline code keeps its item text", () => {
    const [b1] = lexMarkdown("- **The theme is a prop** — threaded");
    expect(b1!.kind).toBe("bullet");
    const segs = (b1 as { segs: ReturnType<typeof parseInline> }).segs;
    expect(segs[0]).toMatchObject({ kind: "bold" });
    const [b2] = lexMarkdown("- `NO_COLOR` / fallbacks are load-bearing");
    const segs2 = (b2 as { segs: ReturnType<typeof parseInline> }).segs;
    expect(segs2[0]).toMatchObject({ kind: "code", text: "NO_COLOR" });
  });
});
