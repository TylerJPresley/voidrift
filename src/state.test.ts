/**
 * View-state reducer and event mapping (cli-blueprint.md §4, §5). Proves the
 * lightweight view-state effects derived from the core event stream (§1.4) are
 * applied correctly: streaming, tool rows, turn commit, cancel/error, context
 * budget/threshold, model/branch, and the housekeeping notice.
 */
import { describe, it, expect } from "vitest";
import { reduce, pushUser, initialState, withWelcome, seedResume, blockLines, statusLine, fanoutRowStatus, fanoutTitle, seedFanoutRows, fanoutRowGenerating } from "./state.js";
import type { Block, ViewState } from "./state.js";
import { mapSessionEvent, mapHostEvent } from "./events/subscriptions.js";
import type { EventEnvelope } from "@voidrift/core";

const env = (type: string, payload: unknown, scope = {}): EventEnvelope => ({
  type,
  payload,
  scope,
  at: new Date().toISOString(),
});

describe("event → effect mapping (§1.4)", () => {
  it("maps session-scoped turn/tool/context/model/worker events", () => {
    expect(mapSessionEvent(env("TOKEN_STREAM", { token: "hi", done: false }))).toEqual({ type: "token", token: "hi", done: false });
    expect(mapSessionEvent(env("TURN_COMPLETE", { status: "completed", text: "T", usage: { promptTokens: 1, completionTokens: 2, totalMs: 3 } }))?.type).toBe("turn_complete");
    expect(mapSessionEvent(env("TOOL_STARTED", { id: "1", name: "read_file", args: {} }))?.type).toBe("tool_started");
    expect(mapSessionEvent(env("CONTEXT_BUDGET_UPDATED", { percentage: 38 }))).toEqual({ type: "context_budget", percentage: 38 });
    expect(mapSessionEvent(env("MODEL_CHANGED", { name: "gpt-4o" }))).toEqual({ type: "model_changed", name: "gpt-4o" });
    expect(mapSessionEvent(env("MODEL_USAGE", { name: "m", usage: { promptTokens: 7, inputSum: 15, completionTokens: 2, cacheReadTokens: 0, genMs: 300 }, estimated: true }))).toEqual({
      type: "model_usage",
      promptTokens: 7,
      inputSum: 15,
      completionTokens: 2,
      cacheReadTokens: 0,
      genMs: 300,
      estimated: true,
    });
    expect(mapSessionEvent(env("WORKER_STATUS_CHANGED", { workerId: "w1", status: "running" }))?.type).toBe("worker_status");
  });

  it("maps only BRANCH_CHANGED and HOUSEKEEPING_NOTICE on the host-level subscription", () => {
    expect(mapHostEvent(env("BRANCH_CHANGED", { branch: "main" }))).toEqual({ type: "branch_changed", branch: "main" });
    expect(mapHostEvent(env("HOUSEKEEPING_NOTICE", { idleSessions: 2, idleDays: 30 }))?.type).toBe("housekeeping");
    expect(mapHostEvent(env("TOKEN_STREAM", { token: "x" }))).toBeNull();
  });

  it("maps PERMISSION_RESOLVED carrying the auto_approve resolver and requestId (§4.4)", () => {
    expect(
      mapSessionEvent(env("PERMISSION_RESOLVED", { requestId: "auto-approve-call_1", decision: "approve", resolver: "auto_approve" })),
    ).toEqual({ type: "permission_resolved", requestId: "auto-approve-call_1", resolver: "auto_approve" });
  });

  it("carries the worker agent and batch taskId on WORKER_STATUS_CHANGED (§4.4)", () => {
    expect(
      mapSessionEvent(env("WORKER_STATUS_CHANGED", { workerId: "f1-w1", status: "succeeded", agent: "researcher", taskId: "a" })),
    ).toEqual({ type: "worker_status", workerId: "f1-w1", status: "succeeded", agent: "researcher", taskId: "a" });
  });

  it("routes a WORKER-scoped text/tool event to a liveness heartbeat (never the orchestrator transcript) (§4.4, §7.2)", () => {
    // §4.4 (liveness shimmer) — worker-scoped TOKEN_STREAM / REASONING_STREAM /
    // TOOL_STARTED / TOOL_FINISHED are no longer dropped: they map to a
    // `worker_heartbeat` carrying ONLY ids (no token, no reasoning, no tool
    // name), so the worker's prose and tool calls still never merge into the
    // orchestrator transcript — the event only times the row's liveness.
    const w = { session: "s1", worker: "f1-w1" };
    const tok = mapSessionEvent(env("TOKEN_STREAM", { token: "worker prose", done: false, taskId: "a" }, w));
    expect(tok).toEqual({ type: "worker_heartbeat", workerId: "f1-w1", taskId: "a" });
    const rsn = mapSessionEvent(env("REASONING_STREAM", { token: "worker think", done: false }, w));
    expect(rsn).toEqual({ type: "worker_heartbeat", workerId: "f1-w1" });
    const started = mapSessionEvent(env("TOOL_STARTED", { id: "wt1", name: "read_file", args: {} }, w));
    expect(started).toEqual({ type: "worker_heartbeat", workerId: "f1-w1" });
    const finished = mapSessionEvent(env("TOOL_FINISHED", { id: "wt1", name: "read_file", status: "success", durationMs: 3, summary: "5 lines" }, w));
    expect(finished).toEqual({ type: "worker_heartbeat", workerId: "f1-w1" });
    // None of the heartbeats carry the worker's prose or tool payload.
    for (const e of [tok, rsn, started, finished]) {
      expect(JSON.stringify(e)).not.toContain("worker prose");
      expect(JSON.stringify(e)).not.toContain("worker think");
      expect(JSON.stringify(e)).not.toContain("read_file");
    }
  });

  it("keeps the ORCHESTRATOR's own text/tool events (no worker scope) in the transcript (§4.4)", () => {
    const s = { session: "s1" };
    expect(mapSessionEvent(env("TOKEN_STREAM", { token: "hi", done: false }, s))).toEqual({ type: "token", token: "hi", done: false });
    expect(mapSessionEvent(env("TOOL_STARTED", { id: "1", name: "read_file", args: {} }, s))?.type).toBe("tool_started");
  });

  it("keeps a worker's MODEL_USAGE (rolled into parent stats) and WORKER_STATUS_CHANGED (§4.4, §10.14)", () => {
    const w = { session: "s1", worker: "f1-w1" };
    // Worker usage is intentionally session-scoped stats, not transcript prose.
    expect(mapSessionEvent(env("MODEL_USAGE", { name: "m", usage: { promptTokens: 7, inputSum: 7, completionTokens: 2 } }, w))?.type).toBe("model_usage");
    expect(mapSessionEvent(env("WORKER_STATUS_CHANGED", { workerId: "f1-w1", status: "running", agent: "researcher" }, w))?.type).toBe("worker_status");
  });
});

describe("mode + auto_approve view state (§4.4, §5.2)", () => {
  it("SESSION_MODE_CHANGED is the single source of truth for the mode bracket (agent name)", () => {
    let s = initialState(5000);
    expect(s.mode).toBe("chat");
    s = reduce(s, { type: "session_mode_changed", from: "chat", to: "research" });
    expect(s.mode).toBe("research");
    s = reduce(s, { type: "session_mode_changed", from: "research", to: "vibe" });
    expect(s.mode).toBe("vibe");
  });

  it("a refused mode change sets a transient notice, cleared when the mode changes", () => {
    let s = initialState(5000);
    s = reduce(s, { type: "mode_notice", message: "finish or cancel the current turn first" });
    expect(s.modeNotice).toBe("finish or cancel the current turn first");
    s = reduce(s, { type: "session_mode_changed", from: "chat", to: "research" });
    expect(s.modeNotice).toBeNull();
  });

  it("a auto_approve PERMISSION_RESOLVED marks the matching tool id, and the row commits with autoApprove:true", () => {
    let s = initialState(5000);
    // The core emits PERMISSION_RESOLVED (auto-approve-<toolCallId>) BEFORE the tool
    // pipeline opens the row, so the id is remembered then applied on finish.
    s = reduce(s, { type: "permission_resolved", requestId: "auto-approve-call_9", resolver: "auto_approve" });
    expect(s.autoApproveToolIds.has("call_9")).toBe(true);
    s = reduce(s, { type: "tool_started", id: "call_9", name: "execute_command", args: { command: "rm -rf x" } });
    s = reduce(s, { type: "tool_finished", id: "call_9", name: "execute_command", status: "success", durationMs: 100, summary: "exit 0" });
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "toolgroup" });
    expect((last as { calls: unknown[] }).calls[0]).toMatchObject({ id: "call_9", autoApprove: true });
  });

  it("an ordinary PERMISSION_RESOLVED (non-auto-approve resolver) never marks a row", () => {
    let s = initialState(5000);
    s = reduce(s, { type: "permission_resolved", requestId: "req_1", resolver: "interactive" });
    expect(s.autoApproveToolIds.size).toBe(0);
    s = reduce(s, { type: "tool_started", id: "req_1", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_finished", id: "req_1", name: "read_file", status: "success", durationMs: 1, summary: "" });
    const last = s.blocks[s.blocks.length - 1];
    expect((last as { calls: unknown[] }).calls[0]).not.toHaveProperty("autoApprove");
  });
});

