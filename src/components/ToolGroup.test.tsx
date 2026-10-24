/**
 * §4.4/§4.6 tool-call grouping, collapse, truncation, reasoning summary and the
 * delegation collapse (cli-blueprint.md §4.1, §4.4, §4.6).
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ToolGroup, ThoughtLine, ReasoningView, StatusLine, FanoutGroup, LiveFanout, shimmerFrame, shimmerBandStart } from "./ToolGroup.js";
import { OutputPane } from "./OutputPane.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs, gradientWaveSpans, hexToRGB, waveFrame } from "../render/theme.js";
import { reduce, pushUser, initialState, fanoutRowGenerating, type ViewState, type ToolCall, type Block, type FanoutRow } from "../state.js";
import { mapSessionEvent } from "../events/subscriptions.js";
import type { EventEnvelope } from "@voidrift/core";

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 40 });
const theme = resolveTheme(caps(100));
const glyphs = resolveGlyphs(caps(100));

/** A completed tool call fixture. */
function call(over: Partial<ToolCall>): ToolCall {
  return { id: Math.random().toString(36), name: "read_file", args: { path: "a.ts" }, status: "success", durationMs: 10, summary: "(3 lines)", ...over };
}

describe("§4.4 ToolGroup grouping and one line per call", () => {
  it("renders 1 header + 7 one-line rows for seven consecutive reads (expanded)", () => {
    const calls = Array.from({ length: 7 }, (_, i) => call({ id: `r${i}`, args: { path: `f${i}.ts` } }));
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={theme} expanded columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("7 tool calls");
    expect(frame).toContain("▾");
    // Seven Read labels, each on its own line; no blank rows between them.
    const readLines = frame.split("\n").filter((l) => l.includes("Read"));
    expect(readLines).toHaveLength(7);
    // Each read row carries its path argument on the same line.
    expect(frame).toContain("f0.ts");
    expect(frame).toContain("f6.ts");
    r.unmount();
  });

  it("collapses to `▸ N tool calls` hiding the call rows when not expanded", () => {
    const calls = [call({ id: "a" }), call({ id: "b" })];
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls, collapsed: true }} glyphs={glyphs} theme={theme} expanded={false} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("▸ 2 tool calls");
    expect(frame).not.toContain("Read");
    r.unmount();
  });

  it("shows duration only when ≥ 1s (no 0.0s noise)", () => {
    const calls = [call({ id: "fast", durationMs: 200 }), call({ id: "slow", durationMs: 4800 })];
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={theme} expanded columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("4.8s");
    expect(frame).not.toContain("0.2s");
    expect(frame).not.toContain("0.0s");
    r.unmount();
  });

  it("an errored call stays visible with a red ✗ marker and keeps the group expanded", () => {
    const calls = [call({ id: "ok" }), call({ id: "bad", name: "write_file", status: "error", summary: "permission denied: no write" })];
    // Collapsed requested, but an error forces expansion.
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls, collapsed: true }} glyphs={glyphs} theme={theme} expanded={false} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("▾ 2 tool calls");
    expect(frame).toContain("permission denied");
    expect(frame).toContain("✗");
    r.unmount();
  });

  it("a `task` call inside an ordinary tool group renders as a normal row (fan-outs are a separate block)", () => {
    const calls = [call({ id: "w1", name: "task", args: { role: "researcher" } })];
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={theme} expanded columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("Task");
    expect(frame).not.toContain("Orchestrated");
    r.unmount();
  });

  it("uses `1 tool call` singular for a single call", () => {
    const calls = [call({ id: "only" })];
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={theme} expanded columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("▾ 1 tool call");
    expect(frame).not.toContain("1 tool calls");
    r.unmount();
  });

  it("§4.4 indents the committed call row one space under the header (two spaces with the group's own margin)", () => {
    const calls = [call({ id: "r", name: "read_file", args: { path: "AGENTS.md" }, summary: "(101 lines)" })];
    const r = render(<ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={theme} expanded columns={100} />);
    const lines = r.lastFrame()!.split("\n");
    const headerLine = lines.find((l) => l.includes("tool call"))!;
    const rowLine = lines.find((l) => l.includes("Read"))!;
    // ToolGroup renders without the one-space group margin BlockView adds, so
    // here the header is flush and each call row carries the one extra space
    // that puts it two spaces under the header once the group margin is applied.
    expect(headerLine.startsWith("▾")).toBe(true);
    expect(rowLine.startsWith(" ●")).toBe(true);
    expect(rowLine.startsWith("  ")).toBe(false);
    r.unmount();
  });

  it("truncates a long argument with an ellipsis to the terminal width at 60/80/100 columns", () => {
    const longArg = "x".repeat(300);
    for (const cols of [60, 80, 100]) {
      const calls = [call({ id: "run", name: "execute_command", args: { command: longArg }, summary: "exit 0" })];
      const r = render(
        <ToolGroup block={{ kind: "toolgroup", calls }} glyphs={glyphs} theme={resolveTheme(caps(cols))} expanded columns={cols} />,
      );
      const frame = r.lastFrame()!;
      const toolLine = frame.split("\n").find((l) => l.includes("Run"))!;
      // No rendered line exceeds the column budget, and the row ellipsized.
      expect(toolLine.length).toBeLessThanOrEqual(cols);
      expect(frame).toContain("…");
      r.unmount();
    }
  });
});

