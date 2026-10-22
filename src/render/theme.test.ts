/**
 * §4 render helpers — sanitization, palette, glyphs, tool display, diff
 * classification, hyperlink gating, NO_COLOR / capability fallbacks.
 */
import { describe, it, expect } from "vitest";
import {
  sanitize,
  classifyDiffLine,
  diffLineColor,
  hyperlink,
  resolveTheme,
  resolveGlyphs,
  toolDisplayName,
  toolColor,
  shortenArg,
  summarizeResult,
  wrapPrefixed,
  displayWidth,
  welcomeShowsFullBanner,
  WELCOME_FULL_MIN_COLUMNS,
} from "./theme.js";
import { detectCapabilities } from "../terminal.js";

describe("§4 sanitization", () => {
  it("strips escape introducers and C0/C1 control bytes, keeping newline and tab", () => {
    const clean = sanitize("a\x1b[31mred\x1b[0m\tb\nc\x07\x9b");
    expect(clean).not.toContain("\x1b");
    expect(clean).not.toContain("\x9b");
    expect(clean).toContain("\t");
    expect(clean).toContain("\n");
    expect(clean).toContain("red");
  });

  it("strips Unicode bidirectional overrides (Trojan Source) U+202A–202E and U+2066–2069", () => {
    // Given — the classic Trojan-Source reordering payload.
    const hostile = "safe\u202eevil\u202c";
    // When
    const clean = sanitize(hostile);
    // Then — every bidi control is gone, the visible letters survive in order.
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(sanitize(String.fromCodePoint(cp))).toBe("");
    }
    expect(clean).toBe("safeevil");
  });

  it("strips directional marks and spoofing zero-width/format characters", () => {
    for (const cp of [0x200e, 0x200f, 0x200b, 0x200c, 0x2060, 0xfeff]) {
      expect(sanitize(String.fromCodePoint(cp))).toBe("");
    }
    // An ASCII-looking identifier spoofed with a zero-width space is collapsed.
    expect(sanitize("admin\u200bistrator")).toBe("administrator");
  });

  it("keeps ZWJ (U+200D) so emoji sequences still render", () => {
    // Given — a ZWJ family emoji and a flag (regional indicators, no ZWJ) /
    // a ZWJ profession sequence.
    const family = "👨\u200d👩\u200d👧\u200d👦";
    const flag = "🇺🇸";
    const pilot = "🧑\u200d✈️";
    // When / Then — the ZWJ joiners survive intact and the emoji are unchanged.
    expect(sanitize(family)).toBe(family);
    expect(sanitize(family)).toContain("\u200d");
    expect(sanitize(flag)).toBe(flag);
    expect(sanitize(pilot)).toBe(pilot);
  });
});

