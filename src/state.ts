/**
 * CLI view state (cli-blueprint.md §1.1).
 *
 * The CLI holds only view state and derives everything else from events and
 * DTOs. This module defines the view model and a pure reducer that applies a
 * `ViewEffect` (events/subscriptions.ts) — no CoreAPI call, no async (§1.4).
 */
import type { ViewEffect } from "./events/subscriptions.js";
import { deriveCost } from "@voidrift/core";
import { formatRetryLine, formatModelFailure, MODEL_SWITCH_HINT, type ModelErrorInfo } from "./render/model-error.js";

/** The welcome block's pure data, committed once as the first scrollback block
 * so Ink `<Static>` prints the banner once and never repaints it (§5.1). */
export interface WelcomeInfo {
  version: string;
  workspaceRoot: string;
  sessionId: string;
  branch: string | null;
  showTips: boolean;
  columns: number;
}

/** One completed tool call inside a group (§4.4). */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: string;
  durationMs: number;
  summary: string;
  diff?: string;
  autoApprove?: boolean;
}

/** A committed scrollback block (§4.1). */
export type Block =
  | { kind: "welcome"; info: WelcomeInfo }
  | { kind: "resume"; summary?: string; pendingCount?: number; staleDocuments?: string[] }
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      /** The turn's SUMMED input tokens across every model call — the footer `↑`
       * (§4.2, core §10.7). Not the peak single-prompt size (that anchors the
       * context meter, not the footer). */
      promptTokens: number;
      completionTokens: number;
      cacheReadTokens: number;
      /** Generation speed (output ÷ summed genMs); undefined when the turn's
       * calls were not streamed or genMs is unmeasurable, so the footer omits
       * the `tok/s` segment (§4.2, core §10.7, §10.14). */
      tokensPerSecond?: number;
      seconds: number;
      cancelled?: boolean;
      /** True when the turn's token figures rest on the harness estimate rather
       * than a provider-reported count; the footer marks them with `~` (§4.2,
       * core §10.7). */
      estimated?: boolean;
      /** The derived turn cost in dollars, present ONLY when the active model
       * carries a configured price (§4.2, core §10.7); the footer appends
       * `$<cost>`. Never invented when no price is configured. */
      cost?: number;
      /** Reasoning wall-time in ms, when reasoning tokens arrived for the
       * response; drives the dim `Thought for Ns` lead line (§4.6). Absent or 0
       * means no reasoning, so no lead line. */
      thoughtMs?: number;
    }
  | { kind: "toolgroup"; calls: ToolCall[]; collapsed?: boolean }
  | { kind: "fanout"; agents: number; rows: FanoutRow[]; collapsed?: boolean }
  | { kind: "info"; glyph: "info" | "warn" | "error"; text: string };