describe("stream and turn commit (§4.2)", () => {
  it("accumulates tokens then commits TurnResult.text to Static on turn complete", () => {
    let s = pushUser(initialState(5000), "hello");
    s = reduce(s, { type: "token", token: "par", done: false });
    s = reduce(s, { type: "token", token: "tial", done: false });
    expect(s.streaming).toBe("partial");
    s = reduce(s, { type: "turn_complete", status: "completed", text: "FINAL", usage: { promptTokens: 0, completionTokens: 7, totalMs: 10 } });
    expect(s.streaming).toBe("");
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "FINAL", completionTokens: 7 });
  });

  it("TURN_CANCELLED commits the partial text with a cancelled marker", () => {
    let s = reduce(initialState(5000), { type: "token", token: "half", done: false });
    s = reduce(s, { type: "turn_cancelled" });
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "half", cancelled: true });
  });

  it("ERROR_OCCURRED commits an error block and closes the stream", () => {
    let s = reduce(initialState(5000), { type: "token", token: "x", done: false });
    s = reduce(s, { type: "error", source: "model", message: "boom" });
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "info", glyph: "error", text: "model: boom" });
    expect(s.streaming).toBe("");
  });

  it("a typed IMAGE_NOT_SUPPORTED error renders verbatim without the engine: prefix", () => {
    const msg =
      'the active model "auto" is not marked as vision-capable. Add "vision": true to models.auto in ~/.config/voidrift/config.json, or run /model to pick a vision model. The image was not sent.';
    const s = reduce(initialState(5000), { type: "error", source: "engine", code: "IMAGE_NOT_SUPPORTED", message: msg });
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "info", glyph: "error", text: msg });
    expect((last as { text: string }).text).not.toContain("engine:");
  });
});

describe("turn footer estimate marker and cost (§4.2, §10.7)", () => {
  it("marks the committed block estimated when the last MODEL_USAGE was estimated", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "model_usage", promptTokens: 1200, inputSum: 1200, completionTokens: 40, cacheReadTokens: 0, genMs: 0, estimated: true });
    s = reduce(s, { type: "turn_complete", status: "completed", text: "A", usage: { promptTokens: 1200, completionTokens: 40, totalMs: 1000 } });
    const last = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "assistant" }>;
    expect(last.estimated).toBe(true);
    // The flag resets so a following provider-reported turn is bare.
    expect(s.lastEstimated).toBe(false);
  });

  it("does not mark the block when MODEL_USAGE was provider-reported", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "model_usage", promptTokens: 1200, inputSum: 1200, completionTokens: 40, cacheReadTokens: 0, genMs: 0, estimated: false });
    s = reduce(s, { type: "turn_complete", status: "completed", text: "A", usage: { promptTokens: 1200, completionTokens: 40, totalMs: 1000 } });
    const last = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "assistant" }>;
    expect(last.estimated).toBeUndefined();
  });

  it("derives a cost only when the active model carries a price", () => {
    let s = reduce(initialState(5000), { type: "model_price", price: { costPer1kInput: 1, costPer1kOutput: 2 } });
    s = pushUser(s, "hi");
    s = reduce(s, { type: "turn_complete", status: "completed", text: "A", usage: { promptTokens: 1000, completionTokens: 1000, totalMs: 1000 } });
    const last = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "assistant" }>;
    expect(last.cost).toBeCloseTo(3); // 1 + 2
  });

  it("omits cost when no price is configured", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "turn_complete", status: "completed", text: "A", usage: { promptTokens: 1000, completionTokens: 1000, totalMs: 1000 } });
    const last = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "assistant" }>;
    expect(last.cost).toBeUndefined();
  });

  it("the plain scroll projection carries the `~` marker and `$cost`", () => {
    let s = reduce(initialState(5000), { type: "model_price", price: { costPer1kInput: 1, costPer1kOutput: 2 } });
    s = pushUser(s, "hi");
    s = reduce(s, { type: "model_usage", promptTokens: 1000, inputSum: 1000, completionTokens: 1000, cacheReadTokens: 0, genMs: 100, estimated: true });
    s = reduce(s, { type: "turn_complete", status: "completed", text: "A", usage: { promptTokens: 1000, completionTokens: 1000, totalMs: 1000 } });
    const lines = blockLines(s.blocks);
    expect(lines.some((l) => l.includes("↑ ~1000") && l.includes("↓ ~1000") && l.includes("$3.0000"))).toBe(true);
  });
});

describe("tool rows (§4.4)", () => {
  it("groups consecutive tool calls under one toolgroup, committing a call per TOOL_FINISHED with its diff", () => {
    let s = reduce(initialState(5000), { type: "tool_started", id: "t1", name: "write_file", args: { path: "a.ts" } });
    expect(s.tools).toHaveLength(1);
    // A second call of the SAME round starts before the first finishes (§4.4):
    // both belong to one group, committed whole when the round finishes.
    s = reduce(s, { type: "tool_started", id: "t2", name: "read_file", args: { path: "b.ts" } });
    expect(s.tools).toHaveLength(2);
    // No group committed while the round runs.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
    s = reduce(s, { type: "tool_finished", id: "t1", name: "write_file", status: "success", durationMs: 400, summary: "wrote", diff: "+a" });
    // One still in flight → still no commit.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
    s = reduce(s, { type: "tool_finished", id: "t2", name: "read_file", status: "success", durationMs: 10, summary: "(2 lines)" });
    expect(s.tools).toHaveLength(0);
    const last = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "toolgroup" }>;
    expect(last.kind).toBe("toolgroup");
    expect(last.calls).toHaveLength(2);
    expect(last.calls[0]).toMatchObject({ name: "write_file", diff: "+a", args: { path: "a.ts" } });
    expect(last.calls[1]).toMatchObject({ name: "read_file" });
  });

  it("two separate tool rounds (a round finishes before the next starts) open two groups", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 1, summary: "" });
    s = reduce(s, { type: "tool_started", id: "t2", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_finished", id: "t2", name: "read_file", status: "success", durationMs: 1, summary: "" });
    const groups = s.blocks.filter((b) => b.kind === "toolgroup");
    expect(groups).toHaveLength(2);
  });

  it("§14.6 carries the core's count fields onto the committed tool call", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "tool_started", id: "g1", name: "glob_files", args: { pattern: "*" } });
    s = reduce(s, {
      type: "tool_finished",
      id: "g1",
      name: "glob_files",
      status: "success",
      durationMs: 5,
      summary: "f0.txt\nf1.txt",
      lines: 50,
      truncated: true,
    });
    const group = s.blocks[s.blocks.length - 1] as Extract<Block, { kind: "toolgroup" }>;
    expect(group.calls[0]).toMatchObject({ name: "glob_files", lines: 50, truncated: true });
  });

  it("§14.6 TOOL_FINISHED maps lines/entries; absent fields stay unset (fallback)", () => {
    const withCounts = mapSessionEvent(
      env("TOOL_FINISHED", { id: "g1", name: "workspace_map", status: "success", durationMs: 2, summary: "a/\nb.ts", lines: 50, entries: { files: 36, dirs: 14 } }, { session: "s1" }),
    );
    expect(withCounts).toMatchObject({ type: "tool_finished", lines: 50, entries: { files: 36, dirs: 14 } });
    const plain = mapSessionEvent(env("TOOL_FINISHED", { id: "g2", name: "read_file", status: "success", durationMs: 1, summary: "5 lines" }, { session: "s1" }));
    expect(plain).not.toHaveProperty("lines");
    expect(plain).not.toHaveProperty("entries");
  });
});

describe("footer context levels (§5.3)", () => {
  it("tracks budget percentage and the crossed level", () => {
    let s = reduce(initialState(5000), { type: "context_budget", percentage: 42 });
    expect(s.contextPercentage).toBe(42);
    s = reduce(s, { type: "context_threshold", level: "compaction", percentage: 42 });
    expect(s.contextLevel).toBe("compaction");
    s = reduce(s, { type: "context_threshold", level: "safety_net", percentage: 85 });
    expect(s.contextLevel).toBe("safety_net");
  });
});

