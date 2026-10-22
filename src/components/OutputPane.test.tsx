/**
 * §5.2 footer spacing and §4.4 tool-call indent, rendered through the real
 * OutputPane + InputBar composition (cli-blueprint.md §5.2, §4.4). The App's
 * bottom region is `OutputPane` then `InputBar`; exactly one blank row separates
 * the output region (streaming or committed) from the input region (the
 * `working… (esc to cancel)` status line while a turn runs, the `❯` prompt when
 * idle), with no extra blank rows and the gap never doubled with an existing
 * `<Static>` item margin.
 */
import React from "react";
import { Box } from "ink";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { OutputPane } from "./OutputPane.js";
import { InputBar, type InputBarProps } from "./InputBar.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { reduce, pushUser, initialState, blockLines, blockLineCount, type ViewState } from "../state.js";

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 40 });

/** The App's real bottom region: output pane directly above the input bar. */
function BottomRegion({ state, cols, turnActive }: { state: ViewState; cols: number; turnActive: boolean }): React.ReactElement {
  const theme = resolveTheme(caps(cols));
  const glyphs = resolveGlyphs(caps(cols));
  const ib: InputBarProps = {
    value: "",
    cursor: 0,
    active: true,
    turnActive,
    pendingCtrlC: false,
    autocompleteOpen: false,
    candidates: [],
    candidateCursor: 0,
    theme,
    placeholder: "ask a question or describe a task",
    onKey: () => {},
  };
  return (
    <Box flexDirection="column">
      <OutputPane state={state} theme={theme} glyphs={glyphs} caps={caps(cols)} reduceMotion columns={cols} />
      <InputBar {...ib} />
    </Box>
  );
}

/** The 0-based index of the first line matching `needle`. */
function indexOf(lines: string[], needle: string): number {
  return lines.findIndex((l) => l.includes(needle));
}

describe("§5.2 one blank row separates the output region from the input region", () => {
  for (const cols of [100, 60]) {
    it(`buffered: streamed text never renders; one blank row above the working line (${cols} cols)`, () => {
      let s = pushUser(initialState(5000), "list the modes");
      s = reduce(s, {
        type: "token",
        token: "• Agents/modes — switch between chat (full tools), research",
      });
      const r = render(<BottomRegion state={s} cols={cols} turnActive />);
      const lines = r.lastFrame()!.split("\n");
      // The hidden buffer is NEVER rendered live — nothing flashes.
      expect(indexOf(lines, "Agents/modes")).toBe(-1);
      const workingIdx = indexOf(lines, "working… (esc to cancel)");
      expect(workingIdx).toBeGreaterThan(0);
      // Exactly one blank row immediately above the working line.
      expect(lines[workingIdx - 1]!.trim()).toBe("");
      r.unmount();
    });

    it(`a blank row sits between committed output and the idle prompt, not doubled (${cols} cols)`, () => {
      let s = pushUser(initialState(5000), "hi");
      s = reduce(s, {
        type: "turn_complete",
        status: "completed",
        text: "hello world",
        usage: { promptTokens: 1, completionTokens: 1, totalMs: 10 },
      });
      const r = render(<BottomRegion state={s} cols={cols} turnActive={false} />);
      const lines = r.lastFrame()!.split("\n");
      const promptIdx = indexOf(lines, "❯");
      expect(promptIdx).toBeGreaterThan(0);
      // The prompt is preceded by exactly one blank row (the Static item margin);
      // the row above that is real content, so the gap is never doubled.
      expect(lines[promptIdx - 1]!.trim()).toBe("");
      expect(lines[promptIdx - 2]!.trim()).not.toBe("");
      r.unmount();
    });

    it(`a blank row sits between a live running tool group and the working line (${cols} cols)`, () => {
      let s = pushUser(initialState(5000), "read it");
      s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "AGENTS.md" } });
      const r = render(<BottomRegion state={s} cols={cols} turnActive />);
      const lines = r.lastFrame()!.split("\n");
      const workingIdx = indexOf(lines, "working… (esc to cancel)");
      expect(workingIdx).toBeGreaterThan(0);
      expect(lines[workingIdx - 1]!.trim()).toBe("");
      expect(lines[workingIdx - 2]!.trim()).not.toBe("");
      r.unmount();
    });

    it(`the scrolled-history idle state also gets one blank row above the prompt (${cols} cols)`, () => {
      // Build enough committed history to scroll, then render scrolled back and
      // idle. §5.2 — the ScrollView has no Static item margin, so the output pane
      // must supply the one separating blank row (no exemption for scrolled).
      let s = pushUser(initialState(5000), "hi");
      for (let i = 0; i < 6; i++) {
        s = reduce(s, {
          type: "turn_complete",
          status: "completed",
          text: `reply line ${i} with some content`,
          usage: { promptTokens: 1, completionTokens: 1, totalMs: 10 },
        });
      }
      const theme = resolveTheme(caps(cols));
      const glyphs = resolveGlyphs(caps(cols));
      const ib: InputBarProps = {
        value: "", cursor: 0, active: true, turnActive: false, pendingCtrlC: false,
        autocompleteOpen: false, candidates: [], candidateCursor: 0, theme,
        placeholder: "ask", onKey: () => {},
      };
      const r = render(
        <Box flexDirection="column">
          <OutputPane
            state={s}
            theme={theme}
            glyphs={glyphs}
            caps={caps(cols)}
            reduceMotion
            columns={cols}
            scroll={{ offset: 3, height: 4, baseline: s.blocks.length }}
          />
          <InputBar {...ib} />
        </Box>,
      );
      const lines = r.lastFrame()!.split("\n");
      const promptIdx = indexOf(lines, "❯");
      expect(promptIdx).toBeGreaterThan(0);
      // Exactly one blank row immediately above the prompt; real content above it.
      expect(lines[promptIdx - 1]!.trim()).toBe("");
      expect(lines[promptIdx - 2]!.trim()).not.toBe("");
      r.unmount();
    });
  }
});

