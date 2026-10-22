/**
 * Top-level agent cycling strings and data (cli-blueprint.md §3.5, §4.4, §5.1,
 * §5.2, §6).
 *
 * "Modes" are the top-level agents the user cycles through with `Shift+Tab`
 * (core §2.7); this module holds the data-driven cycle's pure strings and the
 * `TopAgent` shape derived from `agents.list()`. Nothing here tests for a
 * specific agent NAME (`vibe`/`research`/`chat`): the status-bar bracket colour
 * keys on the active agent's `unlisted === "allow"`, and the confirm-dialog
 * text keys on the agent's posture, both read from the agent definition.
 */

import { sanitize } from "./render/theme.js";

/** The subset of `agents.list()` the cycle needs (core `AgentInfo`). */
export interface TopAgent {
  name: string;
  label?: string | undefined;
  unlisted?: "deny" | "ask" | "allow" | undefined;
  confirm?: boolean | undefined;
  order?: number | undefined;
  /** The cascade source this agent resolved from (core §3.1); shown at the
   * confirm gate so a cloned-repo agent's provenance is visible. "builtin" for
   * the built-in `chat`; an absent source → a session/programmatic registration. */
  source?: "builtin" | "global" | "project" | "session" | undefined;
  /** The `agent.json` path this agent was discovered from (core §3.1); absent
   * for the built-in `chat` and programmatic registrations. */
  file?: string | undefined;
}

/** The bracket label for the active agent (§5.2): `label` wins over `name`. */
export function agentLabel(agent: TopAgent | undefined, fallback = "chat"): string {
  if (!agent) return fallback;
  return agent.label ?? agent.name;
}

/** True when the active agent is the auto-approve posture (`unlisted: allow`),
 * driving the bold-red status-bar bracket (§5.2). Determined from `unlisted`,
 * never from a name. */
export function isAllowPosture(agent: TopAgent | undefined): boolean {
  return agent?.unlisted === "allow";
}

/** The confirmation-dialog body for FIRST entry into a `confirm: true` agent
 * (§3.5, §6). An `unlisted: allow` agent names the approval-prompt disabling;
 * any other `confirm: true` agent uses the generic wording. The `<label>` is
 * the agent's label-or-name. The provenance line (`confirmProvenanceLine`) is
 * rendered separately by the dialog. */
export function confirmDialogText(agent: TopAgent): string {
  const label = agentLabel(agent);
  if (isAllowPosture(agent)) {
    return `${label} disables approval prompts for this session. Hard denies, Warden and guardrails still apply. [y] enable  [n] cancel`;
  }
  return `${label} asks for confirmation before it starts. [y] enable  [n] cancel`;
}

/** The one-line provenance tail for the confirm dialog: `defined by <source>:
 * <file>`, or `defined by <source>` when no file (the built-in `chat` or a
 * session/programmatic registration). The file path is sanitized. Returns the
 * empty string when the source is unknown (never happens via the core, which
 * always sets one). */
export function confirmProvenanceLine(agent: TopAgent): string {
  if (!agent.source) return "";
  const file = agent.file ? sanitize(agent.file) : "";
  return file ? `defined by ${agent.source}: ${file}` : `defined by ${agent.source}`;
}

/** The dim one-line refusal shown when a mode change is attempted mid-turn or
 * with a pending approval (§3.5). */
export const MODE_CHANGE_BUSY_NOTICE = "finish or cancel the current turn first";

/** The welcome hint tail (§5.1). */
export const MODE_CYCLE_HINT = "Shift+Tab to cycle modes.";

/** The tool-row marker for an `auto_approve` auto-approved call (§4.4). */
export const AUTO_APPROVE_TOOL_MARKER = "⚡";

/**
 * The top-level agents the cycle advances through, sorted by `order` then name
 * (§3.5). A forbidden agent (the managed layer refused `unlisted: allow`) is
 * dropped so the cycle skips it. Pure.
 */
export function sortTopAgents(agents: readonly TopAgent[], forbidden: ReadonlySet<string> = new Set()): TopAgent[] {
  return agents
    .filter((a) => !forbidden.has(a.name))
    .slice()
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
}

/**
 * The next agent name in the cycle after `current`, wrapping (§3.5). A `current`
 * outside the (possibly filtered) cycle advances to the first entry so the user
 * is never stuck. Pure. Returns undefined only when there are no agents.
 */
export function nextAgentName(
  agents: readonly TopAgent[],
  current: string,
  forbidden: ReadonlySet<string> = new Set(),
): string | undefined {
  const cycle = sortTopAgents(agents, forbidden);
  if (cycle.length === 0) return undefined;
  const idx = cycle.findIndex((a) => a.name === current);
  if (idx === -1) return cycle[0]!.name;
  return cycle[(idx + 1) % cycle.length]!.name;
}