describe("§4.2.1/§14.6 — head threshold crossing shows one transcript ⚠ info line", () => {
  const lastBlock = (s: ViewState) => s.blocks[s.blocks.length - 1] as { glyph: string; text: string; kind: string };

  it("maps a `head` CONTEXT_THRESHOLD_CROSSED carrying components, largest first", () => {
    expect(
      mapSessionEvent(
        env("CONTEXT_THRESHOLD_CROSSED", {
          level: "head",
          percentage: 38,
          components: [
            { name: "AGENTS.md", tokens: 2200 },
            { name: "tool schemas", tokens: 1400 },
            { name: "skills", tokens: 200 },
          ],
        }),
      ),
    ).toEqual({
      type: "context_threshold",
      level: "head",
      percentage: 38,
      components: [
        { name: "AGENTS.md", tokens: 2200 },
        { name: "tool schemas", tokens: 1400 },
        { name: "skills", tokens: 200 },
      ],
    });
  });

  it("an occupancy-level crossing carries no components and only updates contextLevel (unchanged)", () => {
    expect(mapSessionEvent(env("CONTEXT_THRESHOLD_CROSSED", { level: "compaction", percentage: 42 }))).toEqual({
      type: "context_threshold",
      level: "compaction",
      percentage: 42,
    });
  });

  it("renders the exact warn line from the head crossing, deriving each component's window share", () => {
    const before = initialState(5000);
    const s = reduce(before, {
      type: "context_threshold",
      level: "head",
      percentage: 38,
      components: [
        { name: "AGENTS.md", tokens: 2200 },
        { name: "tool schemas", tokens: 1400 },
        { name: "skills", tokens: 200 },
      ],
    });
    const b = lastBlock(s);
    expect(b.kind).toBe("info");
    expect(b.glyph).toBe("warn");
    expect(b.text).toBe(
      "Fixed context is 38% of the window: AGENTS.md 22%, tool schemas 14%, skills 2%. Prune AGENTS.md, memory or plans to reduce it.",
    );
    // The warn glyph renders `⚠` in front of the text (§4.7).
    expect(blockLines(s.blocks)).toContain(
      "⚠ Fixed context is 38% of the window: AGENTS.md 22%, tool schemas 14%, skills 2%. Prune AGENTS.md, memory or plans to reduce it.",
    );
    // §4.2.1 — the head axis never touches the occupancy level.
    expect(s.contextLevel).toBe(before.contextLevel);
  });

  it("names only the top three components when more are present", () => {
    const s = reduce(initialState(5000), {
      type: "context_threshold",
      level: "head",
      percentage: 40,
      components: [
        { name: "AGENTS.md", tokens: 2000 },
        { name: "tool schemas", tokens: 1000 },
        { name: "skills", tokens: 500 },
        { name: "memory index", tokens: 300 },
      ],
    });
    const text = (s.blocks[s.blocks.length - 1] as { text: string }).text;
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("tool schemas");
    expect(text).toContain("skills");
    expect(text).not.toContain("memory index");
  });

  it("an occupancy-level crossing adds no block and still sets contextLevel", () => {
    const before = initialState(5000);
    const s = reduce(before, { type: "context_threshold", level: "compaction", percentage: 42 });
    expect(s.blocks).toHaveLength(before.blocks.length);
    expect(s.contextLevel).toBe("compaction");
  });

  it("a head crossing with no components adds no line (nothing truthful to say)", () => {
    const before = initialState(5000);
    const s = reduce(before, { type: "context_threshold", level: "head", percentage: 38 });
    expect(s.blocks).toHaveLength(before.blocks.length);
    expect(s.contextLevel).toBe(before.contextLevel);
  });
});

describe("scrollback cap (§1.4)", () => {
  it("drops the oldest committed block past the cap", () => {
    let s = initialState(3);
    for (let i = 0; i < 5; i++) s = reduce(s, { type: "warning", category: "cli", message: `w${i}` });
    expect(s.blocks).toHaveLength(3);
    expect((s.blocks[0] as { text: string }).text).toBe("w2");
  });
});

describe("read-lane dedupe across warning and LIMIT_HIT (§4.7, 2-CLI)", () => {
  const info = (s: ViewState): string[] => s.blocks.filter((b) => b.kind === "info").map((b) => (b as { text: string }).text);

  it("a lane.* LIMIT_HIT adds NO second ℹ line when a read-lane warning already showed this turn", () => {
    let s = reduce(initialState(5000), { type: "warning", category: "read-lane", message: "Heavy direct reading detected." });
    s = reduce(s, { type: "limit_hit", key: "lane.readCallsPerTurn", notice: "read-lane nudge (limits.lane.readCallsPerTurn = 8). Raise it in config." });
    expect(info(s)).toHaveLength(1);
    expect(info(s)[0]).toBe("Heavy direct reading detected.");
  });

  it("a read-lane warning adds NO second ℹ line when a lane.* LIMIT_HIT already showed this turn", () => {
    let s = reduce(initialState(5000), { type: "limit_hit", key: "lane.readCallsPerTurn", notice: "read-lane nudge (limits.lane.readCallsPerTurn = 8)." });
    s = reduce(s, { type: "warning", category: "read-lane", message: "Heavy direct reading detected." });
    expect(info(s)).toHaveLength(1);
    expect(info(s)[0]).toContain("read-lane nudge");
  });

  it("a non-lane LIMIT_HIT is unaffected by a read-lane warning", () => {
    let s = reduce(initialState(5000), { type: "warning", category: "read-lane", message: "Heavy direct reading detected." });
    s = reduce(s, { type: "limit_hit", key: "ingest.fitFraction", notice: "limit reached (limits.ingest.fitFraction)" });
    expect(info(s)).toHaveLength(2);
  });

  it("the dedupe resets at the turn boundary (pushUser)", () => {
    let s = reduce(initialState(5000), { type: "warning", category: "read-lane", message: "Heavy direct reading detected." });
    s = pushUser(s, "next");
    s = reduce(s, { type: "limit_hit", key: "lane.readCallsPerTurn", notice: "read-lane nudge again." });
    expect(info(s).some((t) => t === "read-lane nudge again.")).toBe(true);
  });
});


describe("additional reducer branches (§4.6, §4.7, §5.3, §6.3)", () => {
  it("model_error sets a legible retry line that a token clears", () => {
    let s = reduce(initialState(5000), {
      type: "model_error",
      attempt: 2,
      willRetry: true,
      name: "gx10",
      code: "server",
      message: "502 status code (no body)",
      maxRetries: 2,
      baseUrl: "https://models.example.test/v1",
      modelId: "qwen",
    });
    expect(s.retrying).toBe("gx10 @ models.example.test: 502 status code (no body) — retrying (2/3)…");
    s = reduce(s, { type: "token", token: "x", done: false });
    expect(s.retrying).toBeNull();
  });

  it("a model-source error renders the legible failure block plus one hint line", () => {
    let s = reduce(initialState(5000), {
      type: "model_error",
      attempt: 3,
      willRetry: false,
      name: "gx10",
      code: "server",
      message: "502 status code (no body)",
      maxRetries: 2,
      baseUrl: "https://models.example.test/v1",
      modelId: "qwen",
    });
    s = reduce(s, { type: "error", source: "model", message: "502 status code (no body)" });
    const texts = s.blocks.map((b) => (b as { text?: string }).text ?? "");
    expect(texts.some((t) => t === "gx10 @ models.example.test: 502 status code (no body) after 3 attempts.")).toBe(true);
    expect(texts.some((t) => /model server is not responding/.test(t))).toBe(true);
    // D5 (cli §10.1): the block also tells the user the /model escape.
    expect(texts.some((t) => t.includes("/model"))).toBe(true);
    expect(s.retrying).toBeNull();
  });

  it("context_compacted and context_overflow commit info/error lines", () => {
    let s = reduce(initialState(5000), { type: "context_compacted", turnsFolded: 4 });
    expect((s.blocks[0] as { text: string }).text).toContain("compacted 4 turns");
    s = reduce(s, { type: "context_overflow", message: "window exceeded" });
    expect((s.blocks[1] as { glyph: string; text: string })).toMatchObject({ glyph: "error", text: "window exceeded" });
  });

  it("worker_status upserts a worker row by id and reasoning stays uncommitted", () => {
    let s = reduce(initialState(5000), { type: "worker_status", workerId: "w1", status: "running", tool: "write_file" });
    s = reduce(s, { type: "worker_status", workerId: "w1", status: "succeeded" });
    expect(s.workers).toHaveLength(1);
    expect(s.workers[0]).toMatchObject({ workerId: "w1", status: "succeeded" });
    s = reduce(s, { type: "reasoning", token: "think", done: false });
    expect(s.reasoning).toBe("think");
    // Reasoning is never committed to Static.
    expect(s.blocks.find((b) => "text" in b && b.text === "think")).toBeUndefined();
  });

  it("model_changed and empty warning", () => {
    let s = reduce(initialState(5000), { type: "model_changed", name: "gpt-4o" });
    expect(s.model).toBe("gpt-4o");
    const before = s.blocks.length;
    s = reduce(s, { type: "warning", category: "cli", message: "" });
    // §4.7 — an empty message renders a generic warning sentence, not the bare
    // category and not a dropped line.
    expect(s.blocks.length).toBe(before + 1);
    expect((s.blocks[s.blocks.length - 1] as { text: string }).text).toBe("A cli warning was raised.");
  });
});