describe("§4.2 a running tool round draws no rows — only the single status line", () => {
  for (const cols of [100, 60]) {
    it(`no group header, no call row, only the status verb (${cols} cols)`, () => {
      let s = pushUser(initialState(5000), "read it");
      s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "AGENTS.md" } });
      const theme = resolveTheme(caps(cols));
      const glyphs = resolveGlyphs(caps(cols));
      const r = render(
        <OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(cols)} reduceMotion columns={cols} />,
      );
      const frame = r.lastFrame()!;
      // No tool-call group header and no per-call row while the round runs.
      expect(frame).not.toContain("tool call");
      expect(frame).not.toContain("●");
      // The single dynamic-region status line shows the running verb with its
      // target (§4.2), not a committed call row.
      expect(frame).toContain("Reading AGENTS.md");
      r.unmount();
    });
  }
});

describe("§1.4/§4.2 buffered rendering and §4.10 scroll (Ink render)", () => {
  // A scripted ~150-line reply: prose blocks, a fenced code block, and a table.
  function longReply(): string {
    const parts: string[] = [];
    parts.push("# Report heading");
    for (let i = 0; i < 40; i++) parts.push(`Paragraph number ${i} with a little body text to fill a line.`);
    parts.push("```js\n" + Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};`).join("\n") + "\n```");
    parts.push("| name | value |\n| ---- | ----- |\n" + Array.from({ length: 20 }, (_, i) => `| row${i} | ${i} |`).join("\n"));
    for (let i = 0; i < 40; i++) parts.push(`Trailing paragraph ${i} after the table block.`);
    return parts.join("\n\n");
  }

  /** Feed a reply through the reducer in small token chunks (done=false: the
   * message segment stays open until turn_complete). */
  function stream(s: ViewState, text: string, size = 8): ViewState {
    for (let i = 0; i < text.length; i += size) {
      s = reduce(s, { type: "token", token: text.slice(i, i + size), done: false });
    }
    return s;
  }

  const theme = resolveTheme(caps(100));
  const glyphs = resolveGlyphs(caps(100));

  function renderPane(state: ViewState, scroll?: { offset: number; height: number; baseline: number }) {
    return render(
      <OutputPane
        state={state}
        theme={theme}
        glyphs={glyphs}
        caps={caps(100)}
        reduceMotion
        columns={100}
        {...(scroll ? { scroll } : {})}
      />,
    );
  }

  it("a 300-token stream renders ZERO frames containing partial assistant text; exactly one commit on completion", () => {
    // 300 one-char tokens accumulate in the hidden buffer. Rendering is costly,
    // so sample the pane at several points through the stream and assert NO
    // sampled frame contains the buffered assistant text; the reducer invariant
    // (no committed assistant block while streaming) covers every token.
    const reply = "A".repeat(300);
    let s = pushUser(initialState(5000), "report");
    let framesWithPartial = 0;
    for (let i = 1; i <= reply.length; i++) {
      s = reduce(s, { type: "token", token: "A", done: false });
      // No assistant block is ever committed while the message buffers.
      expect(s.blocks.filter((b) => b.kind === "assistant")).toHaveLength(0);
      // Sample a frame every 50 tokens (7 renders, not 300).
      if (i % 50 === 0 || i === reply.length) {
        const r = renderPane(s);
        if ((r.lastFrame() ?? "").includes("AAAA")) framesWithPartial++;
        r.unmount();
      }
    }
    expect(framesWithPartial).toBe(0);
    s = reduce(s, { type: "turn_complete", status: "completed", text: reply, usage: { promptTokens: 1, completionTokens: 75, totalMs: 100 } });
    const committed = s.blocks.filter((b) => b.kind === "assistant");
    expect(committed).toHaveLength(1); // exactly one commit of the full segment
    const r = renderPane(s);
    expect(r.lastFrame()!).toContain("AAAA");
    r.unmount();
  });

  it("the status line updates (verb/elapsed/tokens) without committing any history", () => {
    let s = pushUser(initialState(5000), "report");
    s = stream(s, "some buffered text", 4);
    const before = s.blocks.length;
    // A context-budget update and more tokens change the status line but never
    // touch the committed history (Static).
    s = reduce(s, { type: "context_budget", percentage: 12 });
    s = stream(s, " and more", 4);
    expect(s.blocks.length).toBe(before); // no new committed block from streaming
    const r = renderPane(s);
    expect(r.lastFrame()!).toContain("Responding");
    r.unmount();
  });

  it("assistant text before a tool call commits BEFORE the tool group (one blank row apart)", () => {
    let s = pushUser(initialState(5000), "report");
    s = stream(s, "Looking into it.", 4);
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 5, summary: "(2 lines)" });
    s = reduce(s, { type: "turn_complete", status: "completed", text: "Done.", usage: { promptTokens: 1, completionTokens: 2, totalMs: 10 } });
    const kinds = s.blocks.map((b) => b.kind);
    // user, assistant (pre-tool), toolgroup, assistant (final).
    expect(kinds).toEqual(["user", "assistant", "toolgroup", "assistant"]);
    const r = renderPane(s);
    const frame = r.lastFrame()!;
    expect(frame).toContain("Looking into it.");
    expect(frame).toContain("Done.");
    r.unmount();
  });

  it("the committed reply renders identically whether streamed or committed whole (golden)", () => {
    const reply = longReply();
    let prog = pushUser(initialState(5000), "report");
    prog = stream(prog, reply, 8);
    prog = reduce(prog, { type: "turn_complete", status: "completed", text: reply, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    let whole = pushUser(initialState(5000), "report");
    whole = reduce(whole, { type: "turn_complete", status: "completed", text: reply, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    expect(blockLines(prog.blocks)).toEqual(blockLines(whole.blocks));
  });

  it("cancel mid-stream commits the buffered tail once with the cancelled marker", () => {
    const reply = longReply();
    let s = pushUser(initialState(5000), "report");
    const cut = Math.floor(reply.length * 0.4);
    for (let i = 0; i < cut; i += 8) s = reduce(s, { type: "token", token: reply.slice(i, i + 8), done: false });
    const tail = s.streaming;
    s = reduce(s, { type: "turn_cancelled" });
    const committed = s.blocks.filter((b): b is Extract<ViewState["blocks"][number], { kind: "assistant" }> => b.kind === "assistant");
    expect(committed).toHaveLength(1);
    expect(committed[0]!.text).toBe(tail);
    expect(committed[0]!.cancelled).toBe(true);
    const r = renderPane(s);
    expect(r.lastFrame()!).toContain("cancelled");
    r.unmount();
  });

  it("PageUp after a committed segment shows earlier committed lines of the reply", () => {
    const reply = longReply();
    let s = pushUser(initialState(5000), "report");
    s = stream(s, reply, 8);
    s = reduce(s, { type: "turn_complete", status: "completed", text: reply, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    const totalLines = blockLineCount(s.blocks);
    const r = renderPane(s, { offset: Math.max(1, totalLines - 6), height: 8, baseline: totalLines });
    expect(r.lastFrame()!).toContain("Report heading");
    r.unmount();
  });

  it("the scrolled indicator counts display LINES below the window and names End", () => {
    const reply = longReply();
    let s = pushUser(initialState(5000), "report");
    s = reduce(s, { type: "turn_complete", status: "completed", text: "First short reply.", usage: { promptTokens: 1, completionTokens: 2, totalMs: 10 } });
    const baseline = blockLineCount(s.blocks);
    s = pushUser(s, "again");
    s = stream(s, reply, 8);
    s = reduce(s, { type: "turn_complete", status: "completed", text: reply, usage: { promptTokens: 1, completionTokens: 9, totalMs: 100 } });
    const r = renderPane(s, { offset: 20, height: 6, baseline });
    const frame = r.lastFrame()!;
    expect(frame).toMatch(/↓ \d+ new lines · End to jump/);
    const m = frame.match(/↓ (\d+) new lines/);
    expect(Number(m![1])).toBeGreaterThan(6);
    r.unmount();
  });
});

describe("§4.2/§4.4 a fan-out REPLACES the status line with the live panel (no duplicate header)", () => {
  // The two qualifying fan-out shapes (cli-blueprint §4.2 ~l.717): a single
  // batch-form `task` call of ≥ 2 tasks, and ≥ 2 separate `task` calls. In both,
  // the OutputPane must render the panel header `● Orchestrating (N agents)` and
  // NO StatusLine row — no `Orchestrating N agents` verb and no spinner row.
  const shapes: Array<[string, () => ViewState, number]> = [
    [
      "batch form",
      () =>
        reduce(pushUser(initialState(5000), "go"), {
          type: "tool_started",
          id: "t1",
          name: "task",
          args: {
            tasks: [
              { id: "a", worker: "researcher", task: "survey" },
              { id: "b", worker: "planner", task: "plan" },
              { id: "c", worker: "implementer", task: "code" },
            ],
          },
        }),
      3,
    ],
    [
      "separate-call form",
      () => {
        let s = reduce(pushUser(initialState(5000), "go"), { type: "tool_started", id: "a", name: "task", args: { worker: "researcher", task: "survey" } });
        s = reduce(s, { type: "tool_started", id: "b", name: "task", args: { worker: "planner", task: "plan" } });
        return s;
      },
      2,
    ],
  ];

  for (const [label, build, n] of shapes) {
    it(`${label}: panel header renders and no StatusLine row is drawn`, () => {
      const s = build();
      expect(s.fanout?.rows.length).toBe(n);
      const theme = resolveTheme(caps(100));
      const glyphs = resolveGlyphs(caps(100));
      const r = render(<OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(100)} reduceMotion columns={100} />);
      const frame = r.lastFrame()!;
      // The live panel's own header is present.
      expect(frame).toContain(`● Orchestrating (${n} agents)`);
      // The StatusLine verb is gone (statusLine() returns null during the panel),
      // so the bare `Orchestrating N agents` status row never appears...
      expect(frame).not.toContain(`Orchestrating ${n} agents`);
      // ...and no braille spinner row is drawn either (reduceMotion off to be sure).
      const r2 = render(<OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(100)} reduceMotion={false} columns={100} />);
      expect(r2.lastFrame()!).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
      r2.unmount();
      r.unmount();
    });
  }
});