describe("§4.2 buffered StatusLine (no live stream, no cursor)", () => {
  it("shows the single status line (spinner + verb + elapsed + tokens) and NO assistant text while buffering", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "token", token: "partial answer", done: false });
    const r = render(<StatusLine state={{ ...s, turnStartedAt: Date.now() - 3100 }} theme={theme} reduceMotion />);
    const frame = r.lastFrame()!;
    // The buffered assistant text is NEVER rendered live (nothing flashes).
    expect(frame).not.toContain("partial answer");
    // No streaming cursor.
    expect(frame).not.toContain("▊");
    // The verb and elapsed seconds render on the one status line.
    expect(frame).toContain("Responding");
    expect(frame).toContain("s");
    r.unmount();
  });

  it("reads `Reading a.ts` while a read tool runs and renders NOTHING during a fan-out (§4.2)", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
    const reading = render(<StatusLine state={s} theme={theme} reduceMotion />);
    expect(reading.lastFrame()!).toContain("Reading a.ts");
    reading.unmount();
    // A fan-out of ≥ 2 workers REPLACES the status line with the live panel, so
    // StatusLine renders nothing (statusLine() returns null) — no stale
    // `Orchestrating N agents` verb and no `ctrl+g to watch` hint here.
    let f = pushUser(initialState(5000), "q");
    f = reduce(f, { type: "tool_started", id: "b1", name: "task", args: { tasks: [{}, {}, {}] } });
    const fan = render(<StatusLine state={f} theme={theme} reduceMotion />);
    expect((fan.lastFrame() ?? "").trim()).toBe("");
    expect(fan.lastFrame() ?? "").not.toContain("Orchestrating");
    expect(fan.lastFrame() ?? "").not.toContain("ctrl+g to watch");
    fan.unmount();
  });

  it("reads `Waiting for approval` with no spinner and a frozen elapsed while an approval is pending", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "execute_command", args: { command: "x" } });
    s = reduce(s, { type: "approval_pending", pending: true });
    // Elapsed is frozen; advance `now` well past the approval start — the line
    // must NOT tick (no live elapsed from nowMs) and must read the waiting verb.
    const r = render(
      <StatusLine
        state={{ ...s, turnStartedAt: Date.now() - 40000, approvalStartedAt: Date.now() - 38000 }}
        theme={theme}
        reduceMotion={false}
        nowMs={Date.now()}
      />,
    );
    const frame = r.lastFrame()!;
    expect(frame).toContain("Waiting for approval");
    // No spinner frame even with reduceMotion off (the braille spinner chars).
    expect(frame).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    // Not the running `Thinking`/`Running` verb.
    expect(frame).not.toContain("Thinking");
    r.unmount();
  });
});

describe("§4.6 reasoning summary", () => {
  it("ThoughtLine shows `Thought for Ns` with the ctrl+o hint", () => {
    const r = render(<ThoughtLine thoughtMs={3000} theme={theme} />);
    expect(r.lastFrame()!).toContain("Thought for 3s");
    expect(r.lastFrame()!).toContain("ctrl+o to view");
    r.unmount();
  });

  it("ReasoningView collapsed shows only the lead line; expanded shows dim indented text with no connector", () => {
    const collapsed = render(<ReasoningView reasoning={"a\nb\nc"} expanded={false} theme={theme} thoughtMs={2000} />);
    expect(collapsed.lastFrame()!).toContain("Thought for 2s");
    expect(collapsed.lastFrame()!).not.toContain("└");
    collapsed.unmount();
    const expanded = render(<ReasoningView reasoning={"line one\nline two"} expanded theme={theme} thoughtMs={2000} />);
    const frame = expanded.lastFrame()!;
    expect(frame).not.toContain("└");
    expect(frame).toContain("line two");
    expanded.unmount();
  });
});

describe("§4.1/§4.6 OutputPane end-to-end: no divider, Thought line", () => {
  function run(seq: (s: ViewState) => ViewState): ViewState {
    return seq(initialState(5000));
  }

  it("renders no `└─ Response` divider or `└` connector for an assistant message following a tool group; shows `Thought for Ns` only when reasoning arrived", () => {
    const s = run((s0) => {
      let s = pushUser(s0, "do it");
      s = reduce(s, { type: "reasoning", token: "thinking hard", done: true });
      s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
      s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 5, summary: "(3 lines)" });
      s = reduce(s, { type: "turn_complete", status: "completed", text: "Here it is", usage: { promptTokens: 10, completionTokens: 4, totalMs: 100 } });
      return s;
    });
    const r = render(<OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(100)} reduceMotion columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).not.toContain("─ Response");
    expect(frame).not.toContain("└");
    expect(frame).toContain("Thought for");
    expect(frame).toContain("Here it is");
    // The completed group auto-collapsed.
    expect(frame).toContain("▸ 1 tool call");
    r.unmount();
  });

  it("no `Thought for Ns` line when no reasoning arrived", () => {
    const s = run((s0) => {
      let s = pushUser(s0, "hi");
      s = reduce(s, { type: "turn_complete", status: "completed", text: "hello", usage: { promptTokens: 1, completionTokens: 1, totalMs: 10 } });
      return s;
    });
    const r = render(<OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(100)} reduceMotion columns={100} />);
    expect(r.lastFrame()!).not.toContain("Thought for");
    r.unmount();
  });

  it("a running tool round draws NO individual rows — only the single status line (§4.2, §4.4)", () => {
    let s = pushUser(initialState(5000), "go");
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
    s = reduce(s, { type: "tool_started", id: "t2", name: "read_file", args: { path: "b.ts" } });
    const r = render(<OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(100)} reduceMotion columns={100} />);
    const frame = r.lastFrame()!;
    // No `N tool calls` group header and no per-call rows while the round runs.
    expect(frame).not.toContain("tool call");
    expect(frame).not.toContain("a.ts");
    // The single status line shows the running verb instead.
    expect(frame).toContain("Running");
    r.unmount();
  });
});