describe("committed welcome block (§5.1)", () => {
  const info = { version: "1.2.3", workspaceRoot: "/ws", sessionId: "abcd1234", branch: null, showTips: true, columns: 100 };

  it("withWelcome pins the welcome as the first committed block", () => {
    const s = withWelcome(initialState(5000), info);
    expect(s.blocks[0]).toEqual({ kind: "welcome", info });
  });

  it("the scrollback cap never drops the pinned welcome block", () => {
    let s = withWelcome(initialState(3), info);
    for (let i = 0; i < 10; i++) s = reduce(s, { type: "warning", category: "cli", message: `w${i}` });
    expect(s.blocks).toHaveLength(3);
    expect(s.blocks[0]).toMatchObject({ kind: "welcome" }); // welcome kept at top
    // The two newest content blocks follow it; the oldest content is dropped.
    expect((s.blocks[1] as { text: string }).text).toBe("w8");
    expect((s.blocks[2] as { text: string }).text).toBe("w9");
  });

  it("blockLines renders the welcome as a one-line marker in the scroll projection", () => {
    const s = withWelcome(initialState(5000), info);
    const lines = blockLines(s.blocks);
    expect(lines[0]).toBe("VoidRift 1.2.3");
    // No block-letter glyph rows leak into the plain scroll projection.
    expect(lines.some((l) => l.includes("██"))).toBe(false);
  });

  it("seedResume paints prior turns and a resume line after the welcome (§5.1)", () => {
    const base = withWelcome(initialState(5000), info);
    const s = seedResume(
      base,
      [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "tool", content: "tool noise not painted" },
      ],
      { summary: "resumed: 2 turns", pendingCount: 1, staleDocuments: ["README.md"] },
    );
    expect(s.blocks[0]).toMatchObject({ kind: "welcome" }); // banner stays at top
    expect(s.blocks[1]).toMatchObject({ kind: "user", text: "q1" });
    expect(s.blocks[2]).toMatchObject({ kind: "assistant", text: "a1" });
    // The tool message is NOT re-painted — the feed shows turns, not the chain.
    expect(s.blocks.some((b) => b.kind === "user" && b.text.includes("tool noise"))).toBe(false);
    // The resume line is the last block, carrying summary + pending + stale.
    const last = s.blocks[s.blocks.length - 1]!;
    expect(last).toMatchObject({ kind: "resume", summary: "resumed: 2 turns", pendingCount: 1, staleDocuments: ["README.md"] });
  });

  it("seedResume with no context still appends an (empty) resume block in order", () => {
    const base = withWelcome(initialState(5000), info);
    const s = seedResume(base, [], {});
    expect(s.blocks[0]).toMatchObject({ kind: "welcome" });
    expect(s.blocks[s.blocks.length - 1]).toMatchObject({ kind: "resume" });
  });

  it("seedResume maps LangChain `human`/`ai` roles (the core MessageDTO shape), not just user/assistant (§5.1)", () => {
    // Regression: `session.loadMessages` returns `role = message.getType()`,
    // i.e. `human`/`ai`/`tool` — the CLI must paint those, not only the
    // `user`/`assistant` convention, or a resumed chat shows no prior turns.
    const base = withWelcome(initialState(5000), info);
    const s = seedResume(
      base,
      [
        { role: "human", content: "First question for resume" },
        { role: "ai", content: "the restored answer" },
        { role: "tool", content: "tool noise not painted" },
      ],
      { summary: "idle" },
    );
    expect(s.blocks[1]).toMatchObject({ kind: "user", text: "First question for resume" });
    expect(s.blocks[2]).toMatchObject({ kind: "assistant", text: "the restored answer" });
    expect(s.blocks.some((b) => b.kind === "user" && b.text.includes("tool noise"))).toBe(false);
    expect(s.blocks[s.blocks.length - 1]).toMatchObject({ kind: "resume", summary: "idle" });
  });
});

/** Stream `text` through the reducer in `size`-char token chunks (§4.2). */
function streamTokens(s: ReturnType<typeof initialState>, text: string, size = 7): ReturnType<typeof initialState> {
  for (let i = 0; i < text.length; i += size) {
    const chunk = text.slice(i, i + size);
    const done = i + size >= text.length;
    s = reduce(s, { type: "token", token: chunk, done });
  }
  return s;
}

/** The assistant blocks committed to Static so far. */
function assistants(blocks: Block[]): Extract<Block, { kind: "assistant" }>[] {
  return blocks.filter((b): b is Extract<Block, { kind: "assistant" }> => b.kind === "assistant");
}

describe("buffered rendering: hidden assistant buffer (§1.4, §4.2)", () => {
  it("300 streamed tokens commit NOTHING to Static until the turn completes, then exactly one segment", () => {
    let s = pushUser(initialState(5000), "q");
    // 300 one-char tokens: the whole reply accumulates in the hidden buffer.
    const text = "x".repeat(300);
    s = streamTokens(s, text, 1);
    // ZERO assistant blocks committed while streaming (nothing flashes).
    expect(assistants(s.blocks)).toHaveLength(0);
    expect(s.streaming).toBe(text);
    // The status line reads `Responding` with the running token estimate.
    expect(statusLine(s)?.verb).toBe("Responding");
    // Exactly ONE commit of the full segment on completion.
    s = reduce(s, { type: "turn_complete", status: "completed", text, usage: { promptTokens: 1, completionTokens: 75, totalMs: 100 } });
    const committed = assistants(s.blocks);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.text).toBe(text);
    expect(s.streaming).toBe("");
  });

  it("assistant text before a tool call commits as its own segment BEFORE the tool group", () => {
    let s = pushUser(initialState(5000), "q");
    s = streamTokens(s, "Here is what I found.", 4);
    // No commit yet — the message buffers.
    expect(assistants(s.blocks)).toHaveLength(0);
    // A tool round begins: the assistant segment commits first, whole.
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
    expect(assistants(s.blocks)).toHaveLength(1);
    expect(assistants(s.blocks)[0]!.text).toBe("Here is what I found.");
    expect(s.streaming).toBe("");
    // The tool group commits only when the round finishes.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 10, summary: "(2 lines)" });
    const groups = s.blocks.filter((b) => b.kind === "toolgroup");
    expect(groups).toHaveLength(1);
    // Order: assistant segment precedes the tool group.
    const aIdx = s.blocks.findIndex((b) => b.kind === "assistant");
    const gIdx = s.blocks.findIndex((b) => b.kind === "toolgroup");
    expect(aIdx).toBeLessThan(gIdx);
  });

  it("a tool round of 3 calls draws NO rows while running and commits ONE group", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_started", id: "t2", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_started", id: "t3", name: "read_file", args: {} });
    // Three tools in flight, nothing committed.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
    expect(s.tools).toHaveLength(3);
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 5, summary: "" });
    s = reduce(s, { type: "tool_finished", id: "t2", name: "read_file", status: "success", durationMs: 5, summary: "" });
    // Still no group — the round is not finished.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
    s = reduce(s, { type: "tool_finished", id: "t3", name: "read_file", status: "success", durationMs: 5, summary: "" });
    // One group, three calls, committed in one update.
    const groups = s.blocks.filter((b): b is Extract<Block, { kind: "toolgroup" }> => b.kind === "toolgroup");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.calls).toHaveLength(3);
    expect(s.pendingCalls).toHaveLength(0);
  });

  it("cancel mid-text commits the buffered text exactly once with the cancelled marker", () => {
    let s = pushUser(initialState(5000), "q");
    s = streamTokens(s, "partial answer so far", 5);
    s = reduce(s, { type: "turn_cancelled" });
    const committed = assistants(s.blocks);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ text: "partial answer so far", cancelled: true });
    expect(s.streaming).toBe("");
    // A second cancel (idempotent guard) adds nothing.
    const before = s.blocks.length;
    s = reduce(s, { type: "turn_cancelled" });
    expect(s.blocks.length).toBe(before);
  });

  it("cancel during a partial tool round commits the pending calls once as a group", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_started", id: "t2", name: "read_file", args: {} });
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 5, summary: "" });
    // One finished, one still running → cancel.
    s = reduce(s, { type: "turn_cancelled" });
    const groups = s.blocks.filter((b): b is Extract<Block, { kind: "toolgroup" }> => b.kind === "toolgroup");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.calls).toHaveLength(1);
    expect(s.pendingCalls).toHaveLength(0);
    expect(s.tools).toHaveLength(0);
  });

  it("limit_reached commits the carried result and appends the notice from the payload", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, {
      type: "turn_complete",
      status: "limit_reached",
      text: "I used my steps.",
      notice: "Step limit reached (12). Say continue to resume.",
      usage: { promptTokens: 1, completionTokens: 4, totalMs: 100 },
    });
    const texts = s.blocks.map((b) => (b as { text?: string }).text ?? "");
    expect(texts).toContain("I used my steps.");
    expect(texts).toContain("Step limit reached (12). Say continue to resume.");
  });

  it("limit_reached with no notice on the payload shows the canonical text", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "turn_complete", status: "limit_reached", text: "done", usage: { promptTokens: 1, completionTokens: 1, totalMs: 10 } });
    const last = s.blocks[s.blocks.length - 1];
    expect(last).toMatchObject({ kind: "info", glyph: "info" });
    expect((last as { text: string }).text).toContain("Step limit reached");
  });
});