export interface ToolInFlight {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface WorkerRow {
  workerId: string;
  status: string;
  tool?: string;
}

/** One row of a fan-out orchestration (§4.4). Seeded from the batch `task`
 * args (`tasks[{id, worker, task}]`, or one entry per separate `task` call),
 * then updated from WORKER_STATUS_CHANGED events keyed by `taskId` when present
 * else by dispatch order. The row carries its own timing so the committed group
 * can show a per-worker duration; `startedAt`/`finishedAt` are wall-clock ms. */
export interface FanoutRow {
  /** The worker role (`researcher`, `implementer`, …) from the batch entry. */
  worker: string;
  /** The task id (`tasks[].id`) or the sanitized short title from the brief. */
  title: string;
  /** The batch task id, when the entry carried one; the match key for events. */
  taskId?: string;
  /** §4.4 — the ids this task `dependsOn` (from the batch entry). A seeded
   * (`dispatched`) row whose deps are not all `done` shows `Waiting` in the live
   * panel; transient, dropped from the committed block. */
  dependsOn?: string[];
  /** §4.4 — the worker's current tool (the display name drives the live state,
   * e.g. `Run`, `Search`); transient, dropped from the committed block. */
  tool?: string;
  /** The live/final status: `dispatched` (seeded) / `waiting` (deps unfinished) /
   * `running` / `done` / `failed` / `skipped` / `cancelled`. */
  status: string;
  /** A one-line reason for a `failed` row (§4.4); absent otherwise. */
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
}

/** The active or just-finished fan-out orchestration (§4.4). Null when no
 * fan-out is running. Tracks the `task` tool-call ids that make up the batch so
 * the committed group commits in ONE write when the last finishes, plus the
 * seeded + live rows. */
export interface FanoutState {
  /** The `task` tool-call ids composing the fan-out (one for a batch-form call,
   * ≥2 for the model-parallel separate-call shape). */
  callIds: string[];
  agents: number;
  rows: FanoutRow[];
  /** §4.4 — the selected row index (highlighted + underlined in the live panel);
   * Ctrl+D/Ctrl+U move it (navigate only, resolving nothing). Clamped to
   * `[0, rows.length)`. */
  selected: number;
}

export interface ViewState {
  /** Committed scrollback, capped at scrollbackLines (oldest dropped). */
  blocks: Block[];
  scrollbackLines: number;
  /** The HIDDEN assistant-token buffer for the open message segment (§1.4,
   * §4.2). Tokens accumulate here and are NEVER rendered live — the dynamic
   * region shows only the status line. The buffer commits WHOLE to Static as one
   * assistant segment when the message ends (a tool round begins, or the turn
   * ends). A cancelled/errored turn commits whatever remains here once. */
  streaming: string;
  streamOpen: boolean;
  /** The assistant text already committed as mid-turn segments this turn (a
   * segment flushed when a tool round began, §4.2). `turn_complete` commits only
   * the REMAINDER of the authoritative `TurnResult.text` beyond this prefix, so
   * the final committed text equals the whole reply with no loss or duplication.
   * Reset at each turn boundary. */
  streamCommitted: string;
  /** The running token count for the dynamic-region status line (§4.2): the
   * core-reported completion tokens so far when known, else a char/4 estimate of
   * the hidden buffer (the status line marks an estimate with `~`). */
  tokenCount: number;
  /** True when `tokenCount` is a char/4 estimate rather than a core-reported
   * figure, so the status line prints the leading `~` (§4.2). */
  tokenCountEstimated: boolean;
  reasoning: string;
  reasoningOpen: boolean;
  reasoningExpanded: boolean;
  /** Wall-clock ms when the first reasoning token of the current turn arrived,
   * null until then; the committed assistant block's `Thought for Ns` is the
   * elapsed from here to turn end (§4.6). */
  reasoningStartedAt: number | null;
  /** Whether the live (running-turn) tool group renders expanded; `Ctrl+T`
   * toggles it (§4.4, §3.4). View state only (§1.1). */
  toolGroupExpanded: boolean;
  tools: ToolInFlight[];
  /** The finished calls of the CURRENTLY-RUNNING tool round, buffered until the
   * round completes (§4.2, §4.4): no row is drawn while a round runs, and the
   * whole group commits to Static in ONE update when the last call finishes.
   * Reset when the group commits. */
  pendingCalls: ToolCall[];
  /** Footer state. */
  model: string;
  contextPercentage: number;
  contextLevel: string;
  branch: string | null;
  activeAgent: string | undefined;
  /** The most recent MODEL_USAGE prompt-token count (for the §4.2 footer). */
  lastPromptTokens: number;
  /** The turn's SUMMED input tokens from MODEL_USAGE (the footer `↑`, §10.7). */
  lastInputSum: number;
  /** The turn's SUMMED generation time (ms) from MODEL_USAGE; 0 when no call
   * streamed, so the footer omits `tok/s` (§10.7, §10.14). */
  lastGenMs: number;
  /** The most recent MODEL_USAGE cache-read count (for the §4.2 footer `»`). */
  lastCacheReadTokens: number;
  /** True when the most recent MODEL_USAGE marked the turn estimated (§10.7);
   * consumed by `turn_complete` to mark the committed block's footer `~`. */
  lastEstimated: boolean;
  /** The active model's configured price, snapshotted from `config.get()` and
   * refreshed on MODEL_CHANGED (§4.2, core §10.7). Null when the active model
   * carries no price; the footer then omits `$cost` and never invents a rate. */
  modelPrice: { costPer1kInput?: number; costPer1kOutput?: number } | null;
  /** Running background-task count for the §5.2 status bar `⟳` segment. */
  runningTasks: number;
  /** A transient model-retry status line (dim), cleared on the next token or on
   * turn end. Null when no retry is under way. The full `<model> @ <host>:
   * <reason> — retrying (n/total)…` line (§10.1). */
  retrying: string | null;
  /** The last `MODEL_ERROR` seen this turn, used to compose the legible final
   * failure block when the turn ends with `ERROR_OCCURRED { source: "model" }`. */
  lastModelError: ModelErrorInfo | null;
  housekeeping: { idleSessions: number; idleDays: number } | null;
  workers: WorkerRow[];
  /** §4.4 — the active fan-out orchestration (seeded from the batch `task`
   * args, updated by worker events, committed as one `fanout` block when every
   * worker finishes). Null when no fan-out of ≥ 2 workers is running. A single
   * worker dispatch never sets this (it stays an ordinary tool row). */
  fanout: FanoutState | null;
  /** Turn timing — set on send, read on turn_complete. */
  turnStartedAt: number | null;
  /** The session's active top-level agent name (§5.2, §5.6): drives the
   * `[<label or name>]` status-bar bracket. The single source of truth is
   * `SESSION_MODE_CHANGED` (§3.5), so a host change elsewhere reconciles here
   * too. The bracket's label and colour are resolved from `agents.list()`. */
  mode: string;
  /** A transient dim one-line notice for a refused mode change (§3.5), cleared
   * on the next key or turn boundary. Null when none is showing. */
  modeNotice: string | null;
  /** Tool-call ids whose approval was auto-resolved by `auto_approve` (§4.4),
   * keyed on the `auto-approve-<toolCallId>` requestId; the committed tool row shows
   * the `⚡` marker. */
  autoApproveToolIds: ReadonlySet<string>;
  /** §4.7 — notice categories already shown THIS turn (`suggestion`,
   * `read-lane`, `surprise`), so at most one dim `ℹ` line per category per turn
   * reaches the scrollback. Reset at each turn boundary (`pushUser` and
   * turn end). */
  noticedCategories: ReadonlySet<string>;
  /** §13.11 — limit keys whose dim `ℹ` LIMIT_HIT line has already shown THIS
   * turn, so at most one line per key per turn reaches the scrollback. Reset at
   * each turn boundary (`pushUser`). */
  noticedLimitKeys: ReadonlySet<string>;
  /** §8.7 — ingest limit keys whose dim `ℹ` line has already shown THIS turn, so
   * at most one line per key per turn reaches the scrollback. Reset at each turn
   * boundary. */
  noticedIngestKeys: ReadonlySet<string>;
  /** §8.7 — by-reference `kind`s whose dim `ℹ` line has already shown THIS turn,
   * so at most one line per kind per turn reaches the scrollback. Reset at each
   * turn boundary. */
  noticedByRefKinds: ReadonlySet<string>;
  /** §4.2/§6.1 — true while an approval or question dialog is open (a single
   * action, a fan-out batch, or a worker ask). The status line then reads
   * `Waiting for approval` with no spinner and a FROZEN elapsed timer; the
   * normal verb is restored when the dialog resolves. Set by the App's approval
   * bridge via the `approval_pending` effect. */
  approvalPending: boolean;
  /** Wall-clock ms the approval began, so the frozen status elapsed shows the
   * time up to the prompt rather than ticking while the user decides (§4.2).
   * Null when no approval is pending. */
  approvalStartedAt: number | null;
}

export function initialState(scrollbackLines: number): ViewState {
  return {
    blocks: [],
    scrollbackLines,
    streaming: "",
    streamOpen: false,
    streamCommitted: "",
    tokenCount: 0,
    tokenCountEstimated: false,
    reasoning: "",
    reasoningOpen: false,
    reasoningExpanded: false,
    reasoningStartedAt: null,
    toolGroupExpanded: true,
    tools: [],
    pendingCalls: [],
    model: "",
    contextPercentage: 0,
    contextLevel: "default",
    branch: null,
    activeAgent: undefined,
    lastPromptTokens: 0,
    lastInputSum: 0,
    lastGenMs: 0,
    lastCacheReadTokens: 0,
    lastEstimated: false,
    modelPrice: null,
    runningTasks: 0,
    retrying: null,
    lastModelError: null,
    housekeeping: null,
    workers: [],
    fanout: null,
    turnStartedAt: null,
    mode: "chat",
    modeNotice: null,
    autoApproveToolIds: new Set<string>(),
    noticedCategories: new Set<string>(),
    noticedLimitKeys: new Set<string>(),
    noticedIngestKeys: new Set<string>(),
    noticedByRefKinds: new Set<string>(),
    approvalPending: false,
    approvalStartedAt: null,
  };
}

function cap(blocks: Block[], limit: number): Block[] {
  if (blocks.length <= limit) return blocks;
  // The welcome block (§5.1) is pinned at the top of scrollback and never
  // dropped by the cap; the oldest *content* blocks are dropped instead.
  if (blocks[0]?.kind === "welcome") {
    const welcome = blocks[0];
    const rest = blocks.slice(1);
    const kept = rest.slice(rest.length - (limit - 1));
    return [welcome, ...kept];
  }
  return blocks.slice(blocks.length - limit);
}

/** Collapse every still-open tool group on a turn boundary (§4.4): a completed
 * turn auto-collapses its groups to the `▸ N tool calls` header; an errored
 * group stays expanded so the failure is never hidden. Called at
 * turn_complete / turn_cancelled / error. */
function collapseToolGroups(blocks: Block[]): Block[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.kind === "fanout") {
      if (b.collapsed) return b;
      // §4.4 — a fan-out with a failed row stays expanded so the failure is
      // never hidden behind the collapsed header.
      const hasFailure = b.rows.some((r) => r.status === "failed");
      if (hasFailure) return b;
      changed = true;
      return { ...b, collapsed: true };
    }
    if (b.kind !== "toolgroup" || b.collapsed) return b;
    const hasError = b.calls.some((c) => c.status !== "success");
    if (hasError) return b;
    changed = true;
    return { ...b, collapsed: true };
  });
  return changed ? next : blocks;
}

/**
 * §4.2 — reconcile the authoritative `TurnResult.text` against what already
 * committed mid-turn, PER SEGMENT. Each mid-turn segment (flushed when a tool
 * round began) is recorded in `streamCommitted`, joined with `\n\n`. The
 * authoritative whole reply may join those same segments with a DIFFERENT
 * whitespace run (a single `\n`, none, or extra whitespace), so a naive
 * `startsWith` over the `\n\n`-joined prefix would miss and re-commit the whole
 * text (a duplicate). Instead, strip each committed segment from the front of
 * `fullText` independently, tolerant of the whitespace BETWEEN segments, and
 * return only the uncommitted remainder. A segment that does not match the front
 * (an unexpected divergence) stops the strip and the remainder is returned as-is
 * so nothing already shown is dropped silently.
 */