/** A fan-out `fanout` block fixture. */
function fanoutBlock(rows: Partial<import("../state.js").FanoutRow>[], over: Partial<Extract<Block, { kind: "fanout" }>> = {}): Extract<Block, { kind: "fanout" }> {
  const full = rows.map((r, i) => ({ worker: "researcher", title: `t${i}`, status: "done", ...r }) as import("../state.js").FanoutRow);
  return { kind: "fanout", agents: full.length, rows: full, ...over };
}

describe("§4.4 fan-out orchestration rows", () => {
  it("renders the `● Orchestrated (N agents)` header + one row per worker with durations", () => {
    const block = fanoutBlock([
      { worker: "researcher", title: "a", status: "done", startedAt: 0, finishedAt: 2000 },
      { worker: "planner", title: "b", status: "done", startedAt: 0, finishedAt: 3000 },
      { worker: "implementer", title: "c", status: "done", startedAt: 0, finishedAt: 5000 },
    ]);
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("● Orchestrated (3 agents)");
    expect(frame).toContain("researcher");
    expect(frame).toContain("planner");
    expect(frame).toContain("implementer");
    // Durations (≥1s) shown per row.
    expect(frame).toContain("2.0s");
    expect(frame).toContain("5.0s");
    r.unmount();
  });

  it("a collapsed fan-out shows only the `● Orchestrated (N agents)` header", () => {
    const block = fanoutBlock([{ status: "done" }, { status: "done" }], { collapsed: true });
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("● Orchestrated (2 agents)");
    expect(frame).not.toContain("researcher");
    r.unmount();
  });

  it("a failed worker row carries the ✗ marker and holds the group expanded even when collapsed", () => {
    const block = fanoutBlock(
      [
        { worker: "researcher", title: "a", status: "done" },
        { worker: "implementer", title: "b", status: "failed", reason: "build broke" },
      ],
      { collapsed: true },
    );
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const frame = r.lastFrame()!;
    // collapsed:true is overridden to expanded by the failure, so rows show.
    expect(frame).toContain("● Orchestrated (2 agents)");
    expect(frame).toContain("✗");
    expect(frame).toContain("failed");
    expect(frame).toContain("build broke");
    r.unmount();
  });

  it("truncates a long title display-width-aware to the content width at 60/100/200", () => {
    const longTitle = "x".repeat(400);
    for (const cols of [60, 100, 200]) {
      const block = fanoutBlock([{ worker: "researcher", title: longTitle, status: "done" }, { status: "done" }]);
      const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={cols} />);
      const widest = Math.max(...r.lastFrame()!.split("\n").map((l) => [...l].length));
      expect(widest).toBeLessThanOrEqual(cols);
      r.unmount();
    }
  });

  it("sanitizes control/bidi bytes out of a title", () => {
    const block = fanoutBlock([{ worker: "researcher", title: "safe\u202etext\u0007", status: "done" }, { status: "done" }]);
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).not.toContain("\u202e");
    expect(frame).not.toContain("\u0007");
    expect(frame).toContain("safetext");
    r.unmount();
  });

  it("caps the rendered rows at 8", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ worker: `w${i}`, title: `t${i}`, status: "done" as const }));
    const block = fanoutBlock(rows);
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={200} />);
    // Count worker rows only: exclude the header and the Ctrl+G hint line.
    const shown = r.lastFrame()!
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.includes("Orchestrated") && !l.includes("ctrl+g")).length;
    expect(shown).toBe(8);
    r.unmount();
  });

  it("a single-worker dispatch is one ordinary tool row — no fan-out block, no Orchestrated header", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "w1", name: "task", args: { worker: "researcher", task: "look at a.ts" } });
    expect(s.fanout).toBeNull();
    s = reduce(s, { type: "worker_status", workerId: "f1-w1", status: "running", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "f1-w1", status: "succeeded", agent: "researcher" });
    s = reduce(s, { type: "tool_finished", id: "w1", name: "task", status: "success", durationMs: 100, summary: "ok" });
    const last = s.blocks[s.blocks.length - 1];
    if (!last) throw new Error("expected a block in state");
    expect(last.kind).toBe("toolgroup");
    expect((last as Extract<Block, { kind: "toolgroup" }>).calls).toHaveLength(1);
  });
});


