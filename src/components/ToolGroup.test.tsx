/**
 * §4.4/§4.6 tool-call grouping, collapse, truncation, reasoning summary and the
 * delegation collapse (cli-blueprint.md §4.1, §4.4, §4.6).
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ToolGroup, ThoughtLine, ReasoningView, StatusLine, FanoutGroup, LiveFanout } from "./ToolGroup.js";
import { OutputPane } from "./OutputPane.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { reduce, pushUser, initialState, type ViewState, type ToolCall, type Block } from "../state.js";
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
    const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("● Orchestrating (3 agents)");
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
      const r = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
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
    // the same state and confirm the frame is identical.
    const r1 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
    const r2 = render(<LiveFanout state={s} theme={theme} glyphs={glyphs} columns={100} />);
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