describe("turn_complete per-segment reconciliation (§4.2)", () => {
  // Commit a mid-turn assistant segment the way the engine does: stream text,
  // then begin a tool round (which flushes the buffer into `streamCommitted`),
  // then finish the round so the next segment can stream.
  function midTurnSegment(s: ReturnType<typeof initialState>, text: string, id: string): ReturnType<typeof initialState> {
    s = streamTokens(s, text, 4);
    s = reduce(s, { type: "tool_started", id, name: "read_file", args: {} });
    s = reduce(s, { type: "tool_finished", id, name: "read_file", status: "success", durationMs: 1, summary: "" });
    return s;
  }

  it("2 mid-turn segments + a final segment, authoritative text joined with '\\n\\n', commit once each (no duplicate)", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "seg one", "t1");
    s = midTurnSegment(s, "seg two", "t2");
    s = streamTokens(s, "seg three", 4);
    // Authoritative whole reply uses the same '\n\n' join.
    const full = "seg one\n\nseg two\n\nseg three";
    s = reduce(s, { type: "turn_complete", status: "completed", text: full, usage: { promptTokens: 1, completionTokens: 9, totalMs: 10 } });
    const texts = assistants(s.blocks).map((b) => b.text);
    expect(texts).toEqual(["seg one", "seg two", "seg three"]);
    // "seg one"/"seg two" are NOT present a second time concatenated.
    expect(texts.filter((t) => t.includes("seg one"))).toHaveLength(1);
  });

  it("3 mid-turn segments, authoritative text joined with a SINGLE newline, commits only the remainder", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "alpha", "t1");
    s = midTurnSegment(s, "beta", "t2");
    s = midTurnSegment(s, "gamma", "t3");
    s = streamTokens(s, "delta", 4);
    // The authoritative reply joins with single newlines, not '\n\n'.
    const full = "alpha\nbeta\ngamma\ndelta";
    s = reduce(s, { type: "turn_complete", status: "completed", text: full, usage: { promptTokens: 1, completionTokens: 5, totalMs: 10 } });
    const texts = assistants(s.blocks).map((b) => b.text);
    // Only the uncommitted remainder ("delta") is added; the three prior
    // segments are NOT re-committed as one duplicate block.
    expect(texts).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(texts.some((t) => t.includes("alpha") && t.includes("beta"))).toBe(false);
  });

  it("segments joined with NO separator in the authoritative text still reconcile", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "one", "t1");
    s = midTurnSegment(s, "two", "t2");
    s = streamTokens(s, "three", 4);
    const full = "onetwothree";
    s = reduce(s, { type: "turn_complete", status: "completed", text: full, usage: { promptTokens: 1, completionTokens: 3, totalMs: 10 } });
    const texts = assistants(s.blocks).map((b) => b.text);
    expect(texts).toEqual(["one", "two", "three"]);
  });

  it("segments joined with EXTRA whitespace in the authoritative text strip cleanly", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "first", "t1");
    s = midTurnSegment(s, "second", "t2");
    s = streamTokens(s, "third", 4);
    const full = "first \n\n\n  second\n\n   third";
    s = reduce(s, { type: "turn_complete", status: "completed", text: full, usage: { promptTokens: 1, completionTokens: 3, totalMs: 10 } });
    const texts = assistants(s.blocks).map((b) => b.text);
    // Mid-turn segments committed with their own (unpadded) text; the final
    // remainder is "third" with its leading join whitespace trimmed.
    expect(texts).toEqual(["first", "second", "third"]);
  });

  it("every byte already committed (no remainder) commits no extra assistant block", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "done one", "t1");
    s = midTurnSegment(s, "done two", "t2");
    // No further streaming; the authoritative text is exactly the two segments.
    const full = "done one\ndone two";
    s = reduce(s, { type: "turn_complete", status: "completed", text: full, usage: { promptTokens: 1, completionTokens: 4, totalMs: 10 } });
    expect(assistants(s.blocks).map((b) => b.text)).toEqual(["done one", "done two"]);
  });

  it("cancel after 2 mid-turn segments commits the live buffer once; the segments are not duplicated", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "committed A", "t1");
    s = midTurnSegment(s, "committed B", "t2");
    s = streamTokens(s, "live tail", 4);
    s = reduce(s, { type: "turn_cancelled" });
    const texts = assistants(s.blocks).map((b) => b.text);
    expect(texts).toEqual(["committed A", "committed B", "live tail"]);
    expect(assistants(s.blocks).find((b) => b.text === "live tail")!.cancelled).toBe(true);
  });

  it("error after 2 mid-turn segments commits the live buffer once with the marker; no duplicate segments", () => {
    let s = pushUser(initialState(5000), "q");
    s = midTurnSegment(s, "part 1", "t1");
    s = midTurnSegment(s, "part 2", "t2");
    s = streamTokens(s, "partial before error", 4);
    s = reduce(s, { type: "error", source: "model", message: "boom" });
    const texts = assistants(s.blocks).map((b) => b.text);
    expect(texts).toEqual(["part 1", "part 2", "partial before error"]);
    expect(assistants(s.blocks).find((b) => b.text === "partial before error")!.cancelled).toBe(true);
  });
});

describe("buffered status line (§4.2, §4.4)", () => {
  it("reads Thinking before the first token, Responding once text buffers", () => {
    let s = pushUser(initialState(5000), "q");
    // streamOpen true, no tokens yet → Thinking.
    expect(statusLine(s)?.verb).toBe("Thinking");
    s = reduce(s, { type: "token", token: "hi", done: false });
    expect(statusLine(s)?.verb).toBe("Responding");
  });

  it("derives the tool verb from the running tool, followed by the target (§4.2)", () => {
    const run = (name: string, args: Record<string, unknown>): string | undefined => {
      let s = reduce(initialState(5000), { type: "tool_started", id: "t1", name, args });
      return statusLine(s)?.verb;
    };
    // Reads → Reading; search → Searching; web_fetch → Fetching; exec → Running.
    expect(run("read_file", { path: "a.ts" })).toBe("Reading a.ts");
    expect(run("glob_files", { pattern: "**/*.ts" })).toBe("Reading **/*.ts");
    expect(run("workspace_map", { path: "src" })).toBe("Reading src");
    expect(run("search_contents", { pattern: "foo" })).toBe("Searching foo");
    expect(run("web_search", { query: "bar" })).toBe("Searching bar");
    expect(run("web_fetch", { url: "https://x" })).toBe("Fetching https://x");
    expect(run("execute_command", { command: "ls -la" })).toBe("Running ls -la");
  });

  it("reads Saving/Editing with the target ONLY while a mutating tool runs (§4.2)", () => {
    const run = (name: string, args: Record<string, unknown>): string | undefined => {
      let s = reduce(initialState(5000), { type: "tool_started", id: "t1", name, args });
      return statusLine(s)?.verb;
    };
    expect(run("write_file", { path: "out.ts" })).toBe("Saving out.ts");
    expect(run("edit_file", { path: "out.ts" })).toBe("Editing out.ts");
    expect(run("researcher_save_notes", { path: ".voidrift/research/n.md" })).toBe("Saving .voidrift/research/n.md");
    expect(run("save_memory", { title: "a fact" })).toBe("Saving a fact");
    expect(run("delete_memory", { title: "a fact" })).toBe("Saving a fact");
  });

  it("truncates and sanitizes an over-long mutating target (§4.2)", () => {
    const s = reduce(initialState(5000), { type: "tool_started", id: "t1", name: "save_memory", args: { title: "x".repeat(200) } });
    const verb = statusLine(s)!.verb;
    expect(verb.startsWith("Saving ")).toBe(true);
    expect(verb.endsWith("…")).toBe(true);
    expect(verb.length).toBeLessThanOrEqual("Saving ".length + 60);
  });

  it("reads the tool verb while a single tool runs, and null when idle", () => {
    let s = initialState(5000);
    expect(statusLine(s)).toBeNull();
    s = reduce(s, { type: "tool_started", id: "t1", name: "read_file", args: { path: "a.ts" } });
    expect(statusLine(s)?.verb).toBe("Reading a.ts");
    s = reduce(s, { type: "tool_finished", id: "t1", name: "read_file", status: "success", durationMs: 1, summary: "" });
    expect(statusLine(s)).toBeNull();
  });

  it("statusLine returns null during a fan-out of ≥ 2 workers — the panel replaces it (§4.2/§4.4)", () => {
    // Batch form: a single `task` call carrying 3 tasks seeds a 3-row fan-out,
    // so statusLine yields no status row (LiveFanout owns the region).
    const batch = reduce(initialState(5000), {
      type: "tool_started",
      id: "t1",
      name: "task",
      args: { tasks: [{ worker: "a", task: "p" }, { worker: "b", task: "q" }, { worker: "c", task: "r" }] },
    });
    expect(batch.fanout?.rows.length).toBe(3);
    expect(statusLine(batch)).toBeNull();
    // Separate-call form: ≥ 2 concurrent `task` calls seed the fan-out the same
    // way; statusLine is null once the second call makes it ≥ 2 rows.
    let sep = reduce(initialState(5000), { type: "tool_started", id: "a", name: "task", args: { worker: "x", task: "1" } });
    // A single in-flight `task` is NOT yet a fan-out (no panel) — it reads its verb.
    expect(sep.fanout).toBeNull();
    expect(statusLine(sep)?.verb).toBe("Running");
    sep = reduce(sep, { type: "tool_started", id: "b", name: "task", args: { worker: "y", task: "2" } });
    expect(sep.fanout?.rows.length).toBe(2);
    expect(statusLine(sep)).toBeNull();
  });

  it("surfaces the running token count, estimated (~) then core-reported (bare)", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "token", token: "12345678", done: false }); // 8 chars → ~2
    expect(s.tokenCount).toBe(2);
    expect(s.tokenCountEstimated).toBe(true);
    s = reduce(s, { type: "model_usage", promptTokens: 10, inputSum: 10, completionTokens: 40, cacheReadTokens: 0, genMs: 0, estimated: false });
    expect(s.tokenCount).toBe(40);
    expect(s.tokenCountEstimated).toBe(false);
  });
});