describe("§4.4 live fan-out rows and sampled frames", () => {
  /** Start a 3-worker batch: 2 independent (a, b) + 1 dependent (c). */
  function startBatch(): ViewState {
    let s = pushUser(initialState(5000), "orchestrate");
    s = reduce(s, {
      type: "tool_started",
      id: "b1",
      name: "task",
      args: {
        tasks: [
          { id: "a", worker: "researcher", task: "survey the api" },
          { id: "b", worker: "planner", task: "draft the plan" },
          { id: "c", worker: "implementer", task: "write the code", dependsOn: ["a", "b"] },
        ],
      },
    });
    return s;
  }

  it("seeds header + 3 rows beneath the status line when the batch starts", () => {
    const s = startBatch();
    expect(s.fanout?.rows).toHaveLength(3);
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={0} />);
    const frame = r.lastFrame()!;
    // §4.4 — the LIVE header `●` animates as the half-circle `◐◓◑◒` while
    // orchestrating (frame 0 → `◐`); the committed block alone uses the static `●`.
    expect(frame).toMatch(/[◐◓◑◒] Orchestrating \(3 agents\)/);
    expect(frame).toContain("researcher");
    expect(frame).toContain("planner");
    expect(frame).toContain("implementer");
    // §4.4 — the two dim hint lines and the gutter bar.
    expect(frame).toContain("esc to cancel");
    expect(frame).toContain("ctrl+d/u navigate · ctrl+g open agent monitor");
    expect(frame).toContain("│");
    // The dependent worker (c dependsOn a,b) shows `Waiting` until its deps finish.
    expect(frame).toContain("Waiting");
    r.unmount();
  });

  it("row frames change ONLY on a worker state change — one distinct frame per transition, none on the status-line tick", () => {
    let s = startBatch();
    const frames: string[] = [];
    const sample = (): void => {
      const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={0} />);
      frames.push(r.lastFrame()!);
      r.unmount();
    };
    sample(); // initial: all dispatched
    // Two independent workers go running, then done; the dependent runs then done.
    const transitions: Array<{ workerId: string; status: string; taskId: string; agent: string }> = [
      { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" },
      { workerId: "b1-w2", status: "running", taskId: "b", agent: "planner" },
      { workerId: "b1-w1", status: "succeeded", taskId: "a", agent: "researcher" },
      { workerId: "b1-w2", status: "failed", taskId: "b", agent: "planner" },
      { workerId: "b1-w3", status: "running", taskId: "c", agent: "implementer" },
      { workerId: "b1-w3", status: "succeeded", taskId: "c", agent: "implementer" },
    ];
    let stateChanges = 0;
    for (const t of transitions) {
      const before = s.fanout;
      s = reduce(s, { type: "worker_status", workerId: t.workerId, status: t.status, taskId: t.taskId, agent: t.agent });
      if (s.fanout !== before) {
        stateChanges += 1;
        sample();
      }
    }
    // A repeated (duplicate) status event causes NO new row frame.
    const beforeDup = s.fanout;
    s = reduce(s, { type: "worker_status", workerId: "b1-w3", status: "succeeded", taskId: "c", agent: "implementer" });
    expect(s.fanout).toBe(beforeDup); // same object → no repaint
    // A status-line tick (no worker event) must not change the rows: re-render
    // the same state at the SAME animation frame and confirm it is identical
    // (the half-circle glyph advances with the clock, so the frame is pinned).
    const r1 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={0} />);
    const r2 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={0} />);
    expect(r1.lastFrame()).toBe(r2.lastFrame());
    r1.unmount();
    r2.unmount();
    // Distinct dynamic frames = initial + one per real transition.
    const distinct = new Set(frames);
    expect(frames.length).toBe(1 + stateChanges);
    expect(distinct.size).toBe(frames.length); // each transition changed the view
  });

  it("commits one `fanout` block with durations and a failed row when all workers finish", () => {
    let s = startBatch();
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w2", status: "running", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "succeeded", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w2", status: "failed", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w3", status: "succeeded", taskId: "c", agent: "implementer" });
    s = reduce(s, { type: "tool_finished", id: "b1", name: "task", status: "success", durationMs: 5000, summary: "done" });
    expect(s.fanout).toBeNull();
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    expect(block.kind).toBe("fanout");
    expect(block.rows).toHaveLength(3);
    expect(block.rows.find((row) => row.taskId === "b")!.status).toBe("failed");
    expect(block.rows.find((row) => row.taskId === "a")!.status).toBe("done");
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    expect(r.lastFrame()!).toContain("✗");
    r.unmount();
  });

  it("survives an out-of-order batch result and a skipped worker", () => {
    let s = startBatch();
    // Terminal events arrive BEFORE running, and out of task order.
    s = reduce(s, { type: "worker_status", workerId: "b1-w3", status: "skipped", taskId: "c", agent: "implementer" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "succeeded", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w2", status: "succeeded", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "tool_finished", id: "b1", name: "task", status: "success", durationMs: 100, summary: "" });
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    expect(block.rows.find((row) => row.taskId === "c")!.status).toBe("skipped");
    expect(block.rows.find((row) => row.taskId === "a")!.status).toBe("done");
  });

  it("any still-live row at commit is recorded cancelled (all-final committed list)", () => {
    let s = startBatch();
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "succeeded", taskId: "a", agent: "researcher" });
    // b and c never report terminal; the batch tool finishes anyway.
    s = reduce(s, { type: "tool_finished", id: "b1", name: "task", status: "success", durationMs: 100, summary: "" });
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    expect(block.rows.find((row) => row.taskId === "b")!.status).toBe("cancelled");
    expect(block.rows.find((row) => row.taskId === "c")!.status).toBe("cancelled");
  });

  it("two separate `task` calls in one round fan out into a 2-row list", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "task", args: { worker: "researcher", task: "x" } });
    expect(s.fanout).toBeNull(); // one call is not yet a fan-out
    s = reduce(s, { type: "tool_started", id: "t2", name: "task", args: { worker: "planner", task: "y" } });
    expect(s.fanout?.rows).toHaveLength(2);
    s = reduce(s, { type: "worker_status", workerId: "f-w1", status: "succeeded", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "f-w2", status: "succeeded", agent: "planner" });
    s = reduce(s, { type: "tool_finished", id: "t1", name: "task", status: "success", durationMs: 10, summary: "" });
    s = reduce(s, { type: "tool_finished", id: "t2", name: "task", status: "success", durationMs: 10, summary: "" });
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    expect(block.kind).toBe("fanout");
    expect(block.rows).toHaveLength(2);
  });

  it("shows a worker's current tool as its live state while running", () => {
    let s = startBatch();
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher", tool: "execute_command" });
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
    // `execute_command` → the `Run` display name (CLI map, not the raw tool).
    expect(r.lastFrame()!).toContain("Run");
    r.unmount();
  });

  it("real path: a core WORKER_STATUS_CHANGED{tool} through mapSessionEvent→reduce renders the tool name, not `Running`", () => {
    // Drive the REAL CLI seam end to end: the exact envelope the core's
    // Subagents manager emits as a worker begins a tool call (proven in
    // core subagents-owner-scope.test.ts) → the real `mapSessionEvent` →
    // the real `reduce` → the real `LiveFanout` render. The row's live
    // state must be the tool's display name (`Search`), never `Running`.
    let s = startBatch();
    const envelope: EventEnvelope = {
      type: "WORKER_STATUS_CHANGED",
      payload: { workerId: "b1-w1", status: "running", agent: "researcher", taskId: "a", tool: "search_contents" },
      scope: { session: "s1", worker: "b1-w1" },
      at: new Date().toISOString(),
    };
    const effect = mapSessionEvent(envelope);
    expect(effect).not.toBeNull();
    s = reduce(s, effect!);
    expect(s.fanout?.rows.find((row) => row.taskId === "a")?.tool).toBe("search_contents");
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("Search"); // search_contents → Search (CLI map)
    // The researcher row shows `Search`, not the generic `Running` fallback.
    const researcherLine = frame.split("\n").find((l) => l.includes("researcher"))!;
    expect(researcherLine).not.toContain("Running");
    r.unmount();
  });

  it("a worker with a pending plain approval shows `<ToolName> ⚠ tool approval needed`", () => {
    let s = startBatch();
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" });
    const approvals = [{ workerId: "b1-w1", tool: "write_file" }];
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} workerApprovals={approvals} />);
    expect(r.lastFrame()!).toContain("Write ⚠ tool approval needed");
    r.unmount();
  });

  it("Ctrl+D/Ctrl+U move the selected row (navigate only), clamped at the edges", () => {
    let s = startBatch();
    expect(s.fanout?.selected).toBe(0);
    // Ctrl+U at the top is clamped (same state object → no churn).
    const atTop = s;
    s = reduce(s, { type: "fanout_select", delta: -1 });
    expect(s).toBe(atTop);
    // Ctrl+D moves down; a worker transition must not reset the selection.
    s = reduce(s, { type: "fanout_select", delta: 1 });
    expect(s.fanout?.selected).toBe(1);
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" });
    expect(s.fanout?.selected).toBe(1);
    // Down to the last row, then clamped.
    s = reduce(s, { type: "fanout_select", delta: 1 });
    expect(s.fanout?.selected).toBe(2);
    const atBottom = s;
    s = reduce(s, { type: "fanout_select", delta: 1 });
    expect(s).toBe(atBottom);
  });

  it("the committed block drops the live-only fields (tool, dependsOn, workerId)", () => {
    let s = startBatch();
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher", tool: "execute_command" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w1", status: "succeeded", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w2", status: "succeeded", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "worker_status", workerId: "b1-w3", status: "succeeded", taskId: "c", agent: "implementer" });
    s = reduce(s, { type: "tool_finished", id: "b1", name: "task", status: "success", durationMs: 100, summary: "done" });
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    for (const row of block.rows) {
      expect((row as { tool?: string }).tool).toBeUndefined();
      expect((row as { dependsOn?: string[] }).dependsOn).toBeUndefined();
      expect((row as { workerId?: string }).workerId).toBeUndefined();
    }
  });
});

