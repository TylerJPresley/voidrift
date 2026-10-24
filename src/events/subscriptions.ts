/**
 * The scoped event subscription map (cli-blueprint.md §1.4).
 *
 * The CLI holds exactly two subscriptions: a session-scoped one for the active
 * session's turn, tool, context, model, worker, and approval events, and a
 * host-level unscoped one filtered to the events that belong to no session —
 * `BRANCH_CHANGED` (workspace scope) and `HOUSEKEEPING_NOTICE` (global scope).
 * Handlers are lightweight: they emit a `ViewEffect` the App applies to view
 * state and never call the CoreAPI or run async work in the render cycle (§1.4).
 */
import type { CoreAPI, EventEnvelope } from "@voidrift/core";

/** A lightweight view-state effect derived from one core event (§1.4). */
export type ViewEffect =
  | { type: "token"; token: string; done: boolean }
  | { type: "reasoning"; token: string; done: boolean }
  | { type: "tool_started"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_finished"; id: string; name: string; status: string; durationMs: number; summary: string; diff?: string }
  | { type: "turn_complete"; status: string; text: string; notice?: string; usage: { promptTokens: number; completionTokens: number; totalMs: number } }
  | { type: "model_usage"; promptTokens: number; inputSum: number; completionTokens: number; cacheReadTokens: number; genMs: number; estimated: boolean }
  | { type: "model_price"; price: { costPer1kInput?: number; costPer1kOutput?: number } | null }
  | { type: "turn_cancelled" }
  | { type: "error"; source: string; message: string; code?: string }
  | {
      type: "model_error";
      attempt: number;
      willRetry: boolean;
      name: string;
      code: string;
      message: string;
      maxRetries: number;
      baseUrl?: string | undefined;
      modelId?: string | undefined;
    }
  | { type: "context_budget"; percentage: number }
  | { type: "context_threshold"; level: string; percentage: number }
  | { type: "context_compacted"; turnsFolded: number }
  | { type: "context_overflow"; message: string }
  | { type: "warning"; category: string; message: string | undefined }
  | { type: "limit_hit"; key: string; notice: string }
  | { type: "ingest"; source: string; chunks: number; cacheHit: boolean; limitKey: string }
  | { type: "by_reference"; kind: string; bytes: number }
  | { type: "model_changed"; name: string }
  | { type: "worker_status"; workerId: string; status: string; tool?: string; agent?: string; taskId?: string }
  | { type: "worker_heartbeat"; workerId: string; taskId?: string }
  | { type: "fanout_select"; delta: number }
  | { type: "branch_changed"; branch: string | null }
  | { type: "permission_resolved"; requestId: string; resolver: string }
  | { type: "session_mode_changed"; from: string; to: string }
  | { type: "mode_notice"; message: string }
  | { type: "approval_pending"; pending: boolean }
  | { type: "system_block"; text: string }
  | { type: "housekeeping"; idleSessions: number; idleDays: number };

type P = Record<string, unknown>;

/** Resolve an endpoint name to its `baseUrl`/`modelId` for legible model-error
 * lines (§10.1). Backed by `models.list()`, snapshotted once at wiring time so
 * the pure mapper stays synchronous. */
export type EndpointResolver = (name: string) => { baseUrl?: string | undefined; modelId?: string | undefined };

/** Map a session-scoped event envelope to a view effect, or null to ignore. */
export function mapSessionEvent(ev: EventEnvelope, resolveEndpoint?: EndpointResolver): ViewEffect | null {
  const p = ev.payload as P;
  // §4.4/§7.2 — the orchestrator transcript carries ONLY the orchestrator's own
  // prose and tool calls plus the fan-out list and final summaries. A worker's
  // streamed text, reasoning and tool calls are WORKER-scoped (they carry
  // `scope.worker`); they are reachable only through the monitor (Ctrl+G /
  // `subagents.stream()`) and must never merge into the orchestrator's transcript
  // (char-by-char interleaving) or its tool group (unattributed worker calls).
  // Worker lifecycle (WORKER_STATUS_CHANGED), usage roll-up (MODEL_USAGE,
  // core §10.14) and worker approvals stay — they are not transcript prose.
  // §4.4 (liveness shimmer) — a worker-scoped TOKEN_STREAM / REASONING_STREAM /
  // TOOL_STARTED / TOOL_FINISHED is NOT merged into the orchestrator transcript
  // (its text/reasoning/tool rows stay worker-scoped), but its ARRIVAL times the
  // worker's live fan-out row: it maps to a `worker_heartbeat` carrying only the
  // worker id (and task id when present) — no token, no reasoning, no tool name.
  const fromWorker = ev.scope.worker !== undefined;
  if (fromWorker && (ev.type === "TOKEN_STREAM" || ev.type === "REASONING_STREAM" || ev.type === "TOOL_STARTED" || ev.type === "TOOL_FINISHED")) {
    const wid = ev.scope.worker ?? "";
    const taskId = typeof p["taskId"] === "string" ? (p["taskId"] as string) : undefined;
    return { type: "worker_heartbeat", workerId: wid, ...(taskId !== undefined ? { taskId } : {}) };
  }
  switch (ev.type) {
    case "TOKEN_STREAM":
      return { type: "token", token: String(p["token"] ?? ""), done: Boolean(p["done"]) };
    case "REASONING_STREAM":
      return { type: "reasoning", token: String(p["token"] ?? ""), done: Boolean(p["done"]) };
    case "TOOL_STARTED":
      return {
        type: "tool_started",
        id: String(p["id"] ?? ""),
        name: String(p["name"] ?? ""),
        args: (p["args"] as Record<string, unknown>) ?? {},
      };
    case "TOOL_FINISHED":
      return {
        type: "tool_finished",
        id: String(p["id"] ?? ""),
        name: String(p["name"] ?? ""),
        status: String(p["status"] ?? "success"),
        durationMs: Number(p["durationMs"] ?? 0),
        summary: String(p["summary"] ?? ""),
        ...(typeof p["diff"] === "string" ? { diff: p["diff"] as string } : {}),
      };
    case "TURN_COMPLETE":
      return {
        type: "turn_complete",
        status: String(p["status"] ?? "completed"),
        text: String(p["text"] ?? ""),
        // §4.7 — the step-limit notice text, when the core carries it on the
        // payload; the reducer falls back to the canonical wording if absent.
        ...(typeof p["notice"] === "string"
          ? { notice: p["notice"] as string }
          : typeof p["message"] === "string"
            ? { notice: p["message"] as string }
            : {}),
        usage: (p["usage"] as { promptTokens: number; completionTokens: number; totalMs: number }) ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalMs: 0,
        },
      };
    case "MODEL_USAGE": {
      const u = (p["usage"] as Record<string, number> | undefined) ?? {};
      return {
        type: "model_usage",
        // The PEAK single-prompt size (§4.8, context meter) — kept distinct from
        // the summed input the footer shows.
        promptTokens: Number(u["promptTokens"] ?? u["inputTokens"] ?? 0),
        // §10.7 — the turn's SUMMED input across every model call; the footer `↑`.
        inputSum: Number(u["inputSum"] ?? u["promptTokens"] ?? u["inputTokens"] ?? 0),
        completionTokens: Number(u["completionTokens"] ?? u["outputTokens"] ?? 0),
        cacheReadTokens: Number(u["cacheReadTokens"] ?? 0),
        // §10.7 — summed generation time (first-to-last streamed token); 0/absent
        // when the turn's calls were not streamed, so the footer omits `tok/s`.
        genMs: Number(u["genMs"] ?? 0),
        // §10.7 — the core marks a turn `estimated` when the response reported
        // no usage and the figure rests on the harness estimate; the footer
        // prints a leading `~` on such figures (cli §4.2).
        estimated: p["estimated"] === true,
      };
    }
    case "TURN_CANCELLED":
      return { type: "turn_cancelled" };
    case "ERROR_OCCURRED":
      return {
        type: "error",
        source: String(p["source"] ?? "engine"),
        message: String(p["message"] ?? ""),
        ...(p["code"] !== undefined ? { code: String(p["code"]) } : {}),
      };
    case "MODEL_ERROR": {
      const name = String(p["name"] ?? "model");
      const ep = resolveEndpoint?.(name) ?? {};
      return {
        type: "model_error",
        attempt: Number(p["attempt"] ?? 1),
        willRetry: Boolean(p["willRetry"]),
        name,
        code: String(p["code"] ?? "unknown"),
        message: String(p["message"] ?? ""),
        maxRetries: Number(p["maxRetries"] ?? 0),
        baseUrl: ep.baseUrl,
        modelId: ep.modelId,
      };
    }
    case "CONTEXT_BUDGET_UPDATED":
      return { type: "context_budget", percentage: Number(p["percentage"] ?? 0) };
    case "CONTEXT_THRESHOLD_CROSSED":
      return { type: "context_threshold", level: String(p["level"] ?? "notice"), percentage: Number(p["percentage"] ?? 0) };
    case "CONTEXT_COMPACTED":
      return { type: "context_compacted", turnsFolded: Number(p["turnsFolded"] ?? 0) };
    case "CONTEXT_OVERFLOW":
      return { type: "context_overflow", message: String(p["message"] ?? "context overflow") };
    case "WARNING_EMITTED":
      // §4.7 — carry the category and the raw `message`; the reducer decides
      // whether this is a dim `ℹ` notice (suggestion/read-lane/surprise) or a
      // true `⚠` warning, and fills a generic sentence when `message` is absent
      // (never the bare category word).
      return {
        type: "warning",
        category: String(p["category"] ?? ""),
        message: typeof p["message"] === "string" && p["message"] !== "" ? String(p["message"]) : undefined,
      };
    case "LIMIT_HIT":
      // §13.11/§14.6 — one dim `ℹ` line per key per turn (the core already
      // dedups the event per key per turn; the reducer dedups again defensively).
      // The sanitized notice names the key to raise.
      return {
        type: "limit_hit",
        key: String(p["key"] ?? ""),
        notice: typeof p["notice"] === "string" && p["notice"] !== "" ? String(p["notice"]) : `limit reached (limits.${String(p["key"] ?? "")})`,
      };
    case "INGEST":
      // §8.7/§14.6 — one dim `ℹ` line per triggering limit key per turn. The
      // source is the file name or URL; `chunks` is the digest chunk count and
      // `cacheHit` tells whether it was served from the digest cache.
      return {
        type: "ingest",
        source: String(p["source"] ?? ""),
        chunks: Number(p["chunks"] ?? 0),
        cacheHit: p["cacheHit"] === true,
        limitKey: String(p["key"] ?? "ingest.fitFraction"),
      };
    case "BY_REFERENCE":
      // §7.2/§8.7/§14.6 — one dim `ℹ` line per `what` kind per turn.
      return {
        type: "by_reference",
        kind: String(p["what"] ?? "content"),
        bytes: Number(p["bytes"] ?? 0),
      };
    case "MODEL_CHANGED":
      return { type: "model_changed", name: String(p["name"] ?? "") };    case "WORKER_STATUS_CHANGED":
      return {
        type: "worker_status",
        workerId: String(p["workerId"] ?? ""),
        status: String(p["status"] ?? "running"),
        ...(typeof p["tool"] === "string" ? { tool: p["tool"] as string } : {}),
        // §4.4 (cli) — the worker's agent and batch task id let the fan-out row
        // map to its `tasks[]` entry regardless of completion order.
        ...(typeof p["agent"] === "string" ? { agent: p["agent"] as string } : {}),
        ...(typeof p["taskId"] === "string" ? { taskId: p["taskId"] as string } : {}),
      };
    case "PERMISSION_RESOLVED":
      // §4.4 — a `auto_approve` auto-approval carries its resolver and a
      // `auto-approve-<toolCallId>` requestId; the reducer keys the tool-row `⚡`
      // marker on it. Any other resolver (interactive/out-of-band) is ignored.
      return {
        type: "permission_resolved",
        requestId: String(p["requestId"] ?? ""),
        resolver: String(p["resolver"] ?? ""),
      };
    case "SESSION_MODE_CHANGED":
      // §5.6 — the single source of truth for the status-bar bracket (§3.5).
      // The display follows the event, including a host change made elsewhere.
      return {
        type: "session_mode_changed",
        from: String(p["from"] ?? "chat"),
        to: String(p["to"] ?? "chat"),
      };
    default:
      return null;
  }
}

