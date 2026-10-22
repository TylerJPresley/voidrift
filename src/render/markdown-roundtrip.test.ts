/**
 * §4.3 inline parsing round-trip and nesting defects (cli-blueprint.md §4.3).
 *
 * These drive the pure inline tokenizer (`parseInline`): a nested token tree
 * flattened to styled runs that PRESERVE every space and never leave a markup
 * marker character visible. The owner's screenshot showed (1) spaces lost at
 * the boundary between a plain and a styled run and (2) raw markers / broken
 * nesting (a code span inside bold, an asterisk inside a code span, a leading
 * `*` inside a code span eaten). Every case here asserts the flattened text.
 */
import { describe, it, expect } from "vitest";
import { parseInline, type InlineSeg } from "./markdown.js";

/** The full visible text of a parse: concatenate every run's literal text.
 * A link contributes its label (the URL treatment is applied at render). */
const flat = (segs: InlineSeg[]): string => segs.map((s) => s.text).join("");

describe("§4.3 inline parse preserves every space at a plain↔styled boundary", () => {
  const cases: Array<[string, string]> = [
    [
      "is a **Node.js monorepo** (npm workspaces) with a deliberate split into **13 packages**, each exactly one of **four kinds**",
      "is a Node.js monorepo (npm workspaces) with a deliberate split into 13 packages, each exactly one of four kinds",
    ],
    ["the folder name *is* the future repo name", "the folder name is the future repo name"],
    ["run via `npm run check:graph`", "run via npm run check:graph"],
    ["rules from `blueprint.md` §3", "rules from blueprint.md §3"],
    ["`boot.ts` / `facade.ts` — startup", "boot.ts / facade.ts — startup"],
    ["`entities/`, `substrate/` — domain", "entities/, substrate/ — domain"],
    [
      "tooling: `build-order.mjs` (ordered build), `check-package-graph.mjs`",
      "tooling: build-order.mjs (ordered build), check-package-graph.mjs",
    ],
    ["**One-way flow:** every package depends only on **libraries**", "One-way flow: every package depends only on libraries"],
  ];
  for (const [src, expected] of cases) {
    it(`preserves spaces: ${src.slice(0, 40)}…`, () => {
      expect(flat(parseInline(src))).toBe(expected);
    });
  }
});

describe("§4.3 inline parse nests code spans inside bold and keeps markers literal in code", () => {
  it("a code span inside bold is parsed (no raw backticks), the whole run bold", () => {
    const segs = parseInline("**`@voidrift/core`** (pkgs/voidrift-core/)");
    expect(flat(segs)).toBe("@voidrift/core (pkgs/voidrift-core/)");
    expect(flat(segs)).not.toContain("`");
    expect(segs.some((s) => s.kind === "code" && s.text === "@voidrift/core")).toBe(true);
  });

  it("an asterisk inside a code span is literal and does not break surrounding bold", () => {
    const segs = parseInline("**`blueprint.md` + `*-blueprint.md`**");
    expect(flat(segs)).toBe("blueprint.md + *-blueprint.md");
    expect(flat(segs)).not.toContain("`");
    expect(segs.some((s) => s.kind === "code" && s.text === "*-blueprint.md")).toBe(true);
    // Nothing renders as a stray asterisk outside the code span.
    expect(segs.filter((s) => s.kind === "text").every((s) => !s.text.includes("*"))).toBe(true);
  });

  it("a leading asterisk inside a code span is kept (not eaten as emphasis)", () => {
    const segs = parseInline("`*-command.ts`");
    expect(segs.some((s) => s.kind === "code" && s.text === "*-command.ts")).toBe(true);
    expect(flat(segs)).toBe("*-command.ts");
  });

  it("bold with a leading colon keeps the following space", () => {
    const segs = parseInline("**Clients never touch the core:** any package named `*-client` (the web client)");
    expect(flat(segs)).toBe("Clients never touch the core: any package named *-client (the web client)");
    expect(segs.some((s) => s.kind === "code" && s.text === "*-client")).toBe(true);
  });

  it("escapes render the literal marker character", () => {
    expect(flat(parseInline("a \\* b \\_ c \\` d"))).toBe("a * b _ c ` d");
  });

  it("italic nested inside bold flattens to a single bold+italic run text", () => {
    const segs = parseInline("**bold with *italic* inside**");
    expect(flat(segs)).toBe("bold with italic inside");
    // The nested run carries BOTH style flags (its dominant kind is bold).
    expect(segs.some((s) => s.bold && s.italic)).toBe(true);
  });
});