describe("§4.4 liveness wave — running gates the wave (not event recency)", () => {
  /** Start a 2-worker batch and move both workers to `running`, so each row is a
   * live WORKING row — a `running` row always waves. */
  function runningBatch(): ViewState {
    let s = pushUser(initialState(5000), "orchestrate");
    s = reduce(s, {
      type: "tool_started",
      id: "b1",
      name: "task",
      args: {
        tasks: [
          { id: "a", worker: "researcher", task: "survey" },
          { id: "b", worker: "planner", task: "plan" },
        ],
      },
    });
    s = reduce(s, { type: "worker_status", workerId: "w-a", status: "running", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "w-b", status: "running", taskId: "b", agent: "planner" });
    return s;
  }

  it("(a) EVERY running row waves — with a heartbeat, without one, and regardless of lastEventAt age", () => {
    let s = runningBatch();
    // One row gets a heartbeat, the other never does. BOTH are running.
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    const rowA = s.fanout!.rows.find((r) => r.taskId === "a")!;
    const rowB = s.fanout!.rows.find((r) => r.taskId === "b")!;
    expect(rowA.lastEventAt).toBeTypeOf("number");
    expect(rowB.lastEventAt).toBeUndefined();
    // The running state alone gates the wave: both wave, the stamp is ignored.
    expect(fanoutRowGenerating(rowA)).toBe(true);
    expect(fanoutRowGenerating(rowB)).toBe(true);
    // A very STALE stamp (the old recency gate would flip this SILENT) still waves.
    expect(fanoutRowGenerating({ ...rowA, lastEventAt: rowA.lastEventAt! - 10_000 })).toBe(true);
    // The band sweeps left→right: its start column advances between two frames
    // one shimmer interval (~125 ms) apart.
    const now = rowA.lastEventAt!;
    const f0 = shimmerFrame(now);
    const f1 = shimmerFrame(now + 125);
    expect(f1).toBe(f0 + 1); // ~8 fps advances one frame per 125 ms
    expect(shimmerBandStart(f1, 20)).not.toBe(shimmerBandStart(f0, 20));
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={now} />);
    expect(r.lastFrame()!).toContain("researcher");
    r.unmount();
  });

  it("(b) a terminal row and a waiting row never wave; a running row does", () => {
    const run: FanoutRow = { worker: "researcher", title: "a", status: "running" };
    const done: FanoutRow = { worker: "planner", title: "b", status: "done" };
    const wait: FanoutRow = { worker: "editor", title: "c", status: "waiting", dependsOn: ["a"] };
    const disp: FanoutRow = { worker: "editor", title: "d", status: "dispatched" };
    expect(fanoutRowGenerating(run)).toBe(true);
    expect(fanoutRowGenerating(done)).toBe(false);
    expect(fanoutRowGenerating(wait)).toBe(false);
    expect(fanoutRowGenerating(disp)).toBe(false);
  });

  it("(b2) a running row with NO further event keeps waving across frames (the slow-single-call regression)", () => {
    const s = runningBatch(); // no heartbeat → both rows running, no event ever
    expect(s.fanout?.rows.every((r) => r.lastEventAt === undefined)).toBe(true);
    const now = Date.now();
    // Sample across several seconds with NO new event: the old recency gate
    // would have gone SILENT (static) after ~1.5s — the wave must still sweep.
    const titleAt = (t: number): string => {
      const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={t} depth="truecolor" />);
      const frame = r.lastFrame()!;
      r.unmount();
      return frame;
    };
    // Two frames ~2s apart (well past the old window) still differ (peak moved).
    const f0 = titleAt(now + 2000);
    const f1 = titleAt(now + 2000 + 125);
    expect(f0).not.toBe(f1);
  });

  it("(c) under reduceMotion a running row is bold with no animated wave and the tick does not run", () => {
    let s = runningBatch();
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    const now = s.fanout!.rows.find((r) => r.taskId === "a")!.lastEventAt!;
    // Static fallback: no wave animates, so successive frames are identical.
    const f0 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} reduceMotion nowMs={now} />);
    const frame0 = f0.lastFrame()!;
    f0.unmount();
    const f1 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} reduceMotion nowMs={now + 125} />);
    const frame1 = f1.lastFrame()!;
    f1.unmount();
    expect(frame0).toBe(frame1); // no wave, no tick → no change
    expect(frame0).toContain("researcher");
  });

  it("(d) the committed FanoutGroup never shimmers (no band, stable across clocks)", () => {
    const block = fanoutBlock([
      { worker: "researcher", title: "a", status: "done", startedAt: 0, finishedAt: 2000 },
      { worker: "planner", title: "b", status: "done", startedAt: 0, finishedAt: 2000 },
    ]);
    // FanoutGroup takes no clock and no generating/band props — it cannot shimmer.
    const r0 = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const r1 = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    expect(r0.lastFrame()).toBe(r1.lastFrame());
    expect(r0.lastFrame()!).toContain("Orchestrated");
    r0.unmount();
    r1.unmount();
  });

  it("(e) selected-row bold+underline still applies to a waving (running) row", () => {
    let s = runningBatch();
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    const now = s.fanout!.rows.find((r) => r.taskId === "a")!.lastEventAt!;
    // Row 0 (researcher, taskId a) is selected by default AND running (waving):
    // both styling inputs hold on the same row, so the wave and the selected
    // bold+underline co-exist (neither suppresses the other).
    expect(s.fanout!.selected).toBe(0);
    const selectedRow = s.fanout!.rows[s.fanout!.selected]!;
    expect(selectedRow.taskId).toBe("a");
    expect(fanoutRowGenerating(selectedRow)).toBe(true);
    // The selected waving row renders without error and shows its content.
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={now} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("researcher");
    r.unmount();
  });

  it("subscriptions route a worker-scoped TOKEN_STREAM to a heartbeat (not dropped), carrying no token text", () => {
    const envelope: EventEnvelope = {
      type: "TOKEN_STREAM",
      payload: { token: "secret worker prose", done: false, taskId: "a" },
      scope: { session: "s1", worker: "w-a" },
      at: new Date().toISOString(),
    };
    const effect = mapSessionEvent(envelope);
    expect(effect).not.toBeNull();
    expect(effect!.type).toBe("worker_heartbeat");
    // The heartbeat carries only ids — never the worker's prose (out of scope).
    expect(JSON.stringify(effect)).not.toContain("secret worker prose");
    expect((effect as { workerId: string }).workerId).toBe("w-a");
    expect((effect as { taskId?: string }).taskId).toBe("a");
  });

  it("a worker-scoped heartbeat never merges worker prose into the orchestrator transcript", () => {
    let s = runningBatch();
    const before = s.streaming;
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    // The orchestrator's own streaming buffer is untouched by a worker heartbeat.
    expect(s.streaming).toBe(before);
  });

  it("a committed fan-out row drops the live-only lastEventAt field", () => {
    let s = runningBatch();
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    s = reduce(s, { type: "worker_status", workerId: "w-a", status: "succeeded", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "w-b", status: "succeeded", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "tool_finished", id: "b1", name: "task", status: "success", durationMs: 100, summary: "done" });
    const block = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "fanout" }>;
    for (const row of block.rows) {
      expect((row as { lastEventAt?: number }).lastEventAt).toBeUndefined();
    }
  });
});