export function uncommittedRemainder(fullText: string, committed: string): string {
  if (committed === "") return fullText;
  const segments = committed.split("\n\n").filter((s) => s.trim() !== "");
  let rest = fullText;
  for (const seg of segments) {
    // Tolerate leading whitespace before this segment in the authoritative text.
    const lead = rest.match(/^\s*/)?.[0] ?? "";
    const afterLead = rest.slice(lead.length);
    if (afterLead.startsWith(seg)) {
      rest = afterLead.slice(seg.length);
    } else {
      // Divergence: this segment is not at the front. Stop stripping; keep the
      // remaining text intact (never drop what the model actually produced).
      return rest;
    }
  }
  // Trim the whitespace joining the last committed segment to the remainder.
  return rest.replace(/^\s+/, "");
}


/** Seed the initial state with the committed welcome block (§5.1). */
export function withWelcome(state: ViewState, info: WelcomeInfo): ViewState {
  return {
    ...state,
    blocks: [{ kind: "welcome", info }, ...state.blocks],
  };
}

/** A persisted-chain message to paint on resume (core `MessageDTO`, §5.4). */
export interface ResumeMessage {
  role: string;
  content: string;
}

/** The resume context — the "where you left off" line and its warnings (§5.1). */
export interface ResumeContext {
  summary?: string | undefined;
  pendingCount?: number | undefined;
  staleDocuments?: string[] | undefined;
}

/**
 * Seed restored turns and the resume line into Static on a resume (§5.1). Prior
 * `user`/`assistant` messages paint as committed blocks AFTER the welcome banner
 * and BEFORE the resume line, so the banner stays at the top of scrollback and
 * the restored turns and the resume line follow it in order. Tool and system
 * messages are not re-painted (the feed shows turns, not the raw chain).
 */
export function seedResume(state: ViewState, messages: ResumeMessage[], ctx: ResumeContext): ViewState {
  // Core `MessageDTO.role` is the LangChain message type (`human`/`ai`/`tool`/
  // `system`), not `user`/`assistant`. Accept both conventions so restored
  // turns paint on resume (§5.1). Tool and system messages are not re-painted.
  const isUser = (r: string): boolean => r === "user" || r === "human";
  const isAssistant = (r: string): boolean => r === "assistant" || r === "ai";
  const history: Block[] = messages
    .filter((m) => isUser(m.role) || isAssistant(m.role))
    .map((m) =>
      isUser(m.role)
        ? ({ kind: "user", text: m.content } as Block)
        : ({
            kind: "assistant",
            text: m.content,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            seconds: 0,
          } as Block),
    );
  const resumeBlock: Block = {
    kind: "resume",
    ...(ctx.summary ? { summary: ctx.summary } : {}),
    ...(ctx.pendingCount ? { pendingCount: ctx.pendingCount } : {}),
    ...(ctx.staleDocuments && ctx.staleDocuments.length > 0 ? { staleDocuments: ctx.staleDocuments } : {}),
  };
  return { ...state, blocks: [...state.blocks, ...history, resumeBlock] };
}

/** The dynamic-region status verb while a turn runs (§4.2, §4.4). Buffered
 * rendering shows ONE stable status line; the verb is derived from the live
 * phase: `Reading`/`Searching`/`Fetching`/`Running`/`Saving`/`Editing` + the
 * target while a tool round runs, `Responding` once assistant tokens arrive, and
 * `Thinking` before the first token. A `task` fan-out of ≥ 2 workers REPLACES
 * the status line with the live fan-out panel (§4.4) — statusLine returns null
 * for its duration so the panel's own `● Orchestrating (N agents)` header is the
 * only header. Returns null when no turn is active. */
export interface StatusLine {
  verb: string;
  /** An optional trailing hint appended to the status line. Unused today — the
   * fan-out case returns null (the panel replaces the line); kept for a future
   * single-line hint. */
  hint?: string;
}

/** Map a tool name to its status verb (§4.2). The verb names the actual
 * activity and never implies a change unless a mutating tool is executing:
 * read-class tools read `Reading`, content/web search `Searching`, `web_fetch`
 * `Fetching`, `execute_command` `Running`, the mutating tools (`write_file`,
 * `save_memory`, `delete_memory`, `researcher_save_notes` are `Saving`;
 * `edit_file` is `Editing`) — only while that tool is executing. Anything else
 * reads `Running`. */
function toolVerb(name: string): "Reading" | "Searching" | "Fetching" | "Running" | "Saving" | "Editing" {
  switch (name) {
    case "read_file":
    case "glob_files":
    case "workspace_map":
      return "Reading";
    case "search_contents":
    case "web_search":
      return "Searching";
    case "web_fetch":
      return "Fetching";
    case "edit_file":
      return "Editing";
    case "write_file":
    case "save_memory":
    case "delete_memory":
    case "researcher_save_notes":
      return "Saving";
    case "execute_command":
      return "Running";
    default:
      return "Running";
  }
}

/** Derive the single dynamic-region status line from the live view state
 * (§4.2). Null when no turn is running (the input prompt shows instead). */
export function statusLine(state: ViewState): StatusLine | null {
  // A turn is active from `send` (turnStartedAt set) until turn_complete /
  // cancel / error clears it. The token stream's `done` flag ends a message
  // segment, NOT the turn, so the status line stays up between a finished
  // message and the turn's completion. Fall back to streamOpen when a turn is
  // in flight without a measured start (a resumed/odd path).
  const turnActive = state.turnStartedAt !== null || state.streamOpen || state.tools.length > 0;
  if (!turnActive) return null;
  // A fan-out (a `task` dispatch of ≥ 2 workers, or ≥ 2 concurrent `task` calls)
  // REPLACES the single status line with the live fan-out panel (§4.2/§4.4):
  // statusLine returns null so no status row is drawn and `LiveFanout` owns the
  // dynamic region alone — the panel's own `● Orchestrating (N agents)` header
  // carries the orchestration label and the elapsed/token footer is
  // intentionally dropped for the duration. The panel condition is
  // `state.fanout` with ≥ 2 rows, the same shape `LiveFanout` renders on, so the
  // two never both draw a header; a pending worker approval shows on its row
  // (§4.4/§6.2), never as a second `Waiting for approval` line. This check
  // precedes the approval check for that reason.
  if (state.fanout && state.fanout.rows.length >= 2) return null;
  // §4.2/§6.1 — while an approval or question is pending the turn is blocked on
  // the user: show `Waiting for approval` with no running verb (the StatusLine
  // freezes the elapsed timer and drops the spinner animation for it). This wins
  // over the running verb so the line never reads `Thinking` under an open
  // dialog.
  if (state.approvalPending) return { verb: "Waiting for approval" };
  // A running tool round: a single tool reads its verb and name; a multi-tool
  // round reads `Running`.
  if (state.tools.length > 0) {
    if (state.tools.length === 1) {
      const t = state.tools[0]!;
      const target = toolTarget(t.name, t.args);
      return { verb: target ? `${toolVerb(t.name)} ${target}` : toolVerb(t.name) };
    }
    return { verb: "Running" };
  }
  // No tool running: `Responding` once assistant tokens buffered, else
  // `Thinking` (§4.2 — `Responding` replaces the former `Writing`).
  return { verb: state.streaming !== "" ? "Responding" : "Thinking" };
}

/** The sanitized, truncated target shown after a tool verb on the status line
 * (§4.2): the file path / pattern / query / command / memory title the running
 * tool acts on. Kept here (not in the theme component) so the pure reducer
 * module has no component dependency. Returns "" when no meaningful target. */