describe("§4.4 tool display", () => {
  it("maps raw tool names to friendly display names and MCP labels", () => {
    expect(toolDisplayName("read_file")).toBe("Read");
    expect(toolDisplayName("workspace_map")).toBe("Map");
    expect(toolDisplayName("mcp_github_create_issue")).toBe("MCP:github:create_issue");
    expect(toolDisplayName("unknown_tool")).toBe("unknown_tool");
  });

  it("shortens the primary argument per tool", () => {
    expect(shortenArg("read_file", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(shortenArg("workspace_map", { path: "." })).toBe("(root)");
    expect(shortenArg("glob_files", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(shortenArg("search_contents", { pattern: "foo", include: "*.ts" })).toBe("foo in *.ts");
  });

  it("summarizes a result as counts, never raw content", () => {
    expect(summarizeResult("read_file", "README.md (24 lines)\n...")).toBe("24 lines");
    expect(summarizeResult("write_file", "Created new.txt (3 lines)")).toBe("wrote 3 lines");
    // Overwrite form carries a diff after the header; count still comes from the header.
    expect(summarizeResult("write_file", "Created a.txt (1 lines)\n```diff\n--- a.txt\n+++ a.txt\n-old\n+new\n```")).toBe(
      "wrote 1 lines",
    );
    // Edit: changed-line count derived from the diff, headers excluded.
    expect(
      summarizeResult("edit_file", "Edited a.txt\n```diff\n--- a.txt\n+++ a.txt\n-line one\n+LINE 1\n```"),
    ).toBe("edited 2 lines");
    expect(summarizeResult("edit_file", "Edited a.txt\n```diff\n--- a.txt\n+++ a.txt\n+added\n```")).toBe(
      "edited 1 line",
    );
    expect(summarizeResult("execute_command", "Exit code 0\nout")).toBe("exit 0");
    expect(summarizeResult("search_contents", "match")).toBe(""); // suppressed
  });

  it("§4.4 Map summary counts files and dirs from the core's raw ls output", () => {
    // Given — the core returns a newline list, directory lines ending in `/`.
    const raw = "src/\ndocs/\nREADME.md\npackage.json\ntsconfig.json";
    // When / Then — `<n> files, <n> dirs`, files first.
    expect(summarizeResult("workspace_map", raw)).toBe("3 files, 2 dirs");
    // Singular forms.
    expect(summarizeResult("workspace_map", "src/\nREADME.md")).toBe("1 file, 1 dir");
    // Files-only / dirs-only.
    expect(summarizeResult("workspace_map", "a.ts\nb.ts")).toBe("2 files");
    expect(summarizeResult("workspace_map", "a/\nb/\nc/")).toBe("3 dirs");
    // Empty directory passes the core's own line through.
    expect(summarizeResult("workspace_map", "(empty)")).toBe("(empty)");
  });

  it("§4.4 unmapped / MCP tool: first line to width, or `<n> lines` when multi-line", () => {
    // Single-line → truncated to width.
    expect(summarizeResult("mcp_x_y", "ok")).toBe("ok");
    const long = "x".repeat(100);
    expect(summarizeResult("mcp_x_y", long, 20)).toBe("x".repeat(19) + "…");
    // Multi-line → a count, never the body.
    const body = "line one\nline two\nline three";
    const s = summarizeResult("mcp_x_y", body);
    expect(s).toBe("3 lines");
    expect(s).not.toContain("line one");
    // An unmapped (non-MCP) tool follows the same rule.
    expect(summarizeResult("some_unknown_tool", "alpha\nbeta")).toBe("2 lines");
  });

  it("assigns semantic colors by tool role", () => {
    const theme = resolveTheme(detectCapabilities({ COLORTERM: "truecolor" }));
    expect(toolColor("read_file", theme)).toBe(theme.success);
    expect(toolColor("write_file", theme)).toBe(theme.info);
    expect(toolColor("execute_command", theme)).toBe(theme.warning);
    expect(toolColor("mcp_x_y", theme)).toBe(theme.accent);
  });
});

describe("§4.5 diff classification and coloring", () => {
  const theme = resolveTheme(detectCapabilities({ COLORTERM: "truecolor" }));
  it("classifies additions, deletions, hunks, and context", () => {
    expect(classifyDiffLine("+added")).toBe("add");
    expect(classifyDiffLine("-removed")).toBe("del");
    expect(classifyDiffLine("@@ -1 +1 @@")).toBe("hunk");
    expect(classifyDiffLine(" context")).toBe("context");
  });
  it("colors add green and del red; context has no color", () => {
    expect(diffLineColor("add", theme)).toBe("green");
    expect(diffLineColor("del", theme)).toBe("red");
    expect(diffLineColor("context", theme)).toBeUndefined();
  });
});

describe("§4.8 hyperlinks (OSC 8)", () => {
  const supported = detectCapabilities({ COLORTERM: "truecolor", TERM_PROGRAM: "iTerm.app" });
  const unsupported = detectCapabilities({ COLORTERM: "truecolor" });

  it("emits an OSC 8 sequence for an https link when supported", () => {
    const out = hyperlink("docs", "https://example.com", supported);
    expect(out).toContain("\x1b]8;;https://example.com");
    expect(out).toContain("docs");
  });
  it("withholds the sequence for a javascript: link, rendering plain text", () => {
    expect(hyperlink("x", "javascript:alert(1)", supported)).toBe("x");
  });
  it("renders a plain label when the terminal lacks OSC 8", () => {
    expect(hyperlink("docs", "https://example.com", unsupported)).toBe("docs");
  });

  it("emits NO file: link when workspaceRoot is undefined (C3)", () => {
    // Given — a hostile file: URL and no workspace root.
    // When / Then — plain text, never an OSC 8 file: link.
    expect(hyperlink("x", "file:///etc/passwd", supported)).toBe("x");
    expect(hyperlink("x", "file:///etc/passwd", supported, "")).toBe("x");
  });

  it("emits a file: link only when workspaceRoot contains the path", () => {
    const root = "/home/u/project";
    // Inside the workspace → clickable.
    const inside = hyperlink("f", `file://${root}/src/a.ts`, supported, root);
    expect(inside).toContain("\x1b]8;;file://");
    // Outside the workspace → plain text.
    expect(hyperlink("f", "file:///etc/passwd", supported, root)).toBe("f");
  });

  it("file: containment is by path segment — a sibling prefix is not inside (C3 LOW)", () => {
    // Given — a workspace root and a sibling dir sharing its name as a prefix.
    const root = "/root";
    // When / Then — /root-evil must NOT be treated as inside /root (raw
    // startsWith would wrongly pass it); only /root and /root/* are inside.
    expect(hyperlink("f", "file:///root-evil/x.ts", supported, root)).toBe("f");
    expect(hyperlink("f", "file:///rootx", supported, root)).toBe("f");
    expect(hyperlink("f", "file:///root/a.ts", supported, root)).toContain("\x1b]8;;file://");
    // A trailing slash on the root behaves identically.
    expect(hyperlink("f", "file:///root/a.ts", supported, "/root/")).toContain("\x1b]8;;file://");
  });

  it("refuses an http(s) target that carries userinfo (credential leak)", () => {
    // Given — an http(s) URL embedding user:pw@host.
    // When / Then — plain label only; the credential never reaches the escape.
    const a = hyperlink("site", "http://user:pw@host/", supported);
    expect(a).toBe("site");
    expect(a).not.toContain("user:pw");
    const b = hyperlink("site", "https://alice:secret@example.com/x", supported);
    expect(b).toBe("site");
    expect(b).not.toContain("secret");
  });

  it("refuses a target carrying a control/ESC byte (sequence injection)", () => {
    // Given — a well-formed scheme/host but an ESC smuggled into the path.
    // When / Then — the raw ESC never reaches the terminal; plain label only.
    const out = hyperlink("x", "https://h/a\u001b[2Jb", supported);
    expect(out).toBe("x");
    expect(out).not.toContain("\u001b[2J");
  });
});

describe("§4.9 palette and capability fallbacks", () => {
  it("resolves the 24-bit brand/accent hex palette at truecolor", () => {
    const theme = resolveTheme(detectCapabilities({ COLORTERM: "truecolor" }));
    expect(theme.brand).toBe("#6a7ec8");
    expect(theme.accent).toBe("#4ec9b0");
    expect(theme.branchColor).toBe("#00d4ff");
  });

  it("maps hex tokens to nearest named colors at ansi16", () => {
    const theme = resolveTheme(detectCapabilities({ TERM: "xterm" }));
    expect(theme.brand).toBe("blue");
    expect(theme.accent).toBe("cyan");
  });

  it("NO_COLOR forces monochrome — every palette token is undefined", () => {
    const caps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
    expect(caps.color).toBe(false);
    const theme = resolveTheme(caps);
    expect(theme.brand).toBeUndefined();
    expect(theme.success).toBeUndefined();
    // diff markers remain classifiable regardless of color.
    expect(classifyDiffLine("+x")).toBe("add");
  });

  it("TERM=dumb disables color; COLORTERM=truecolor selects 24-bit", () => {
    expect(detectCapabilities({ TERM: "dumb" }).color).toBe(false);
    expect(detectCapabilities({ COLORTERM: "truecolor" }).colorDepth).toBe("truecolor");
  });

  it("a non-UTF-8 locale selects the ASCII glyph set", () => {
    const ascii = resolveGlyphs(detectCapabilities({ LANG: "C" }));
    expect(ascii.userBar).toBe("|");
    expect(ascii.branch).toBe("branch:");
    const unicode = resolveGlyphs(detectCapabilities({ LANG: "en_US.UTF-8" }));
    expect(unicode.userBar).toBe("┃");
    expect(unicode.dot).toBe("●");
  });
});

describe("§5.1 welcome banner threshold", () => {
  it("derives the full-banner threshold with no magic number (82 columns)", () => {
    expect(WELCOME_FULL_MIN_COLUMNS).toBe(82);
  });
  it("shows the full banner only at >= the threshold", () => {
    expect(welcomeShowsFullBanner(40)).toBe(false);
    expect(welcomeShowsFullBanner(60)).toBe(false);
    expect(welcomeShowsFullBanner(81)).toBe(false);
    expect(welcomeShowsFullBanner(82)).toBe(true);
    expect(welcomeShowsFullBanner(110)).toBe(true);
    // Unknown width renders the full banner.
    expect(welcomeShowsFullBanner(undefined)).toBe(true);
  });
});

describe("§4.1 displayWidth", () => {
  it("counts ASCII as 1, CJK and emoji as 2, combining marks as 0", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("你好")).toBe(4); // two wide glyphs
    expect(displayWidth("🚀")).toBe(2); // emoji
    expect(displayWidth("e\u0301")).toBe(1); // e + combining acute
  });
});

describe("§4.1 wrapPrefixed", () => {
  const indent = 2; // `┃ ` / 2-space hanging indent

  it("never emits an orphan single character and wraps on word boundaries", () => {
    // The reproduction from the bug report: a ~112-char message at width 110.
    const msg =
      "Read package.json then explain the dependencies as a bullet list, and a code block showing the scripts section verbatim";
    const lines = wrapPrefixed(msg, 110, indent);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // Every content line fits the available width (columns - indent).
      expect(displayWidth(line)).toBeLessThanOrEqual(110 - indent);
      // No orphan: a wrapped line is never a bare single character.
      expect(line.trim().length === 1 && lines.length > 1 ? line.trim() : "ok").not.toMatch(/^[a-z]$/);
    }
    // Round-trips the words in order (no dropped/duplicated text).
    expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(msg);
  });

  it("fits every width (40/60/80/110) within columns - indent", () => {
    const msg = "the quick brown fox jumps over the lazy dog ".repeat(6).trim();
    for (const cols of [40, 60, 80, 110]) {
      const lines = wrapPrefixed(msg, cols, indent);
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(cols - indent);
      expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(msg);
    }
  });

  it("hard-breaks a word longer than the available width", () => {
    const word = "x".repeat(50);
    const lines = wrapPrefixed(word, 20, indent);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(20 - indent);
    expect(lines.join("")).toBe(word);
  });

  it("keeps CJK and emoji within the display-width budget", () => {
    const msg = "你好世界 こんにちは 🚀🚀🚀 hello world ".repeat(3).trim();
    for (const cols of [40, 60, 80, 110]) {
      const lines = wrapPrefixed(msg, cols, indent);
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(cols - indent);
    }
  });

  it("preserves hard line breaks as separate paragraphs", () => {
    const lines = wrapPrefixed("alpha\nbeta", 80, indent);
    expect(lines).toEqual(["alpha", "beta"]);
  });
});