describe("fan-out group commit (§4.4)", () => {
  it("a single `task` call with a 3-worker batch commits one fanout block of 3 rows", () => {
    let s = pushUser(initialState(5000), "q");
    s = reduce(s, { type: "tool_started", id: "t1", name: "task", args: { tasks: [{ id: "x", worker: "a", task: "p" }, { id: "y", worker: "b", task: "q" }, { id: "z", worker: "c", task: "r" }] } });
    expect(s.fanout?.rows).toHaveLength(3);
    s = reduce(s, { type: "worker_status", workerId: "t1-w1", status: "succeeded", taskId: "x", agent: "a" });
    s = reduce(s, { type: "worker_status", workerId: "t1-w2", status: "succeeded", taskId: "y", agent: "b" });
    s = reduce(s, { type: "worker_status", workerId: "t1-w3", status: "succeeded", taskId: "z", agent: "c" });
    s = reduce(s, { type: "tool_finished", id: "t1", name: "task", status: "success", durationMs: 100, summary: "done" });
    const fanouts = s.blocks.filter((b): b is Extract<Block, { kind: "fanout" }> => b.kind === "fanout");
    expect(fanouts).toHaveLength(1);
    expect(fanouts[0]!.agents).toBe(3);
    expect(fanouts[0]!.rows).toHaveLength(3);
    expect(fanouts[0]!.rows.every((row) => row.status === "done")).toBe(true);
    // A fan-out commits NO ordinary tool group for its `task` call.
    expect(s.blocks.filter((b) => b.kind === "toolgroup")).toHaveLength(0);
  });
});

describe("§4.7 — suggestion/read-lane/surprise render as dim info, true warnings as ⚠", () => {
  const lastBlock = (s: ReturnType<typeof initialState>) => s.blocks[s.blocks.length - 1] as { glyph: string; text: string };

  it("maps WARNING_EMITTED carrying a message, keeping category", () => {
    const ev: EventEnvelope = {
      type: "WARNING_EMITTED",
      at: "t",
      scope: { session: "s1" },
      payload: { category: "suggestion", source: "sequence-detector", message: "Repeated pattern: Read → Write (seen in 3 sessions). review with /memory." },
    } as never;
    expect(mapSessionEvent(ev)).toEqual({
      type: "warning",
      category: "suggestion",
      message: "Repeated pattern: Read → Write (seen in 3 sessions). review with /memory.",
    });
  });

  it("a suggestion renders as a dim ℹ info line, not a ⚠ warning (shows the message, not 'suggestion')", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "warning", category: "suggestion", message: "Repeated pattern: Read → Write (seen in 3 sessions)." });
    const b = lastBlock(s);
    expect(b.glyph).toBe("info");
    expect(b.text).toBe("Repeated pattern: Read → Write (seen in 3 sessions).");
    expect(b.text).not.toBe("suggestion");
  });

  it("shows at most one info line per category per turn, and allows it again next turn", () => {
    let s = pushUser(initialState(5000), "hi");
    const before = s.blocks.length;
    s = reduce(s, { type: "warning", category: "suggestion", message: "first" });
    s = reduce(s, { type: "warning", category: "suggestion", message: "second (suppressed)" });
    expect(s.blocks.length).toBe(before + 1);
    expect(lastBlock(s).text).toBe("first");
    // A different category this turn still shows once.
    s = reduce(s, { type: "warning", category: "surprise", message: "a surprise" });
    expect(lastBlock(s).text).toBe("a surprise");
    // A new turn resets the per-turn dedup.
    s = pushUser(s, "again");
    s = reduce(s, { type: "warning", category: "suggestion", message: "next turn" });
    expect(lastBlock(s).text).toBe("next turn");
  });

  it("a notice with no message renders a generic sentence, never the bare category", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "warning", category: "suggestion", message: undefined });
    const b = lastBlock(s);
    expect(b.glyph).toBe("info");
    expect(b.text).toBe("A suggestion is available; review with /memory.");
  });

  it("a read-lane notice renders dim ℹ once per turn", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "warning", category: "read-lane", message: undefined });
    expect(lastBlock(s).glyph).toBe("info");
    expect(lastBlock(s).text).toContain("delegating");
  });

  it("a true warning (other category) keeps the ⚠ warn glyph", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "warning", category: "fallback", message: "web search fell back" });
    expect(lastBlock(s).glyph).toBe("warn");
    expect(lastBlock(s).text).toBe("web search fell back");
  });
});

describe("§4.2/§6.1 — Waiting for approval status (reducer)", () => {
  it("while an approval is pending the status reads `Waiting for approval` and restores the verb after", () => {
    let s = initialState(1000);
    s = pushUser(s, "do it"); // starts the turn clock
    s = reduce(s, { type: "tool_started", id: "t1", name: "execute_command", args: { command: "x" } });
    // Running verb before the ask.
    expect(statusLine(s)?.verb).not.toBe("Waiting for approval");
    // The ask opens: the line switches to Waiting for approval (no running verb).
    s = reduce(s, { type: "approval_pending", pending: true });
    expect(statusLine(s)?.verb).toBe("Waiting for approval");
    expect(s.approvalPending).toBe(true);
    expect(s.approvalStartedAt).not.toBeNull();
    // Resolve: the flag clears and the normal verb returns.
    s = reduce(s, { type: "approval_pending", pending: false });
    expect(s.approvalPending).toBe(false);
    expect(s.approvalStartedAt).toBeNull();
    expect(statusLine(s)?.verb).not.toBe("Waiting for approval");
  });

  it("the frozen approval start time is kept while pending (the timer does not re-arm)", () => {
    let s = initialState(1000);
    s = pushUser(s, "go");
    s = reduce(s, { type: "approval_pending", pending: true });
    const first = s.approvalStartedAt;
    s = reduce(s, { type: "approval_pending", pending: true });
    expect(s.approvalStartedAt).toBe(first);
  });
});