function toolTarget(name: string, args: Record<string, unknown>): string {
  const str = (k: string): string => (typeof args[k] === "string" ? (args[k] as string) : "");
  let raw = "";
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "researcher_save_notes":
    case "workspace_map":
      raw = str("path");
      break;
    case "glob_files":
      raw = str("pattern");
      break;
    case "search_contents":
      raw = str("pattern") || str("query");
      break;
    case "web_search":
      raw = str("query");
      break;
    case "web_fetch":
      raw = str("url");
      break;
    case "execute_command":
      raw = str("command");
      break;
    case "save_memory":
    case "delete_memory":
      raw = str("title");
      break;
    default:
      raw = str("path") || str("command") || str("query") || str("pattern") || str("title");
  }
  // Strip control/bidi/zero-width bytes from the single status line (§4), then
  // clamp to one line and to 60 display-safe chars with an ellipsis.
  const oneLine = sanitizeTarget(raw).replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 59) + "…" : oneLine;
}

/** Strip the control, escape-introducer, bidi-override and zero-width bytes a
 * tool target must never carry onto the one status line (§4). Mirrors the
 * render `sanitize`, kept local so the pure reducer has no component import. */
function sanitizeTarget(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) continue; // C0 + DEL
    if (code >= 0x80 && code <= 0x9f) continue; // C1
    if (code >= 0x202a && code <= 0x202e) continue; // bidi overrides
    if (code >= 0x2066 && code <= 0x2069) continue; // isolates
    if (code === 0x200e || code === 0x200f) continue; // LRM / RLM
    if (code >= 0x200b && code <= 0x200c) continue; // ZWSP / ZWNJ
    if (code === 0x2060 || code === 0xfeff) continue; // WORD JOINER / BOM
    out += ch;
  }
  return out;
}

/** §4.7 — a generic one-sentence notice for a notice category whose payload
 * carried no `message`, so the CLI never shows the bare category word. */
function genericNoticeText(category: string): string {
  switch (category) {
    case "suggestion":
      return "A suggestion is available; review with /memory.";
    case "read-lane":
      return "Heavy direct reading this turn — consider delegating to a worker batch.";
    case "surprise":
      return "A change touched a target that was not predicted.";
    default:
      return "A notice is available.";
  }
}

/** §4.7 — a generic one-sentence warning for a true-warning category whose
 * payload carried no `message`, so the CLI never shows the bare category word. */
function genericWarningText(category: string): string {
  return category ? `A ${category} warning was raised.` : "A warning was raised.";
}

/** §4.4 — map a core worker status to the fan-out row's display status. The
 * live states (`running`, `needs_review`) stay `running` (a static marker, no
 * spinner); terminal states fold to `done`/`failed`/`skipped`/`cancelled`. */
export function fanoutRowStatus(coreStatus: string): "running" | "done" | "failed" | "skipped" | "cancelled" {
  switch (coreStatus) {
    case "succeeded":
    case "merged":
    case "reviewed":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "aborted":
      return "cancelled";
    default:
      // `running`, `needs_review`, `dispatched`, or any unknown live state.
      return "running";
  }
}

/** True once a fan-out row has reached a terminal (non-`running`) state (§4.4). */
function isTerminalFanoutStatus(s: string): boolean {
  return s === "done" || s === "failed" || s === "skipped" || s === "cancelled";
}

/** Shallow compare the mutable fields of a fan-out row so the reducer keeps the
 * same object when a worker event carries no visible change (§4.4 — a row
 * repaints only on a real state change, never on the status-line tick). */
function rowsEqual(a: FanoutRow & { workerId?: string }, b: FanoutRow & { workerId?: string }): boolean {
  return (
    a.status === b.status &&
    a.worker === b.worker &&
    a.title === b.title &&
    a.reason === b.reason &&
    a.tool === b.tool &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.workerId === b.workerId
  );
}

/** §4.4 — strip the transient live-only fields (`workerId`, `tool`,
 * `dependsOn`) from a row before it commits to a Static `fanout` block: the
 * committed block carries only the final per-worker state and its duration. */
function finalizeRow(r: FanoutRow): FanoutRow {
  const row = { ...r } as FanoutRow & { workerId?: string };
  delete row.workerId;
  delete row.tool;
  delete row.dependsOn;
  // A `waiting`/`dispatched` row that never started folds to `cancelled` (the
  // live panel's non-terminal states are not a valid committed state).
  if (!isTerminalFanoutStatus(row.status)) row.status = "cancelled";
  return row;
}

/** §4.4 — the short per-worker title: the batch task id when it carries one,
 * else the first words of the task brief, sanitized (control/bidi stripped,
 * whitespace collapsed) and clamped so the row never overflows; the renderer
 * display-width-truncates to the content width. */