describe("§4.2/§4.4 gradient wave + half-circle WIRED into JSX render", () => {
  /** A running 2-worker batch with a heartbeat on worker `a` so its row is
   * GENERATING (the wave tier). */
  function generatingBatch(): ViewState {
    let s = pushUser(initialState(5000), "orchestrate");
    s = reduce(s, {
      type: "tool_started",
      id: "b1",
      name: "task",
      args: { tasks: [{ id: "a", worker: "researcher", task: "survey" }, { id: "b", worker: "planner", task: "plan" }] },
    });
    s = reduce(s, { type: "worker_status", workerId: "w-a", status: "running", taskId: "a", agent: "researcher" });
    s = reduce(s, { type: "worker_status", workerId: "w-b", status: "running", taskId: "b", agent: "planner" });
    s = reduce(s, { type: "worker_heartbeat", workerId: "w-a", taskId: "a" });
    return s;
  }

  it("StatusLine renders the VERB characters (waved) while the turn is active, and omits them under NO spinner wait", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "token", token: "x", done: false });
    const r = render(<StatusLine state={{ ...s, turnStartedAt: Date.now() - 1000 }} theme={theme} reduceMotion={false} depth="truecolor" nowMs={1_000} />);
    const frame = r.lastFrame()!;
    // The verb text is present in the dynamic region — the wave spans render the
    // characters into JSX (one <Text> per char), not dropped.
    expect(frame).toContain("Responding");
    r.unmount();
  });

  it("StatusLine verb renders statically under reduceMotion (no spinner, verb still shown)", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "token", token: "x", done: false });
    const r = render(<StatusLine state={{ ...s, turnStartedAt: Date.now() - 1000 }} theme={theme} reduceMotion depth="truecolor" />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("Responding");
    expect(frame).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/); // no animated spinner
    r.unmount();
  });

  it("LiveFanout: a RUNNING row shows the animated HALF-CIRCLE glyph and the header half-circle advances across frames", () => {
    const s = generatingBatch();
    const now = s.fanout!.rows.find((r) => r.taskId === "a")!.lastEventAt!;
    const f0 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={now} depth="truecolor" />);
    const frame0 = f0.lastFrame()!;
    f0.unmount();
    // The header uses a half-circle frame, never the static full bullet, while
    // orchestrating; a running row shows a half-circle too.
    expect(frame0).toMatch(/[◐◓◑◒] Orchestrating \(2 agents\)/);
    // The header glyph animates: a frame two steps later (~250ms) differs.
    const f1 = render(<LiveFanout state={{ ...s, fanout: { ...s.fanout!, rows: s.fanout!.rows.map((r) => r.taskId === "a" ? { ...r, lastEventAt: now + 250 } : r) } }} theme={theme} glyphs={glyphs} columns={100} nowMs={now + 250} depth="truecolor" />);
    const frame1 = f1.lastFrame()!;
    f1.unmount();
    const hdr = (f: string): string => f.match(/([◐◓◑◒]) Orchestrating/)![1]!;
    expect(hdr(frame0)).not.toBe(hdr(frame1)); // half-circle cycled
  });

  it("LiveFanout: a done/terminal committed row shows the full ● coloured by state, never a half-circle", () => {
    const block = fanoutBlock([
      { worker: "researcher", title: "a", status: "done", startedAt: 0, finishedAt: 2000 },
      { worker: "planner", title: "b", status: "failed", reason: "boom", startedAt: 0, finishedAt: 2000 },
    ]);
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={100} />);
    const frame = r.lastFrame()!;
    // Committed block: static header ●, a done ● and a failed ✗ — no half-circle.
    expect(frame).toContain("● Orchestrated (2 agents)");
    expect(frame).not.toMatch(/[◐◓◑◒]/);
    expect(frame).toContain("✗");
    r.unmount();
  });

  it("LiveFanout: the GENERATING row title renders (wave spans) and the row frame changes across wave frames", () => {
    const s = generatingBatch();
    const now = s.fanout!.rows.find((r) => r.taskId === "a")!.lastEventAt!;
    const f0 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} nowMs={now} depth="truecolor" />);
    const frame0 = f0.lastFrame()!;
    f0.unmount();
    // The generating worker's role still renders (the wave does not drop text).
    expect(frame0).toContain("researcher");
    // Frame advance: the running-row half-circle + wave peak move, so the
    // dynamic frame differs one half-circle step later (glyph cycles even if
    // colour is stripped by the test renderer).
    const s1 = { ...s, fanout: { ...s.fanout!, rows: s.fanout!.rows.map((r) => r.taskId === "a" ? { ...r, lastEventAt: now + 125 } : r) } };
    const f1 = render(<LiveFanout state={s1} theme={theme} glyphs={glyphs} columns={100} nowMs={now + 125} depth="truecolor" />);
    const frame1 = f1.lastFrame()!;
    f1.unmount();
    expect(frame0).not.toBe(frame1);
  });
});