/** Map a host-level (unscoped) event to a view effect, filtered by type (§1.4). */
export function mapHostEvent(ev: EventEnvelope): ViewEffect | null {
  const p = ev.payload as P;
  switch (ev.type) {
    case "BRANCH_CHANGED":
      return { type: "branch_changed", branch: (p["branch"] as string | null) ?? null };
    case "HOUSEKEEPING_NOTICE":
      return { type: "housekeeping", idleSessions: Number(p["idleSessions"] ?? 0), idleDays: Number(p["idleDays"] ?? 0) };
    default:
      return null;
  }
}

/**
 * Wire the two subscriptions for the active session (§1.4). Returns an
 * unsubscribe that drops both. `dispatch` receives each derived effect.
 */
export function subscribe(
  api: CoreAPI,
  sessionId: string,
  dispatch: (effect: ViewEffect) => void,
  resolveEndpoint?: EndpointResolver,
): () => void {
  const unscoped = api.events.subscribe("*", (ev) => {
    const effect = mapHostEvent(ev);
    if (effect) dispatch(effect);
  });
  const scoped = api.events.subscribe(
    "*",
    (ev) => {
      const effect = mapSessionEvent(ev, resolveEndpoint);
      if (effect) dispatch(effect);
    },
    { scope: { session: sessionId } },
  );
  return () => {
    unscoped();
    scoped();
  };
}