describe("§4.4 fan-out reducer helpers", () => {
  it("fanoutRowStatus folds core worker states to display states", () => {
    expect(fanoutRowStatus("succeeded")).toBe("done");
    expect(fanoutRowStatus("merged")).toBe("done");
    expect(fanoutRowStatus("reviewed")).toBe("done");
    expect(fanoutRowStatus("failed")).toBe("failed");
    expect(fanoutRowStatus("skipped")).toBe("skipped");
    expect(fanoutRowStatus("aborted")).toBe("cancelled");
    expect(fanoutRowStatus("running")).toBe("running");
    expect(fanoutRowStatus("needs_review")).toBe("running");
  });

  it("fanoutTitle prefers the task id, else the sanitized/truncated brief", () => {
    expect(fanoutTitle("a", "a long brief")).toBe("a");
    expect(fanoutTitle(undefined, "survey the api surface")).toBe("survey the api surface");
    expect(fanoutTitle("", "fallback")).toBe("fallback");
    // control/bidi stripped; whitespace collapsed.
    expect(fanoutTitle(undefined, "x\u202e y\t z")).toBe("x y z");
    expect(fanoutTitle(undefined, "y".repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it("seedFanoutRows reads the batch tasks[] and the single-call form", () => {
    const batch = seedFanoutRows({ tasks: [{ id: "a", worker: "researcher", task: "x" }, { id: "b", worker: "planner", task: "y" }] });
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({ worker: "researcher", taskId: "a", title: "a", status: "dispatched" });
    const single = seedFanoutRows({ worker: "implementer", task: "do a thing" });
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ worker: "implementer", title: "do a thing", status: "dispatched" });
  });

  it("blockLines projects a committed fan-out block with its rows and durations", () => {
    let s = initialState(5000);
    s = reduce(s, { type: "token", token: "", done: true });
    s = { ...s, blocks: [...s.blocks, { kind: "fanout", agents: 2, rows: [
      { worker: "researcher", title: "a", status: "done", startedAt: 0, finishedAt: 2000 },
      { worker: "planner", title: "b", status: "failed", reason: "boom" },
    ] } as Block] };
    const lines = blockLines(s.blocks);
    expect(lines.some((l) => l.includes("Orchestrated (2 agents)"))).toBe(true);
    expect(lines.some((l) => l.includes("researcher") && l.includes("done") && l.includes("2.0s"))).toBe(true);
    expect(lines.some((l) => l.includes("planner") && l.includes("failed"))).toBe(true);
    expect(lines.some((l) => l.includes("boom"))).toBe(true);
  });
});

describe("§13.11 — LIMIT_HIT renders one dim ℹ line per key per turn", () => {
  const lastBlock = (s: ReturnType<typeof initialState>) => s.blocks[s.blocks.length - 1] as { glyph: string; text: string };

  it("maps LIMIT_HIT to a limit_hit effect carrying the key and sanitized notice", () => {
    const ev: EventEnvelope = {
      type: "LIMIT_HIT",
      at: "t",
      scope: { session: "s1" },
      payload: {
        key: "tools.commandOutputMaxBytes",
        area: "tools",
        value: 100000,
        notice: "command output truncated (limits.tools.commandOutputMaxBytes = 100000). Raise it in config: limits.tools.commandOutputMaxBytes",
      },
    } as never;
    expect(mapSessionEvent(ev)).toEqual({
      type: "limit_hit",
      key: "tools.commandOutputMaxBytes",
      notice: "command output truncated (limits.tools.commandOutputMaxBytes = 100000). Raise it in config: limits.tools.commandOutputMaxBytes",
    });
  });

  it("renders one dim ℹ info line naming the key", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "limit_hit", key: "tools.commandOutputMaxBytes", notice: "command output truncated (limits.tools.commandOutputMaxBytes = 100000). Raise it in config: limits.tools.commandOutputMaxBytes" });
    const b = lastBlock(s);
    expect(b.glyph).toBe("info");
    expect(b.text).toContain("limits.tools.commandOutputMaxBytes");
  });

  it("shows at most one line per key per turn, re-arms next turn", () => {
    let s = pushUser(initialState(5000), "hi");
    const before = s.blocks.length;
    s = reduce(s, { type: "limit_hit", key: "tools.commandOutputMaxBytes", notice: "first" });
    s = reduce(s, { type: "limit_hit", key: "tools.commandOutputMaxBytes", notice: "second (suppressed)" });
    expect(s.blocks.length).toBe(before + 1);
    expect(lastBlock(s).text).toBe("first");
    // A different key this turn still shows once.
    s = reduce(s, { type: "limit_hit", key: "context.excerptLineMaxChars", notice: "other key" });
    expect(lastBlock(s).text).toBe("other key");
    // A new turn re-arms the per-key line.
    s = pushUser(s, "again");
    s = reduce(s, { type: "limit_hit", key: "tools.commandOutputMaxBytes", notice: "next turn" });
    expect(lastBlock(s).text).toBe("next turn");
  });
});

describe("§8.7 — INGEST renders one dim ℹ line per limit key per turn", () => {
  const lastBlock = (s: ReturnType<typeof initialState>) => s.blocks[s.blocks.length - 1] as { glyph: string; text: string };

  it("maps INGEST to an ingest effect carrying source, chunks, cacheHit, limit key", () => {
    expect(
      mapSessionEvent(env("INGEST", { source: "README.md", kind: "file", chunks: 7, cacheHit: false, key: "ingest.fitFraction" })),
    ).toEqual({ type: "ingest", source: "README.md", chunks: 7, cacheHit: false, limitKey: "ingest.fitFraction" });
  });

  it("renders one dim ℹ info line naming the file, chunk count and limit key", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "ingest", source: "README.md", chunks: 7, cacheHit: false, limitKey: "ingest.fitFraction" });
    const b = lastBlock(s);
    expect(b.glyph).toBe("info");
    expect(b.text).toContain("Ingested README.md as a digest (7 chunks)");
    expect(b.text).toContain("limits.ingest.fitFraction");
  });

  it("marks a cache hit and shows at most one line per key per turn, re-arms next turn", () => {
    let s = pushUser(initialState(5000), "hi");
    const before = s.blocks.length;
    s = reduce(s, { type: "ingest", source: "a.md", chunks: 1, cacheHit: true, limitKey: "ingest.fitFraction" });
    expect(lastBlock(s).text).toContain("from cache");
    expect(lastBlock(s).text).toContain("1 chunk)"); // singular
    s = reduce(s, { type: "ingest", source: "b.md", chunks: 2, cacheHit: false, limitKey: "ingest.fitFraction" });
    expect(s.blocks.length).toBe(before + 1); // suppressed (same key)
    s = pushUser(s, "again");
    s = reduce(s, { type: "ingest", source: "c.md", chunks: 3, cacheHit: false, limitKey: "ingest.fitFraction" });
    expect(lastBlock(s).text).toContain("c.md");
  });

  it("sanitizes a hostile source name", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "ingest", source: "a\u001b[31m\u202eb.md", chunks: 1, cacheHit: false, limitKey: "ingest.fitFraction" });
    expect(lastBlock(s).text).not.toMatch(/[\u001b\u202e]/);
  });
});

describe("§8.7 — BY_REFERENCE renders one dim ℹ line per kind per turn", () => {
  const lastBlock = (s: ReturnType<typeof initialState>) => s.blocks[s.blocks.length - 1] as { glyph: string; text: string };

  it("maps BY_REFERENCE to a by_reference effect carrying kind and bytes", () => {
    expect(mapSessionEvent(env("BY_REFERENCE", { what: "brief", bytes: 123456, key: "task.briefMaxBytes" }))).toEqual({
      type: "by_reference",
      kind: "brief",
      bytes: 123456,
    });
  });

  it("renders one dim ℹ line naming the kind and KB, once per kind per turn", () => {
    let s = pushUser(initialState(5000), "hi");
    s = reduce(s, { type: "by_reference", kind: "brief", bytes: 2048 });
    const b = lastBlock(s);
    expect(b.glyph).toBe("info");
    expect(b.text).toBe("brief passed by reference (2 KB)");
    const before = s.blocks.length;
    s = reduce(s, { type: "by_reference", kind: "brief", bytes: 9999 });
    expect(s.blocks.length).toBe(before); // suppressed (same kind)
    // A different kind still shows.
    s = reduce(s, { type: "by_reference", kind: "result", bytes: 4096 });
    expect(lastBlock(s).text).toBe("result passed by reference (4 KB)");
  });
});