export function fanoutTitle(taskId: string | undefined, brief: string | undefined): string {
  if (taskId && taskId.trim() !== "") return sanitizeTarget(taskId).replace(/\s+/g, " ").trim();
  const text = sanitizeTarget(brief ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return "";
  return text.length > 80 ? text.slice(0, 79) + "…" : text;
}

/** §4.4 — seed fan-out rows from a `task` tool call's args. A batch-form call
 * (`{ tasks: [{id, worker, task}] }`) yields one row per entry; a single-form
 * call (`{ worker|role, task|brief }`) yields one row. Returns an empty array
 * for a call that is not a recognizable task dispatch. */
export function seedFanoutRows(args: Record<string, unknown>): FanoutRow[] {
  const tasks = (args as { tasks?: unknown }).tasks;
  if (Array.isArray(tasks)) {
    return tasks.map((t) => {
      const e = (t ?? {}) as Record<string, unknown>;
      const worker = typeof e["worker"] === "string" ? e["worker"] : typeof e["role"] === "string" ? e["role"] : "worker";
      const taskId = typeof e["id"] === "string" ? e["id"] : undefined;
      const brief = typeof e["task"] === "string" ? e["task"] : typeof e["brief"] === "string" ? e["brief"] : undefined;
      const deps = Array.isArray(e["dependsOn"]) ? (e["dependsOn"] as unknown[]).filter((d): d is string => typeof d === "string") : [];
      return {
        worker,
        title: fanoutTitle(taskId, brief),
        ...(taskId !== undefined ? { taskId } : {}),
        ...(deps.length > 0 ? { dependsOn: deps } : {}),
        status: "dispatched",
      };
    });
  }
  const worker = typeof args["worker"] === "string" ? args["worker"] : typeof args["role"] === "string" ? args["role"] : "worker";
  const brief = typeof args["task"] === "string" ? args["task"] : typeof args["brief"] === "string" ? args["brief"] : undefined;
  return [{ worker, title: fanoutTitle(undefined, brief), status: "dispatched" }];
}

/** §4.4 — decide whether the current tool round is a fan-out of ≥ 2 workers
 * and, if so, seed/extend the fan-out state. Two shapes qualify: ONE batch-form
 * `task` call carrying `tasks[]` with ≥ 2 entries, or ≥ 2 separate `task` calls
 * in one round (the model-parallel shape). A single worker dispatch is NOT a
 * fan-out — it stays an ordinary tool row and leaves `fanout` null. Rows already
 * seeded (and their live state) are preserved when a second `task` call arrives.
 */
function seedFanout(
  state: ViewState,
  startedId: string,
  startedName: string,
  startedArgs: Record<string, unknown>,
  toolsAfter: ToolInFlight[],
): FanoutState | null {
  if (startedName !== "task") return state.fanout;
  const taskTools = toolsAfter.filter((t) => t.name === "task");
  const batch = (startedArgs as { tasks?: unknown }).tasks;
  const isBatch = Array.isArray(batch) && batch.length >= 2;
  // A batch-form call of ≥ 2 is a fan-out on its own; otherwise it takes ≥ 2
  // separate `task` calls in the round.
  if (!isBatch && taskTools.length < 2) return state.fanout;
  if (isBatch) {
    const rows = deriveWaiting(seedFanoutRows(startedArgs));
    return { callIds: [startedId], agents: rows.length, rows, selected: 0 };
  }
  // Separate-call shape: ≥ 2 distinct `task` calls in the round. Build the rows
  // from EVERY in-flight task call (the first call did not seed a fan-out on its
  // own), preserving any live state already attached to a prior row by matching
  // on the call's own single-form brief/worker by order.
  const prior = state.fanout;
  const rows: FanoutRow[] = taskTools.map((t, i) => {
    const seeded = seedFanoutRows(t.args)[0]!;
    // Carry a prior row's live state forward by position (separate calls have no
    // task id to key on).
    const priorRow = prior?.rows[i];
    return priorRow && priorRow.worker === seeded.worker ? priorRow : seeded;
  });
  return { callIds: taskTools.map((t) => t.id), agents: rows.length, rows: deriveWaiting(rows), selected: prior?.selected ?? 0 };
}

/** §4.4 — mark each still-seeded (`dispatched`) row whose `dependsOn` is not yet
 * all `done` as `waiting` so the live panel shows a gray `○ Waiting` row until
 * the worker starts; a row with no deps, or whose deps have all finished, stays
 * `dispatched`. Only a seeded row is affected — a row that has already started
 * (running/terminal) keeps its live status. Returns the same array object when
 * nothing changes so no frame churns (§4.4). */
function deriveWaiting(rows: FanoutRow[]): FanoutRow[] {
  const doneIds = new Set(rows.filter((r) => r.status === "done").map((r) => r.taskId));
  let changed = false;
  const next = rows.map((r) => {
    const deps = r.dependsOn;
    const isSeeded = r.status === "dispatched" || r.status === "waiting";
    if (!isSeeded || !deps || deps.length === 0) {
      // No deps (or already started): a seeded `waiting` with no unmet deps folds
      // back to `dispatched`.
      if (r.status === "waiting") {
        changed = true;
        return { ...r, status: "dispatched" };
      }
      return r;
    }
    const blocked = deps.some((d) => !doneIds.has(d));
    const want = blocked ? "waiting" : "dispatched";
    if (r.status === want) return r;
    changed = true;
    return { ...r, status: want };
  });
  return changed ? next : rows;
}

/** §4.4 — commit a still-live fan-out as one final block when the turn ends
 * without the batch `task` call finishing (a cancel or error mid-fan-out): each
 * non-terminal row is recorded `cancelled` so the committed list is all-final.
 * Returns null when there is no live fan-out. */
function commitLiveFanout(fanout: FanoutState | null): Block | null {
  if (!fanout || fanout.rows.length < 2) return null;
  const rows: FanoutRow[] = fanout.rows.map(finalizeRow);
  return { kind: "fanout", agents: fanout.agents, rows };
}

/** Apply a view effect to the state, returning the next state (pure). */
export function reduce(state: ViewState, effect: ViewEffect): ViewState {  switch (effect.type) {
    case "token": {
      // Buffered rendering (§1.4, §4.2): accumulate the token onto the HIDDEN
      // segment buffer. Nothing is committed and nothing renders live — the
      // dynamic region shows only the status line. The whole segment commits on
      // the next tool round or at turn end. `tokenCount` tracks the running
      // completion count for the status line: a core-reported figure wins, else
      // a char/4 estimate of the buffer marked `~`.
      const buffer = state.streaming + effect.token;
      const estimate = Math.max(0, Math.round(buffer.length / 4));
      return {
        ...state,
        streaming: buffer,
        streamOpen: !effect.done,
        retrying: null,
        ...(state.tokenCountEstimated || state.tokenCount === 0
          ? { tokenCount: estimate, tokenCountEstimated: true }
          : {}),
      };
    }
    case "reasoning":
      return {
        ...state,
        reasoning: state.reasoning + effect.token,
        reasoningOpen: !effect.done,
        reasoningStartedAt: state.reasoningStartedAt ?? Date.now(),
      };
    case "tool_started": {
      // §4.2 — a tool call that BEGINS a round ends the current assistant
      // message segment: commit the hidden buffer WHOLE to Static in one update
      // (no footer — the footer rides the final segment only), so assistant text
      // always commits BEFORE the tool group that follows it. Only the first
      // tool of a round triggers the commit (an in-flight round is already open).
      let blocks = state.blocks;
      let streaming = state.streaming;
      let streamCommitted = state.streamCommitted;
      if (state.tools.length === 0 && state.streaming.trim() !== "") {
        const segment: Block = {
          kind: "assistant",
          text: state.streaming,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          seconds: 0,
          ...(state.reasoningStartedAt !== null ? { thoughtMs: Math.max(1, Date.now() - state.reasoningStartedAt) } : {}),
        };
        blocks = cap([...state.blocks, segment], state.scrollbackLines);
        streamCommitted = streamCommitted === "" ? state.streaming : `${streamCommitted}\n\n${state.streaming}`;
        streaming = "";
      }
      return {
        ...state,
        blocks,
        streaming,
        streamCommitted,
        tools: [...state.tools, { id: effect.id, name: effect.name, args: effect.args }],
        fanout: seedFanout(state, effect.id, effect.name, effect.args, [...state.tools, { id: effect.id, name: effect.name, args: effect.args }]),
      };
    }
    case "tool_finished": {
      const inflight = state.tools.find((t) => t.id === effect.id);
      const autoApprove = state.autoApproveToolIds.has(effect.id);
      const call: ToolCall = {
        id: effect.id,
        name: effect.name,
        args: inflight?.args ?? {},
        status: effect.status,
        durationMs: effect.durationMs,
        summary: effect.summary,
        ...(effect.diff ? { diff: effect.diff } : {}),
        ...(autoApprove ? { autoApprove: true } : {}),
      };
      // §4.2/§4.4 — buffer the finished call; no row is drawn while the round
      // runs. When the LAST call of the round finishes (no tool left in flight)
      // the whole group commits to Static in ONE update, as a single
      // `toolgroup` block carrying every call of the round in call order. A
      // fan-out round (§4.4) commits as ONE `fanout` block of per-worker rows
      // instead, built from the accumulated worker events, and `fanout` clears.
      const remaining = state.tools.filter((t) => t.id !== effect.id);
      const pending = [...state.pendingCalls, call];
      if (remaining.length > 0) {
        return { ...state, tools: remaining, pendingCalls: pending };
      }
      // A fan-out of ≥ 2 workers commits the indented fan-out list and nothing
      // else from this round's `task` calls; any non-`task` call of the same
      // round still commits as a normal tool group beside it.
      if (state.fanout && state.fanout.rows.length >= 2) {
        const fanout = state.fanout;
        const isFanoutCall = (c: ToolCall): boolean => c.name === "task" && fanout.callIds.includes(c.id);
        const nonFanout = pending.filter((c) => !isFanoutCall(c));
        // Any still-`dispatched`/`running` row at commit time (a worker whose
        // terminal event never arrived) is recorded `cancelled` so the committed
        // list is all-final (§4.4).
        const finalRows: FanoutRow[] = fanout.rows.map(finalizeRow);
        const blocks: Block[] = [...state.blocks, { kind: "fanout", agents: fanout.agents, rows: finalRows }];
        if (nonFanout.length > 0) blocks.push({ kind: "toolgroup", calls: nonFanout });
        return {
          ...state,
          tools: remaining,
          pendingCalls: [],
          fanout: null,
          blocks: cap(blocks, state.scrollbackLines),
        };
      }
      return {
        ...state,
        tools: remaining,
        pendingCalls: [],
        blocks: cap([...state.blocks, { kind: "toolgroup", calls: pending }], state.scrollbackLines),
      };
    }
    case "model_usage":
      return {
        ...state,
        lastPromptTokens: effect.promptTokens || state.lastPromptTokens,
        lastInputSum: effect.inputSum || state.lastInputSum,
        lastGenMs: effect.genMs || state.lastGenMs,
        lastCacheReadTokens: effect.cacheReadTokens || state.lastCacheReadTokens,
        lastEstimated: effect.estimated,
        // §4.2 — the status line prefers a core-reported completion count over
        // the char/4 estimate; a provider-reported figure drops the `~` marker.
        ...(effect.completionTokens > 0
          ? { tokenCount: effect.completionTokens, tokenCountEstimated: effect.estimated }
          : {}),
      };
    case "model_price":
      return { ...state, modelPrice: effect.price };
    case "turn_complete": {
      const seconds = state.turnStartedAt ? (Date.now() - state.turnStartedAt) / 1000 : effect.usage.totalMs / 1000;
      const roundedSeconds = Math.round(seconds * 10) / 10;
      // §4.2 — `↑` is the turn's SUMMED input across every model call (MODEL_USAGE
      // `inputSum`), not the peak single-prompt size; the context meter keeps the
      // peak (core §10.7, §4.8).
      const input = state.lastInputSum || effect.usage.promptTokens || state.lastPromptTokens;
      const completion = effect.usage.completionTokens;
      const tps =
        state.lastGenMs > 0 ? Math.round((completion / (state.lastGenMs / 1000)) * 10) / 10 : undefined;
      const thoughtMs = state.reasoningStartedAt !== null ? Math.max(1, Date.now() - state.reasoningStartedAt) : 0;
      const collapsed = collapseToolGroups(state.blocks);
      const cost = deriveCost({ inputTokens: input, outputTokens: completion, totalTokens: input + completion }, state.modelPrice ?? undefined);
      // §4.2 — the final assistant segment commits WHOLE from the authoritative
      // `TurnResult.text`. When earlier segments already committed mid-turn
      // (before tool rounds, recorded in `streamCommitted`), only the REMAINDER
      // beyond those segments commits now — reconciled PER SEGMENT and tolerant
      // of the whitespace the authoritative join uses, so two or three mid-turn
      // segments never re-commit as duplicate assistant text. The turn footer
      // rides this final segment only.
      const finalText = uncommittedRemainder(effect.text, state.streamCommitted);
      const footer = {
        promptTokens: input,
        completionTokens: completion,
        cacheReadTokens: state.lastCacheReadTokens,
        ...(tps !== undefined ? { tokensPerSecond: tps } : {}),
        seconds: roundedSeconds,
        ...(state.lastEstimated ? { estimated: true } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(thoughtMs > 0 ? { thoughtMs } : {}),
      };
      let committedBlocks: Block[];
      if (finalText.trim() === "") {
        // A tool-only turn, or every byte already committed before a tool round:
        // commit no empty assistant block. When the prefix carried reasoning the
        // lead line already rode its segment, so nothing is lost.
        committedBlocks = collapsed;
      } else {
        committedBlocks = [...collapsed, { kind: "assistant", text: finalText, ...footer } as Block];
      }
      // §4.7 — a turn that ends `limit_reached` appends the dim step-limit
      // notice. The text comes from the event payload; if it is absent the CLI
      // shows the canonical `Step limit reached (N). Say continue to resume.`.
      if (effect.status === "limit_reached") {
        const notice = effect.notice && effect.notice.trim() !== "" ? effect.notice : "Step limit reached. Say continue to resume.";
        committedBlocks = [...committedBlocks, { kind: "info", glyph: "info", text: notice }];
      }
      return {
        ...state,
        blocks: cap(committedBlocks, state.scrollbackLines),
        streaming: "",
        streamOpen: false,
        streamCommitted: "",
        tokenCount: 0,
        tokenCountEstimated: false,
        reasoning: "",
        reasoningOpen: false,
        reasoningStartedAt: null,
        turnStartedAt: null,
        lastInputSum: 0,
        lastGenMs: 0,
        lastCacheReadTokens: 0,
        lastEstimated: false,
        fanout: null,
      };
    }
    case "turn_cancelled": {
      // §4.2 — a cancelled turn commits whatever is buffered exactly once: any
      // pending (partially-finished) tool round as a group, then the hidden
      // assistant buffer with a dim `⊘ cancelled` marker. No loss, no
      // duplication; an empty buffer commits no extra assistant block.
      const extra: Block[] = [];
      if (state.pendingCalls.length > 0) {
        extra.push({ kind: "toolgroup", calls: state.pendingCalls });
      }
      const liveFanoutCancel = commitLiveFanout(state.fanout);
      if (liveFanoutCancel) extra.push(liveFanoutCancel);
      const tail = state.streaming;
      if (tail.trim() !== "") {
        extra.push({
          kind: "assistant",
          text: tail,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          seconds: 0,
          cancelled: true,
        });
      }
      return {
        ...state,
        blocks: cap([...collapseToolGroups(state.blocks), ...extra], state.scrollbackLines),
        streaming: "",
        streamOpen: false,
        streamCommitted: "",
        tokenCount: 0,
        tokenCountEstimated: false,
        tools: [],
        pendingCalls: [],
        reasoning: "",
        reasoningOpen: false,
        reasoningStartedAt: null,
        turnStartedAt: null,
        fanout: null,
      };
    }
    case "error": {
      // §4.2 — an errored turn commits whatever is buffered exactly once (no
      // loss): any pending tool round as a group, then the hidden assistant
      // buffer (kept with the `⊘` marker so the partial text is not lost), then
      // the error block itself.
      const extra: Block[] = [];
      if (state.pendingCalls.length > 0) {
        extra.push({ kind: "toolgroup", calls: state.pendingCalls });
      }
      const liveFanoutErr = commitLiveFanout(state.fanout);
      if (liveFanoutErr) extra.push(liveFanoutErr);
      if (state.streaming.trim() !== "") {
        extra.push({
          kind: "assistant",
          text: state.streaming,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          seconds: 0,
          cancelled: true,
        });
      }
      // A model failure (budget exhausted or non-retryable) carries the legible
      // `<model> @ <host>: <reason> after <n> attempt(s).` line plus ONE dim hint
      // line, both composed from the last MODEL_ERROR of this turn (§10.1). Any
      // other source keeps the verbatim `<source>: <message>` line (§10.1).
      if (effect.source === "model" && state.lastModelError) {
        const f = formatModelFailure(state.lastModelError);
        extra.push({ kind: "info", glyph: "error", text: f.reason });
        extra.push({ kind: "info", glyph: "info", text: f.hint });
        // The `/model` escape so a user knows how to switch endpoints (§10.1).
        extra.push({ kind: "info", glyph: "info", text: MODEL_SWITCH_HINT });
      } else if (effect.code === "IMAGE_NOT_SUPPORTED") {
        // A typed, self-describing engine error (it names the model, the exact
        // fix and the file): the `engine:` prefix is noise, so render it verbatim.
        extra.push({ kind: "info", glyph: "error", text: effect.message });
      } else {
        extra.push({ kind: "info", glyph: "error", text: `${effect.source}: ${effect.message}` });
      }
      return {
        ...state,
        blocks: cap([...collapseToolGroups(state.blocks), ...extra], state.scrollbackLines),
        streaming: "",
        streamOpen: false,
        streamCommitted: "",
        tokenCount: 0,
        tokenCountEstimated: false,
        tools: [],
        pendingCalls: [],
        turnStartedAt: null,
        retrying: null,
        lastModelError: null,
        fanout: null,
      };
    }
    case "model_error": {
      const info: ModelErrorInfo = {
        name: effect.name,
        code: effect.code,
        message: effect.message,
        attempt: effect.attempt,
        maxRetries: effect.maxRetries,
        baseUrl: effect.baseUrl,
        modelId: effect.modelId,
      };
      return {
        ...state,
        lastModelError: info,
        retrying: effect.willRetry ? formatRetryLine(info) : null,
      };
    }
    case "context_budget":
      return { ...state, contextPercentage: effect.percentage };
    case "context_threshold":
      return { ...state, contextLevel: effect.level };
    case "context_compacted":
      return {
        ...state,
        blocks: cap(
          [...state.blocks, { kind: "info", glyph: "info", text: `compacted ${effect.turnsFolded} turns` }],
          state.scrollbackLines,
        ),
      };
    case "context_overflow":
      return {
        ...state,
        blocks: cap([...state.blocks, { kind: "info", glyph: "error", text: effect.message }], state.scrollbackLines),
      };
    case "warning": {
      // §4.7 — `suggestion`, `read-lane` and `surprise` are NOT warnings: each
      // renders as one dim `ℹ` info line, at most once per category per turn.
      // Every other category is a true warning (`⚠`, yellow). A payload with no
      // `message` renders a generic sentence for its category — never the bare
      // category word.
      const NOTICE_CATEGORIES = new Set(["suggestion", "read-lane", "surprise"]);
      const isNotice = NOTICE_CATEGORIES.has(effect.category);
      const msg = effect.message && effect.message.trim() !== "" ? effect.message : undefined;
      if (isNotice) {
        // One dim line per category per turn.
        if (state.noticedCategories.has(effect.category)) return state;
        const text = msg ?? genericNoticeText(effect.category);
        const noticed = new Set(state.noticedCategories);
        noticed.add(effect.category);
        return {
          ...state,
          noticedCategories: noticed,
          blocks: cap([...state.blocks, { kind: "info", glyph: "info", text }], state.scrollbackLines),
        };
      }
      // A true warning: show the message, or a generic warning sentence when the
      // payload omitted one (never the bare category).
      const text = msg ?? genericWarningText(effect.category);
      return {
        ...state,
        blocks: cap([...state.blocks, { kind: "info", glyph: "warn", text }], state.scrollbackLines),
      };
    }
    case "limit_hit": {
      // §13.11/§14.6 — one dim `ℹ` line per key per turn, buffered with the turn.
      if (state.noticedLimitKeys.has(effect.key)) return state;
      const noticed = new Set(state.noticedLimitKeys);
      noticed.add(effect.key);
      return {
        ...state,
        noticedLimitKeys: noticed,
        blocks: cap([...state.blocks, { kind: "info", glyph: "info", text: effect.notice }], state.scrollbackLines),
      };
    }
    case "ingest": {
      // §8.7/§14.6 — one dim `ℹ` line per triggering limit key per turn, buffered
      // with the turn, sanitized. Names the source, the digest chunk count, and
      // the limit key to raise; the full text stays on disk (read_file ranges).
      if (state.noticedIngestKeys.has(effect.limitKey)) return state;
      const noticed = new Set(state.noticedIngestKeys);
      noticed.add(effect.limitKey);
      const name = sanitizeTarget(effect.source) || "content";
      const hit = effect.cacheHit ? " from cache" : "";
      const text = `Ingested ${name} as a digest (${effect.chunks} chunk${effect.chunks === 1 ? "" : "s"})${hit} — the full text stays on disk (limits.${effect.limitKey})`;
      return {
        ...state,
        noticedIngestKeys: noticed,
        blocks: cap([...state.blocks, { kind: "info", glyph: "info", text }], state.scrollbackLines),
      };
    }
    case "by_reference": {
      // §7.2/§8.7/§14.6 — one dim `ℹ` line per `kind` per turn, buffered with the
      // turn, sanitized. Names the kind and the rounded byte size.
      if (state.noticedByRefKinds.has(effect.kind)) return state;
      const noticed = new Set(state.noticedByRefKinds);
      noticed.add(effect.kind);
      const kb = Math.max(1, Math.round(effect.bytes / 1024));
      const kind = sanitizeTarget(effect.kind) || "content";
      const text = `${kind} passed by reference (${kb} KB)`;
      return {
        ...state,
        noticedByRefKinds: noticed,
        blocks: cap([...state.blocks, { kind: "info", glyph: "info", text }], state.scrollbackLines),
      };
    }
    case "model_changed":
      return { ...state, model: effect.name };
    case "worker_status": {
      const others = state.workers.filter((w) => w.workerId !== effect.workerId);
      const workers = [...others, { workerId: effect.workerId, status: effect.status, ...(effect.tool ? { tool: effect.tool } : {}) }];
      // §4.4 — update the matching fan-out row. A row changes state ONLY on a
      // real transition (so the live render repaints once per worker state
      // change, never per status-line tick); timestamps come from the first
      // `running` (start) and the first terminal status (finish). Match by
      // `taskId` when the event carries one, else by dispatch order (the Nth
      // distinct worker to report maps to the Nth still-`dispatched` row).
      let fanout = state.fanout;
      if (fanout) {
        const display = fanoutRowStatus(effect.status);
        const now = Date.now();
        let idx = -1;
        if (effect.taskId) idx = fanout.rows.findIndex((r) => r.taskId === effect.taskId);
        if (idx < 0) {
          // No taskId (or no match): bind this worker to the first row not yet
          // bound to a worker. We track binding by a transient `workerId` on the
          // row (added here, not part of the seeded shape).
          idx = fanout.rows.findIndex((r) => (r as FanoutRow & { workerId?: string }).workerId === effect.workerId);
          if (idx < 0) idx = fanout.rows.findIndex((r) => (r as FanoutRow & { workerId?: string }).workerId === undefined);
        }
        if (idx >= 0) {
          const row = fanout.rows[idx]! as FanoutRow & { workerId?: string };
          const nextRow: FanoutRow & { workerId?: string } = {
            ...row,
            workerId: row.workerId ?? effect.workerId,
            ...(row.worker === "worker" && effect.agent ? { worker: effect.agent } : {}),
            // §4.4 — carry the worker's current tool so the live state shows its
            // display name (e.g. `Run`, `Search`); cleared on a terminal state.
            ...(effect.tool !== undefined ? { tool: effect.tool } : {}),
          };
          // Record the start the first time the worker is seen running.
          if (nextRow.startedAt === undefined && (display === "running" || isTerminalFanoutStatus(display))) {
            nextRow.startedAt = now;
          }
          // Only advance the display status on a genuine change, and stamp the
          // finish time once on the first terminal transition.
          if (nextRow.status !== display) {
            nextRow.status = display;
            if (isTerminalFanoutStatus(display) && nextRow.finishedAt === undefined) nextRow.finishedAt = now;
          }
          // A terminal worker carries no current tool.
          if (isTerminalFanoutStatus(nextRow.status)) delete nextRow.tool;
          if (row === fanout.rows[idx] && rowsEqual(row, nextRow)) {
            // No change: keep the same object so no frame churns (§4.4).
          } else {
            const rows = [...fanout.rows];
            rows[idx] = nextRow;
            // Re-derive `Waiting`: a row whose deps just finished folds back to
            // `dispatched` and may start (§4.4).
            fanout = { ...fanout, rows: deriveWaiting(rows) };
          }
        }
      }
      return {
        ...state,
        workers,
        fanout,
        runningTasks: workers.filter((w) => w.status === "running").length,
      };
    }
    case "fanout_select": {
      // §4.4 — Ctrl+D/Ctrl+U move the selected row (navigate only; resolves
      // nothing). Clamp to `[0, rows.length)`; a no-op (edge, or no fan-out)
      // keeps the same state object so no frame churns.
      const fanout = state.fanout;
      if (!fanout || fanout.rows.length === 0) return state;
      const next = Math.min(fanout.rows.length - 1, Math.max(0, fanout.selected + effect.delta));
      if (next === fanout.selected) return state;
      return { ...state, fanout: { ...fanout, selected: next } };
    }
    case "branch_changed":
      return { ...state, branch: effect.branch };
    case "permission_resolved": {
      // §4.4 — only a `auto_approve` auto-approval marks a tool row. The core
      // emits `requestId: "auto-approve-<toolCallId>"`, so strip the prefix to recover
      // the tool id the TOOL_STARTED/TOOL_FINISHED pair is keyed by.
      if (effect.resolver !== "auto_approve" || !effect.requestId.startsWith("auto-approve-")) return state;
      const toolId = effect.requestId.slice("auto-approve-".length);
      if (toolId === "") return state;
      const next = new Set(state.autoApproveToolIds);
      next.add(toolId);
      return { ...state, autoApproveToolIds: next };
    }
    case "housekeeping":
      return { ...state, housekeeping: { idleSessions: effect.idleSessions, idleDays: effect.idleDays } };
    case "session_mode_changed":
      // §5.6 — SESSION_MODE_CHANGED is the single source of truth for the
      // bracket; the display follows the event, including a host change made
      // elsewhere. A successful change also clears any transient refusal notice.
      return { ...state, mode: effect.to, modeNotice: null };
    case "mode_notice":
      return { ...state, modeNotice: effect.message };
    case "approval_pending":
      // §4.2/§6.1 — the App's approval bridge toggles this when a dialog opens
      // or resolves. Freeze the status elapsed at the moment the prompt appeared
      // so it does not tick while the user decides.
      return {
        ...state,
        approvalPending: effect.pending,
        approvalStartedAt: effect.pending ? (state.approvalStartedAt ?? Date.now()) : null,
      };    case "system_block":
      // §7.4 — a fixed-width system block (e.g. `/access`) is appended verbatim
      // to the transcript as an info block; the renderer owns the layout.
      return {
        ...state,
        blocks: cap([...state.blocks, { kind: "info", glyph: "info", text: effect.text }], state.scrollbackLines),
      };
  }
}

/** Push a committed user block and start the turn clock. */
export function pushUser(state: ViewState, text: string): ViewState {
  return {
    ...state,
    blocks: cap([...state.blocks, { kind: "user", text }], state.scrollbackLines),
    turnStartedAt: Date.now(),
    streamOpen: true,
    // §4.7 — a new turn resets the per-turn notice dedup so each notice category
    // may surface once more.
    noticedCategories: new Set<string>(),
    // §13.11 — a new turn re-arms the per-key LIMIT_HIT line.
    noticedLimitKeys: new Set<string>(),
    // §8.7 — a new turn re-arms the per-key ingest and per-kind by-reference lines.
    noticedIngestKeys: new Set<string>(),
    noticedByRefKinds: new Set<string>(),
  };
}

/**
 * Flatten committed blocks to plain display lines for the history scroll view
 * (§4.10). A pure projection of view state — no color, no CoreAPI — used only
 * when the user scrolls up with `PageUp`; the live `<Static>` region owns the
 * rich rendering at the bottom.
 */
export function blockLines(blocks: Block[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "welcome":
        // The banner is rendered richly at the top of Static; the plain
        // scroll projection shows a one-line marker, not the glyph rows.
        lines.push(`VoidRift ${block.info.version}`);
        break;
      case "resume": {
        if (block.summary) lines.push(block.summary);
        if (block.pendingCount && block.pendingCount > 0) lines.push(`⚠ ${block.pendingCount} pending approval(s)`);
        if (block.staleDocuments && block.staleDocuments.length > 0)
          lines.push(`⚠ ${block.staleDocuments.length} documents changed since you left`);
        break;
      }
      case "user":
        lines.push(...block.text.split("\n").map((l) => `┃ ${l}`));
        break;
      case "assistant":
        if (block.thoughtMs && block.thoughtMs > 0) lines.push(`Thought for ${Math.round(block.thoughtMs / 1000)}s`);
        lines.push(...block.text.split("\n"));
        if (block.cancelled) lines.push("⊘ cancelled");
        else if (block.completionTokens > 0) {
          const mark = block.estimated ? "~" : "";
          const cost = block.cost !== undefined ? ` · $${block.cost.toFixed(4)}` : "";
          // §4.2 — `↑` is summed input, `↓` summed output; `tok/s` (generation
          // speed) is shown only when measured; `<0.1s` replaces the rate+elapsed
          // on a sub-0.1s turn.
          const tail =
            block.seconds < 0.1
              ? `· <0.1s`
              : block.tokensPerSecond !== undefined
                ? `· ${block.tokensPerSecond} tok/s · ${block.seconds}s`
                : `· ${block.seconds}s`;
          lines.push(`· ↑ ${mark}${block.promptTokens} · ↓ ${mark}${block.completionTokens} ${tail}${cost}`);
        }
        break;
      case "toolgroup": {
        const errors = block.calls.filter((c) => c.status !== "success").length;
        const open = errors > 0 || !block.collapsed;
        lines.push(`${open ? "▾" : "▸"} ${block.calls.length} tool call${block.calls.length === 1 ? "" : "s"}${!open && errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`);
        if (open) {
          for (const call of block.calls) {
            const dur = call.durationMs >= 1000 ? ` ${(call.durationMs / 1000).toFixed(1)}s` : "";
            lines.push(`● ${call.name}${dur}`);
            if (call.summary) lines.push(call.summary);
            if (call.diff) lines.push(...call.diff.replace(/\n$/, "").split("\n"));
          }
        }
        break;
      }
      case "fanout": {
        const hasFailure = block.rows.some((r) => r.status === "failed");
        const open = hasFailure || !block.collapsed;
        lines.push(`● Orchestrated (${block.agents} agents)`);
        if (open) {
          for (const row of block.rows) {
            const dur =
              row.startedAt !== undefined && row.finishedAt !== undefined && row.finishedAt - row.startedAt >= 1000
                ? ` · ${((row.finishedAt - row.startedAt) / 1000).toFixed(1)}s`
                : "";
            const title = row.title ? `${row.title}  ` : "";
            lines.push(`● ${title}${row.worker}  ${row.status}${dur}`);
            if (row.status === "failed" && row.reason) lines.push(`  ${row.reason}`);
          }
          lines.push("ctrl+g open agent monitor");
        }
        break;
      }
      case "info": {
        const glyph = block.glyph === "info" ? "ℹ" : block.glyph === "warn" ? "⚠" : "✗";
        lines.push(`${glyph} ${block.text}`);
        break;
      }
    }
    lines.push("");
  }
  return lines;
}

/** The committed buffer's display-line count (§4.10 scroll clamp). */
export function blockLineCount(blocks: Block[]): number {
  return blockLines(blocks).length;
}
