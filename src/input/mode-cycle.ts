/**
 * Data-driven top-level-agent cycling (cli-blueprint.md §3.5).
 *
 * `Shift+Tab` cycles the TOP-LEVEL agents reported by `agents.list()`
 * (`kind: "top-level"`), sorted by `order` (tie: name), wrapping, through the
 * host-only `session.setMode` (core §2.7). Nothing here tests for an agent
 * NAME: the next agent, its confirm requirement and its posture all come from
 * the agent definitions. The displayed bracket follows `SESSION_MODE_CHANGED`
 * (§5.6); this module only computes the next agent and calls `setMode`.
 *
 * - A change is refused while a turn runs or an approval is pending; the core
 *   returns `MODE_CHANGE_REFUSED` and this returns `{ kind: "busy" }` so the
 *   App shows the dim one-line notice and keeps the current agent (§3.5).
 * - An agent whose entry fails with the managed `AUTO_APPROVE_FORBIDDEN` is
 *   SKIPPED by the cycle: this records it and re-advances past it (§3.5).
 * - Entering a `confirm: true` agent the FIRST time this session needs the
 *   client confirmation (§6); the App owns the dialog and calls `enterAgent`.
 */
import type { CoreAPI, CoreError } from "@voidrift/core";
import { nextAgentName, type TopAgent } from "../mode.js";

/** The outcome of a `Shift+Tab` cycle attempt. */
export type CycleOutcome =
  | { kind: "changed"; agent: string } // setMode accepted
  | { kind: "confirm"; agent: TopAgent } // first entry into a confirm:true agent
  | { kind: "busy" } // MODE_CHANGE_REFUSED: a turn is running / approval pending
  | { kind: "unchanged" }; // no agents, or a refusal we cannot act on

/** Mutable per-session cycling state the App threads through each press. */
export interface CycleState {
  /** The last agent the CLI knows the session is in (reconciled by the event). */
  current: string;
  /** Top-level agent names the managed layer has refused (`unlisted: allow`). */
  forbidden: ReadonlySet<string>;
  /** Top-level agent names already confirmed this session (never re-prompted). */
  confirmed: ReadonlySet<string>;
}

function codeOf(error: CoreError | { code?: string }): string | undefined {
  return (error as { code?: string }).code;
}

function find(agents: readonly TopAgent[], name: string): TopAgent | undefined {
  return agents.find((a) => a.name === name);
}

/**
 * Compute the next top-level agent and drive `session.setMode` (§3.5). A first,
 * unconfirmed entry into a `confirm: true` agent hands off to the App's dialog
 * (§6); everything else calls the core. Returns the outcome AND the possibly-
 * updated cycle state (new `forbidden` when the managed layer refuses). The App
 * commits the displayed bracket on `SESSION_MODE_CHANGED`, not here (§5.6).
 */
export async function cycleMode(
  api: CoreAPI,
  sessionId: string,
  agents: readonly TopAgent[],
  state: CycleState,
): Promise<{ outcome: CycleOutcome; state: CycleState }> {
  const next = nextAgentName(agents, state.current, state.forbidden);
  if (next === undefined) return { outcome: { kind: "unchanged" }, state };
  const def = find(agents, next);

  // A first, unconfirmed entry into a `confirm: true` agent hands off to the
  // App's confirmation dialog (§6) instead of calling the core now.
  if (def && def.confirm === true && !state.confirmed.has(next)) {
    return { outcome: { kind: "confirm", agent: def }, state };
  }

  return applySetMode(api, sessionId, agents, next, state);
}

/** Enter a `confirm: true` agent after the dialog resolves `y` (§6): drive
 * `session.setMode(name, { confirmed: true })` and record the confirmation so
 * later switches to the same agent this session never ask again. */
export async function enterAgent(
  api: CoreAPI,
  sessionId: string,
  agents: readonly TopAgent[],
  name: string,
  state: CycleState,
): Promise<{ outcome: CycleOutcome; state: CycleState }> {
  const confirmedState: CycleState = { ...state, confirmed: new Set([...state.confirmed, name]) };
  return applySetMode(api, sessionId, agents, name, confirmedState, true);
}

/** Call `setMode` for `name`, handling busy/forbidden; on forbidden, record it
 * and re-advance past the agent so the cycle skips it. */
async function applySetMode(
  api: CoreAPI,
  sessionId: string,
  agents: readonly TopAgent[],
  name: string,
  state: CycleState,
  confirmed = false,
): Promise<{ outcome: CycleOutcome; state: CycleState }> {
  const def = find(agents, name);
  // A `confirm: true` agent (always the case for `unlisted: allow`) is passed
  // `{ confirmed: true }`; the core requires it (core §2.7).
  const needsConfirmed = confirmed || def?.confirm === true;
  const res = await api.session.setMode(sessionId, name, needsConfirmed ? { confirmed: true } : undefined);
  if (res.ok) {
    return { outcome: { kind: "changed", agent: name }, state: { ...state, current: name } };
  }
  const code = codeOf(res.error);
  if (code === "MODE_CHANGE_REFUSED") return { outcome: { kind: "busy" }, state };
  if (code === "AUTO_APPROVE_FORBIDDEN") {
    // The managed layer forbids this `unlisted: allow` agent: record it, drop it
    // from the cycle, and advance to the next agent so `Shift+Tab` moves past it.
    const forbidden = new Set([...state.forbidden, name]);
    const forbiddenState: CycleState = { ...state, forbidden };
    const nxt = nextAgentName(agents, state.current, forbidden);
    if (nxt === undefined || nxt === name) return { outcome: { kind: "unchanged" }, state: forbiddenState };
    return applySetMode(api, sessionId, agents, nxt, forbiddenState, confirmed);
  }
  return { outcome: { kind: "unchanged" }, state };
}