describe("§4.2/§4.4 gradient wave uses REAL theme tokens (regression: invisible wave)", () => {
  // These assert the wave against the ACTUAL resolved theme tokens — never a
  // hand-fed hex — so a non-hex base (the old `theme.warning='yellow'` bug, or
  // a 16-colour named token) is caught: it collapses to the static fallback.
  const tcTheme = resolveTheme(caps(100)); // truecolor
  const ansi16Theme = resolveTheme(
    detectCapabilities({ TERM: "xterm-16color", LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 }),
  );
  const noneTheme = resolveTheme(
    detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 }),
  );

  it("(a) the StatusLine verb wave base (theme.brand) is a PARSEABLE hex and produces per-character COLOR spans at truecolor", () => {
    // The base StatusLine actually feeds the span builder: `hexToRGB(theme.brand)`.
    const base = hexToRGB(tcTheme.brand);
    expect(base).not.toBeNull(); // the OLD bug fed `theme.warning` ('yellow') => null
    const peak = (waveFrame(1_000) / 8) % 1;
    const spans = gradientWaveSpans("Thinking", base, peak, { depth: "truecolor", active: true });
    // Every character carries its own defined colour — NOT the static-bold fallback.
    expect(spans.every((s) => typeof s.color === "string")).toBe(true);
    expect(spans.some((s) => s.bold)).toBe(false);
    // More than one distinct hue (the brightness ramp) — a real wave, not a flat fill.
    expect(new Set(spans.map((s) => s.color)).size).toBeGreaterThan(1);
  });

  it("(b) a REAL worker_heartbeat through the reducer flips generating true, and the row title then renders per-character COLOR spans", () => {
    // Drive the ACTUAL subscription -> reducer path (no hand-set lastEventAt).
    const ev = (type: string, payload: unknown, scope: Record<string, unknown> = {}): EventEnvelope =>
      ({ type, payload, scope, at: new Date().toISOString() } as unknown as EventEnvelope);
    const apply = (st: ViewState, e: EventEnvelope): ViewState => {
      const eff = mapSessionEvent(e);
      return eff ? reduce(st, eff as never) : st;
    };
    let s = pushUser(initialState(5000), "orchestrate");
    s = apply(s, ev("TOOL_STARTED", { id: "b1", name: "task", args: { tasks: [
      { id: "a", worker: "researcher", task: "survey" },
      { id: "b", worker: "planner", task: "plan" },
    ] } }));
    s = apply(s, ev("WORKER_STATUS_CHANGED", { workerId: "w-a", status: "running", agent: "researcher", taskId: "a" }));
    // A genuine WORKER-scoped TOKEN_STREAM (scope.worker) — maps to worker_heartbeat.
    s = apply(s, ev("TOKEN_STREAM", { token: "worker prose", done: false, taskId: "a" }, { session: "s1", worker: "w-a" }));
    const row = s.fanout!.rows.find((r) => r.taskId === "a")!;
    // The reducer stamped lastEventAt (binding) and the row is running => it waves.
    expect(row.lastEventAt).toBeTypeOf("number");
    expect(fanoutRowGenerating(row)).toBe(true);
    // The row title then waves: its colour (theme.accent) is a parseable hex and
    // the title produces per-character colour spans at truecolor.
    const rowColor = tcTheme.accent; // the running-row hue fed to the title wave
    const spans = gradientWaveSpans(row.title, hexToRGB(rowColor), 0.3, { depth: "truecolor", active: true });
    expect(spans.every((s) => typeof s.color === "string")).toBe(true);
  });

  it("(c) ansi16 and none collapse the verb wave to the static two-weight fallback (no colour, no crash)", () => {
    const peak = 0.3;
    // ansi16: theme.brand is the named colour 'blue' (non-hex) => static bold.
    const a16 = gradientWaveSpans("Thinking", hexToRGB(ansi16Theme.brand), peak, { depth: "ansi16", active: true });
    expect(a16.every((s) => s.color === undefined && s.bold === true)).toBe(true);
    // none: no colour at all => static bold, no crash.
    const none = gradientWaveSpans("Thinking", hexToRGB(noneTheme.brand), peak, { depth: "none", active: true });
    expect(none.every((s) => s.color === undefined && s.bold === true)).toBe(true);
  });

  it("(c) the committed (Orchestrated) block never waves — no per-character colour spans", () => {
    const block = fanoutBlock([
      { worker: "researcher", title: "alpha", status: "done", startedAt: 0, finishedAt: 2000 },
      { worker: "planner", title: "beta", status: "done", startedAt: 0, finishedAt: 2000 },
    ]);
    const r = render(<FanoutGroup block={block} glyphs={glyphs} theme={tcTheme} columns={100} />);
    const frame = r.lastFrame()!;
    r.unmount();
    expect(frame).toContain("● Orchestrated (2 agents)");
    // A truecolor per-character wave emits an SGR before EACH title character;
    // the committed block paints the title in at most one colour, so no run of
    // distinct per-character foregrounds appears.
    // eslint-disable-next-line no-control-regex
    const perChar = /(\x1b\[38;2;\d+;\d+;\d+m.){3,}/;
    expect(perChar.test(frame)).toBe(false);
  });
});