describe("worker events through the real path do not pollute the orchestrator transcript (§4.4, §7.2)", () => {
  /** Drive an event envelope through the SAME mapper the subscription uses, then
   * the reducer — the real path (core event → ViewEffect → view state). A null
   * effect (a dropped worker-scoped transcript event) leaves state untouched. */
  function apply(s: ViewState, ev: EventEnvelope): ViewState {
    const effect = mapSessionEvent(ev);
    return effect ? reduce(s, effect) : s;
  }

  it("a 3-worker fan-out: worker prose + worker tool calls never enter the transcript; rows transition and commit all-final (never cancelled)", () => {
    const sid = "s1";
    let s = pushUser(initialState(5000), "orchestrate");
    // Orchestrator's own `task` call (session scope) seeds the fan-out rows.
    s = apply(s, env("TOOL_STARTED", {
      id: "b1",
      name: "task",
      args: {
        tasks: [
          { id: "a", worker: "researcher", task: "survey a" },
          { id: "b", worker: "researcher", task: "survey b" },
          { id: "c", worker: "planner", task: "plan", dependsOn: ["a", "b"] },
        ],
      },
    }, { session: sid }));
    expect(s.fanout?.rows).toHaveLength(3);
    // §4.4 — `a`/`b` seed as `dispatched`; `c` dependsOn [a,b] so it seeds as
    // `waiting` until its prerequisites finish.
    expect(s.fanout?.rows.find((r) => r.taskId === "a")!.status).toBe("dispatched");
    expect(s.fanout?.rows.find((r) => r.taskId === "b")!.status).toBe("dispatched");
    expect(s.fanout?.rows.find((r) => r.taskId === "c")!.status).toBe("waiting");

    // Workers run, each emitting WORKER-scoped prose + tool calls interleaved with
    // their status transitions. The tool calls must NOT enter `state.tools` (which
    // would prematurely drain the round and commit the fan-out as `cancelled`), and
    // the prose must NOT enter the orchestrator transcript.
    const wa = { session: sid, worker: "b1-w1" };
    const wb = { session: sid, worker: "b1-w2" };
    const wc = { session: sid, worker: "b1-w3" };
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" }, wa));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w2", status: "running", taskId: "b", agent: "researcher" }, wb));
    // Worker prose + worker tool calls arrive while the round is live.
    s = apply(s, env("TOKEN_STREAM", { token: "worker A thinking ", done: false }, wa));
    s = apply(s, env("TOOL_STARTED", { id: "wa-t1", name: "read_file", args: { path: "a.ts" } }, wa));
    s = apply(s, env("TOOL_FINISHED", { id: "wa-t1", name: "read_file", status: "success", durationMs: 2, summary: "12 lines" }, wa));
    s = apply(s, env("TOKEN_STREAM", { token: "worker B prose ", done: false }, wb));
    s = apply(s, env("TOOL_STARTED", { id: "wb-t1", name: "search_contents", args: { pattern: "x" } }, wb));
    s = apply(s, env("TOOL_FINISHED", { id: "wb-t1", name: "search_contents", status: "success", durationMs: 3, summary: "4 matches" }, wb));
    // The orchestrator's `task` round is still the only live tool, and no worker
    // prose has leaked into the hidden assistant buffer.
    expect(s.tools.map((t) => t.id)).toEqual(["b1"]);
    expect(s.streaming).toBe("");

    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "merged", taskId: "a", agent: "researcher" }, wa));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w2", status: "merged", taskId: "b", agent: "researcher" }, wb));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w3", status: "running", taskId: "c", agent: "planner" }, wc));
    s = apply(s, env("TOOL_STARTED", { id: "wc-t1", name: "read_file", args: { path: "c.ts" } }, wc));
    s = apply(s, env("TOOL_FINISHED", { id: "wc-t1", name: "read_file", status: "success", durationMs: 2, summary: "9 lines" }, wc));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w3", status: "merged", taskId: "c", agent: "planner" }, wc));

    // The orchestrator's own `task` tool now finishes (after dispatch resolved).
    s = apply(s, env("TOOL_FINISHED", { id: "b1", name: "task", status: "success", durationMs: 5000, summary: "done" }, { session: sid }));

    // The committed transcript holds EXACTLY ONE fan-out block (no stray tool
    // group of worker calls) and every row is terminal (never `cancelled`).
    const toolGroups = s.blocks.filter((b) => b.kind === "toolgroup");
    expect(toolGroups).toHaveLength(0);
    const fanouts = s.blocks.filter((b) => b.kind === "fanout") as Extract<Block, { kind: "fanout" }>[];
    expect(fanouts).toHaveLength(1);
    expect(fanouts[0]!.rows).toHaveLength(3);
    expect(fanouts[0]!.rows.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(s.fanout).toBeNull();
    // No worker prose anywhere in the transcript.
    const allText = s.blocks.map((b) => (b as { text?: string }).text ?? "").join("\n");
    expect(allText).not.toContain("worker A thinking");
    expect(allText).not.toContain("worker B prose");
  });
});

describe("fan-out liveness heartbeats stamp the matching row so it shimmers (§4.4, D1)", () => {
  /** Real path: event envelope → the subscription mapper → the reducer. */
  function apply(s: ViewState, ev: EventEnvelope): ViewState {
    const effect = mapSessionEvent(ev);
    return effect ? reduce(s, effect) : s;
  }

  /** Seed a 2-row batch fan-out from the orchestrator's own `task` call. */
  function seedBatch(): ViewState {
    let s = pushUser(initialState(5000), "orchestrate");
    s = apply(s, env("TOOL_STARTED", {
      id: "b1",
      name: "task",
      args: { tasks: [{ id: "a", worker: "researcher", task: "survey a" }, { id: "b", worker: "researcher", task: "survey b" }] },
    }, { session: "s1" }));
    expect(s.fanout?.rows).toHaveLength(2);
    return s;
  }

  it("worker_status(running) then a heartbeat binds+stamps lastEventAt; a running row waves (the heartbeat does not gate it)", () => {
    let s = seedBatch();
    const w = { session: "s1", worker: "b1-w1" };
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" }, w));
    const before = Date.now();
    s = apply(s, env("TOKEN_STREAM", { token: "worker prose", done: false, taskId: "a" }, w));
    const row = s.fanout!.rows.find((r) => r.taskId === "a")!;
    expect(row.status).toBe("running");
    expect(row.lastEventAt).toBeDefined();
    expect(row.lastEventAt!).toBeGreaterThanOrEqual(before);
    // A running row always waves — the stamp is for binding only.
    expect(fanoutRowGenerating(row)).toBe(true);
    // The other row is still `dispatched` (never started), so it does not wave.
    const other = s.fanout!.rows.find((r) => r.taskId === "b")!;
    expect(other.status).not.toBe("running");
    expect(fanoutRowGenerating(other)).toBe(false);
  });

  it("a heartbeat arriving BEFORE worker_status is not lost: the row shimmers once running", () => {
    let s = seedBatch();
    const w = { session: "s1", worker: "b1-w1" };
    // The ONLY liveness signal is an early heartbeat (no taskId — the common
    // worker-scoped TOKEN_STREAM case) that arrives BEFORE the running status.
    // It must bind the first unbound row and stamp it so that, once the status
    // flips to running, the row is GENERATING without needing a later heartbeat.
    const before = Date.now();
    s = apply(s, env("TOKEN_STREAM", { token: "early worker prose", done: false }, w));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", agent: "researcher" }, w));
    const bound = s.fanout!.rows.find((r) => (r as { workerId?: string }).workerId === "b1-w1")!;
    expect(bound.status).toBe("running");
    expect(bound.lastEventAt).toBeDefined();
    expect(bound.lastEventAt!).toBeGreaterThanOrEqual(before);
    expect(fanoutRowGenerating(bound)).toBe(true);
  });

  it("a heartbeat for an unknown worker (no bindable row) is a no-op (same state object)", () => {
    let s = seedBatch();
    // Bind both rows to real workers first so none is unbound.
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" }, { session: "s1", worker: "b1-w1" }));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w2", status: "running", taskId: "b", agent: "researcher" }, { session: "s1", worker: "b1-w2" }));
    const prev = s;
    s = apply(s, env("TOKEN_STREAM", { token: "ghost", done: false }, { session: "s1", worker: "ghost-worker" }));
    expect(s).toBe(prev);
  });

  it("a heartbeat for a terminal row is a no-op (a done row never shimmers)", () => {
    let s = seedBatch();
    const w = { session: "s1", worker: "b1-w1" };
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" }, w));
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "merged", taskId: "a", agent: "researcher" }, w));
    const prev = s;
    s = apply(s, env("TOKEN_STREAM", { token: "late", done: false, taskId: "a" }, w));
    expect(s).toBe(prev);
    const row = s.fanout!.rows.find((r) => r.taskId === "a")!;
    expect(fanoutRowGenerating(row)).toBe(false);
  });

  it("a running row keeps waving past the OLD ~1.5s window — the state gates the wave, not event recency (regression D1)", () => {
    let s = seedBatch();
    const w = { session: "s1", worker: "b1-w1" };
    s = apply(s, env("WORKER_STATUS_CHANGED", { workerId: "b1-w1", status: "running", taskId: "a", agent: "researcher" }, w));
    s = apply(s, env("TOKEN_STREAM", { token: "worker prose", done: false, taskId: "a" }, w));
    const row = s.fanout!.rows.find((r) => r.taskId === "a")!;
    // The old gate flipped this SILENT past ~1.5s; now a running row always
    // waves, no matter how stale its lastEventAt (a slow single tool call).
    expect(fanoutRowGenerating({ ...row, lastEventAt: row.lastEventAt! - 3000 })).toBe(true);
    const { lastEventAt: _unused, ...rowNoEvent } = row;
    expect(fanoutRowGenerating(rowNoEvent)).toBe(true);
  });
});
