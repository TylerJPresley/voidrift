/**
 * Security regression (audit C1): every CLI component that renders text
 * originating OUTSIDE the CLI — model output, tool names/args/summaries, MCP
 * data, file paths, plugin/panel data, git branch, session fields — must route
 * that text through `sanitize()` before it reaches a `<Text>`. If it does not,
 * a hostile string can inject a terminal escape (cursor move, OSC 52 clipboard
 * write) or a Unicode bidirectional override (Trojan Source) and the rendered
 * frame will contain a forbidden code point.
 *
 * This is the enumeration test the audit asked for: a table of the rendered
 * components, each fed the same hostile payload. It fails if a NEW component
 * renders unsanitized external text (add it here with its hostile props).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar, Welcome, ResumeLine } from "./Footer.js";
import { ToolGroup, StatusLine, ReasoningView } from "./ToolGroup.js";
import { AgentMonitor } from "./AgentMonitor.js";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import { FanoutApproval } from "./FanoutApproval.js";
import { PanelHost } from "./PanelHost.js";
import { OutputPane } from "./OutputPane.js";
import { Markdown } from "./Markdown.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { initialState, reduce, pushUser, type ViewState } from "../state.js";
import type { BoundPanelRegistry } from "../panels/types.js";
import type { Block } from "../state.js";

const caps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
const theme = resolveTheme(caps);
const glyphs = resolveGlyphs(caps);

/**
 * A payload with one representative of every class `sanitize()` must strip:
 * ESC/CSI escape introducer, OSC 52 clipboard write, raw C1 byte, a bidi
 * override pair (Trojan Source), directional marks, and spoofing zero-width
 * characters. The visible marker `EVIL` survives; the forbidden bytes must not.
 */
const H = "\x1b[31mEVIL\x1b]52;c;aGk=\x07\x9b\u202eflip\u202c\u200e\u200f\u200b\u2060\ufeff";

/**
 * The code points no rendered frame may contain once Ink's own SGR styling is
 * stripped. Ink legitimately emits `\x1b[...m` SGR sequences for bold/inverse/
 * italic even with NO_COLOR, so those are removed first; anything left is data.
 * The forbidden set is the bidi overrides, directional marks, spoofing
 * zero-width/format characters, the raw C1 introducer (0x9b), and BEL (0x07) —
 * none of which Ink ever emits as styling.
 */
const FORBIDDEN = [
  0x07, 0x9b, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e,
  0x200f, 0x200b, 0x200c, 0x2060, 0xfeff,
];

// Standard ANSI escape-sequence matcher (CSI SGR + OSC); strips Ink's styling.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function assertClean(frame: string | undefined): void {
  const stripped = (frame ?? "").replace(ANSI, "");
  // After stripping legitimate SGR, no raw ESC may remain (any residual ESC is
  // an injected sequence that sanitize failed to remove).
  expect.soft(stripped.includes("\x1b"), "frame contains a residual ESC after SGR strip").toBe(false);
  const codes = new Set([...stripped].map((c) => c.codePointAt(0)!));
  for (const cp of FORBIDDEN) {
    expect.soft(codes.has(cp), `frame contains forbidden U+${cp.toString(16)}`).toBe(false);
  }
}

const panels: BoundPanelRegistry = {
  tools: {
    title: H,
    columns: [
      { key: "name", label: H, width: 20 },
      { key: "description", label: "Description" },
    ],
    getItems: () => [{ name: H, description: H }],
  },
};

const approval = {
  id: "a1",
  tool: H,
  args: { path: H, command: H },
  choices: ["approve", "reject"] as const,
  rememberable: true,
  inferredPatterns: [H],
  diff: undefined,
} as unknown as import("@voidrift/core").PendingApproval;

const toolBlock: Extract<Block, { kind: "toolgroup" }> = {
  kind: "toolgroup",
  calls: [
    {
      id: "t1",
      name: H,
      args: { path: H },
      status: "failed",
      summary: H,
      durationMs: 1200,
    },
  ],
} as unknown as Extract<Block, { kind: "toolgroup" }>;

// The enumeration table: component → the props carrying hostile external text.
const cases: Array<[string, React.ReactElement]> = [
  ["StatusBar", <StatusBar state={{ ...initialState(1000), model: H, branch: H }} workspaceRoot={H} width={120} theme={theme} glyphs={glyphs} />],
  ["Welcome", <Welcome version={H} workspaceRoot={H} sessionId={H} branch={H} showTips theme={theme} glyphs={glyphs} />],
  ["ResumeLine", <ResumeLine summary={H} theme={theme} glyphs={glyphs} />],
  ["ToolGroup", <ToolGroup block={toolBlock} glyphs={glyphs} theme={theme} />],
  ["StatusLine", <StatusLine state={{ ...initialState(1000), turnStartedAt: Date.now(), tools: [{ id: "t", name: H, args: {} }] } as never} theme={theme} reduceMotion />],
  ["ReasoningView", <ReasoningView reasoning={H} expanded theme={theme} />],
  ["Markdown", <Markdown source={H} theme={theme} caps={caps} />],
  ["AgentMonitor", <AgentMonitor workers={[{ workerId: H, status: "running" as never, tool: H } as never]} selected={0} streamLines={[{ workerId: H, text: H }]} onSelect={() => {}} onResolve={() => {}} onClose={() => {}} theme={theme} glyphs={glyphs} />],
  ["ConfirmationDialog", <ConfirmationDialog request={approval} onResolve={() => {}} theme={theme} glyphs={glyphs} />],
  ["FanoutApproval", <FanoutApproval pending={[approval]} onChoice={() => {}} theme={theme} glyphs={glyphs} />],
  ["PanelHost", <PanelHost name="tools" registry={panels} onClose={() => {}} theme={theme} glyphs={glyphs} columns={80} rows={24} />],
];

describe("C1 — external text is sanitized in every rendering component", () => {
  for (const [name, element] of cases) {
    it(`${name} strips control bytes and bidi overrides from external text`, () => {
      const { lastFrame, unmount } = render(element);
      assertClean(lastFrame());
      unmount();
    });
  }

  it("OutputPane strips external text across welcome/user/assistant/tool/info blocks", () => {
    // Build a view state carrying hostile text in every block variety.
    let s: ViewState = initialState(1000);
    s = pushUser(s, H);
    s = reduce(s, { type: "token", token: H, done: false } as never);
    s = reduce(s, { type: "token", token: "", done: true } as never);
    s = reduce(s, { type: "turn_complete", text: H, usage: { promptTokens: 1, completionTokens: 1, totalMs: 1000 } } as never);
    s = reduce(s, { type: "warning", message: H } as never);
    const { lastFrame, unmount } = render(
      <OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps} reduceMotion workspaceRoot={H} columns={120} />,
    );
    assertClean(lastFrame());
    unmount();
  });

  it("OutputPane strips a hostile limit_reached notice (U+202E, ESC sequences) from the step-limit info block", () => {
    // §4.7 — a `limit_reached` turn appends the step-limit notice from the event
    // payload. A hostile `notice` carrying a bidi override and ESC/OSC sequences
    // must be sanitized before it reaches the rendered info block.
    let s: ViewState = initialState(1000);
    s = pushUser(s, "please do the thing");
    s = reduce(
      s,
      { type: "turn_complete", status: "limit_reached", text: H, notice: H, usage: { promptTokens: 1, completionTokens: 1, totalMs: 1000 } } as never,
    );
    const { lastFrame, unmount } = render(
      <OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps} reduceMotion workspaceRoot={H} columns={120} />,
    );
    assertClean(lastFrame());
    unmount();
  });
});
