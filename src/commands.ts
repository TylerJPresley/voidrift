/**
 * Slash-command routing (cli-blueprint.md §7.3).
 *
 * A buffer beginning with `/` is a command, not a turn. The first token is the
 * name (lowercased) and the remainder space-delimited arguments. A few commands
 * map to a direct session/namespace operation; everything else is passed to
 * `session.command(name, args)` so a plugin command works with no CLI change.
 * A command never calls `session.send` and never starts a model turn (§7.3).
 */
import type { CoreAPI } from "@voidrift/core";
import { renderAccessReport } from "./access-command.js";
import { renderConfigReport, type ConfigPaths } from "./config-command.js";
import { renderTimeline, renderOutcome, renderNotUndoableMerge, ROLLBACK_REFUSALS } from "./rollback-command.js";

/** The result of dispatching a command: a view effect the App applies. */
export type CommandOutcome =
  | { kind: "handled" }
  | { kind: "open_panel"; name: string }
  | { kind: "system_message"; text: string }
  | {
      kind: "rollback_conflict";
      action: "undo" | "redo" | "goto";
      gotoId?: number;
      movePointer: number;
      conflicts: string[];
    }
  | { kind: "resume"; id?: string }
  | { kind: "new_session" }
  | { kind: "quit" }
  | { kind: "cancel" }
  | { kind: "editor" }
  | { kind: "open_file"; path: string }
  | { kind: "unknown"; name: string }
  | { kind: "error"; message: string };

export interface ParsedCommand {
  name: string;
  args: string[];
}

/** The max prompt length a routine `@file` may contribute (routines §2: 8192).
 * The CLI caps the file read at this bound before calling `save` (cli §7.3). */
export const ROUTINE_PROMPT_MAX = 8192;

/** Optional host dependencies for commands that read a file (`/routine save
 * <id> @<file>`). The App injects a workspace-relative text reader; without it
 * the `@file` form reports that it is unavailable rather than guessing a path. */
export interface CommandDeps {
  /** Read a workspace file as text (the App binds this to its workspace reader);
   * the caller caps the result at `ROUTINE_PROMPT_MAX`. */
  readPromptFile?: (relPath: string) => Promise<string>;
}

/** Split an argument string into tokens, honoring single/double quotes so a
 * quoted goal or prompt stays one argument (`/plan create demo "the goal"` →
 * `["create","demo","the goal"]`). Unquoted runs split on whitespace; an unclosed
 * quote runs to the end of the line. */
export function tokenizeArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** Parse a `/`-prefixed buffer into a command name and arguments (§7.3). The
 * remainder after the name is tokenized quote-aware so a quoted goal/prompt
 * survives as one argument. */
export function parseCommand(buffer: string): ParsedCommand | null {
  if (!buffer.startsWith("/")) return null;
  const body = buffer.slice(1).trim();
  const firstSpace = body.search(/\s/);
  const name = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  const rest = firstSpace === -1 ? "" : body.slice(firstSpace + 1);
  return { name, args: tokenizeArgs(rest) };
}

/**
 * The Slice-A commands that open a panel when given no argument. The value is
 * the registered panel id (`BUILTIN_PANELS` key, panels/declarations.ts), which
 * is the singular `model`/`agent` — not the panel *title* (`Models`/`Agents`).
 * A mismatch here raises `Unknown panel` at open time (§7.2).
 */
const PANEL_WHEN_NO_ARG: Record<string, string> = {
  model: "model",
  agent: "agent",
};

/**
 * Parse `/plan <subcommand> …` into the structured op object the plan plugin's
 * command handler requires (plan-blueprint §6, §3). Bare `/plan` opens the panel;
 * `show`/`view` request the digest. A malformed subcommand returns a plain-word
 * error; the plugin itself validates ids and goals and surfaces its own errors.
 */
export function parsePlanCommand(args: readonly string[]): {
  payload?: unknown;
  openPanel?: boolean;
  show?: boolean;
  error?: string;
} {
  const sub = args[0]?.toLowerCase();
  if (!sub) return { openPanel: true };
  switch (sub) {
    case "show":
    case "view":
      // `/plan show [id]` — view the named or active plan.
      return args[1] ? { payload: { op: "view", id: args[1] }, show: true } : { payload: { op: "view" }, show: true };
    case "create": {
      // `/plan create <id> "<goal>"`.
      const id = args[1];
      const goal = args.slice(2).join(" ");
      if (!id) return { error: '/plan create requires an <id> and a "<goal>"' };
      if (goal.trim() === "") return { error: '/plan create requires a "<goal>" (quote it if it has spaces)' };
      return { payload: { op: "create", id, goal, author: "human" } };
    }
    case "add-step": {
      // `/plan add-step <id> "<title>" ["<detail>"]`.
      const id = args[1];
      const title = args[2];
      if (!id || !title) return { error: '/plan add-step requires an <id> and a "<title>"' };
      const step: { title: string; detail?: string } = { title };
      if (args[3]) step.detail = args.slice(3).join(" ");
      return { payload: { op: "add-step", id, step, author: "human" } };
    }
    case "activate": {
      const id = args[1];
      if (!id) return { error: "/plan activate requires an <id>" };
      return { payload: { op: "activate", id } };
    }
    case "advance": {
      const id = args[1];
      if (!id) return { error: "/plan advance requires an <id>" };
      const outcome = args[2]?.toLowerCase();
      if (outcome && outcome !== "passed" && outcome !== "failed") {
        return { error: "/plan advance outcome must be `passed` or `failed`" };
      }
      return { payload: { op: "advance", id, ...(outcome ? { outcome } : {}) } };
    }
    case "verify":
      // `verify` is the reviewer gate the loop runs; at the command surface it is
      // an `advance` with an explicit outcome the user supplies.
      return parsePlanCommand(["advance", ...args.slice(1)]);
    case "abandon": {
      const id = args[1];
      if (!id) return { error: "/plan abandon requires an <id>" };
      return { payload: { op: "abandon", id } };
    }
    default:
      return { error: `unknown /plan subcommand "${sub}" (create, add-step, activate, advance, verify, show, abandon)` };
  }
}


export async function dispatchCommand(
  api: CoreAPI,
  sessionId: string,
  cmd: ParsedCommand,
  known: readonly string[],
  deps: CommandDeps = {},
): Promise<CommandOutcome> {
  const { name, args } = cmd;
  switch (name) {
    case "help":
      return { kind: "open_panel", name: "help" };
    case "sessions":
      return { kind: "open_panel", name: "sessions" };
    case "diff":
      return { kind: "open_panel", name: "diff" };
    case "tools":
      return { kind: "open_panel", name: "tools" };
    case "plugins":
      return { kind: "open_panel", name: "plugins" };
    case "permissions":
      return { kind: "open_panel", name: "permissions" };
    case "access": {
      // §7.4 — `/access` prints the effective-permissions block for the CURRENT
      // active agent as a system message. It starts no turn, calls no model, and
      // makes no network request: it reads the host-only `config.access`.
      const res = await api.config.access();
      if (!res.ok) return { kind: "error", message: res.error.message };
      return { kind: "system_message", text: renderAccessReport(res.value) };
    }
    case "compliance":
      return { kind: "open_panel", name: "compliance" };
    case "config": {
      // §7.3 — `/config` prints the effective config and its layers (host-only
      // `config.paths()` + `config.get()`, no model/network/turn, secrets never
      // printed). `/config edit` opens the PROJECT config file in the editor
      // (§3.8); the App spawns the editor on the returned path.
      if (args[0]?.toLowerCase() === "edit") {
        const p = (await api.config.paths()) as { ok: boolean; value?: unknown; error?: { message: string } };
        if (!p.ok) return { kind: "error", message: p.error?.message ?? "config paths unavailable" };
        const paths = p.value as ConfigPaths;
        return { kind: "open_file", path: paths.project.path };
      }
      type R = { ok: boolean; value?: unknown; error?: { message: string } };
      const paths = (await api.config.paths()) as R;
      const effective = (await api.config.get()) as R;
      if (!paths.ok) return { kind: "error", message: paths.error?.message ?? "config paths unavailable" };
      if (!effective.ok) return { kind: "error", message: effective.error?.message ?? "config unavailable" };
      return { kind: "system_message", text: renderConfigReport(paths.value as ConfigPaths, effective.value) };
    }
    case "memory":
      return { kind: "open_panel", name: "memory" };
    case "skills":
      return { kind: "open_panel", name: "skills" };
    case "prompts":
      return { kind: "open_panel", name: "prompts" };
    case "stats":
      return { kind: "open_panel", name: "stats" };
    case "export": {
      // §7.3 / core §10.13 — `/export` renders the CURRENT session as a
      // sanitized document. Without `--out` it renders into the transcript (a
      // system message); with `--out` it writes an owner-only file. It starts no
      // turn, calls no model, makes no network request. Flags: `--format
      // md|json` (default json), `--out <path>`, `--no-tool-results`.
      let format: "md" | "json" | undefined;
      let out: string | undefined;
      let noToolResults = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === "--format") {
          const next = args[i + 1];
          if (next !== "md" && next !== "json") return { kind: "error", message: '/export --format must be md or json' };
          format = next;
          i += 1;
        } else if (a === "--out") {
          const next = args[i + 1];
          if (next === undefined || next.startsWith("-")) return { kind: "error", message: '/export --out requires a <path>' };
          out = next;
          i += 1;
        } else if (a === "--no-tool-results") {
          noToolResults = true;
        } else {
          return { kind: "error", message: `/export: unexpected argument "${a}"` };
        }
      }
      const res = await api.session.export(sessionId, {
        ...(format ? { format } : {}),
        ...(out ? { out } : {}),
        ...(noToolResults ? { includeToolResults: false } : {}),
      });
      if (!res.ok) return { kind: "error", message: res.error.message };
      if (res.value.path) return { kind: "system_message", text: `Exported to ${res.value.path}` };
      return { kind: "system_message", text: res.value.content ?? "" };
    }
    case "context":
      return { kind: "open_panel", name: "context" };
    case "mcp": {
      // `/mcp` opens the panel; `/mcp connect|disconnect <name>` changes a
      // connection — exactly one CoreAPI op per action (§7.3).
      const sub = args[0]?.toLowerCase();
      if (sub === "connect" && args[1]) {
        const res = await api.mcp.connect(args[1]);
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      if (sub === "disconnect" && args[1]) {
        const res = await api.mcp.disconnect(args[1]);
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      return { kind: "open_panel", name: "mcp" };
    }
    case "resume":
      return args[0] ? { kind: "resume", id: args[0] } : { kind: "open_panel", name: "sessions" };
    case "new":
    case "clear": {
      const res = name === "clear" ? await api.session.clear(sessionId) : await api.session.create();
      return res.ok ? { kind: "new_session" } : { kind: "error", message: res.error.message };
    }
    case "model": {
      if (!args[0]) return { kind: "open_panel", name: PANEL_WHEN_NO_ARG["model"]! };
      const res = await api.models.switch(args[0]);
      return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
    }
    case "agent": {
      // §7.3 — `/agent <name>` switches the session's ACTIVE TOP-LEVEL agent via
      // `session.setMode` (NOT `agents.activate`, which only sets a dispatch
      // default). The status-bar bracket follows the resulting
      // SESSION_MODE_CHANGED event (§5.6). An unknown name surfaces the core's
      // NOT_FOUND message, which already lists the valid top-level agents (core
      // §2.7); bare `/agent` opens the agents panel.
      if (!args[0]) return { kind: "open_panel", name: PANEL_WHEN_NO_ARG["agent"]! };
      const res = await api.session.setMode(sessionId, args[0]);
      return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
    }
    case "routine": {
      // §7.3 / routines-blueprint §4 — the routine command handler accepts the
      // structured shapes `{ save }`, `{ list }`, `{ show }`, `{ delete }`, or a
      // bare id / `{ id }` (run). The CLI parses the subcommand into that shape.
      const sub = args[0]?.toLowerCase();
      if (sub === "list") {
        const res = await api.session.command("routine", { list: true });
        if (!res.ok) return { kind: "error", message: res.error.message };
        const rows = (res.value as { routines?: { id: string; preview: string }[] }).routines ?? [];
        if (rows.length === 0) return { kind: "system_message", text: "no saved routines" };
        const text = rows.map((r) => `${r.id}  —  ${r.preview.replace(/\s+/g, " ")}`).join("\n");
        return { kind: "system_message", text };
      }
      if (sub === "show") {
        const id = args[1];
        if (!id) return { kind: "error", message: "/routine show requires an <id>" };
        const res = await api.session.command("routine", { show: id });
        if (!res.ok) return { kind: "error", message: res.error.message };
        const r = (res.value as { routine: { id: string; prompt: string } }).routine;
        return { kind: "system_message", text: `${r.id}\n\n${r.prompt}` };
      }
      if (sub === "delete") {
        const id = args[1];
        if (!id) return { kind: "error", message: "/routine delete requires an <id>" };
        const res = await api.session.command("routine", { delete: id });
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      if (sub === "save") {
        // `/routine save <id> <prompt...>` or `/routine save <id> @<file>`.
        const id = args[1];
        if (!id) return { kind: "error", message: "/routine save requires an <id> and a <prompt>" };
        const rest = args.slice(2);
        let prompt: string;
        if (rest.length === 1 && rest[0]!.startsWith("@")) {
          // `@<file>` — read through the host's workspace reader, capped (§7.3).
          const rel = rest[0]!.slice(1);
          if (!deps.readPromptFile) {
            return { kind: "error", message: "/routine save <id> @file is not available here — pass the prompt text inline" };
          }
          if (rel === "") return { kind: "error", message: "/routine save <id> @<file> requires a file path" };
          try {
            const body = await deps.readPromptFile(rel);
            prompt = body.slice(0, ROUTINE_PROMPT_MAX);
          } catch (e) {
            return { kind: "error", message: `/routine save: cannot read "${rel}": ${(e as Error).message}` };
          }
        } else {
          prompt = rest.join(" ");
        }
        if (prompt.trim() === "") return { kind: "error", message: "/routine save requires a non-empty <prompt>" };
        const res = await api.session.command("routine", { save: { id, prompt } });
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      if (sub === "run") {
        const id = args[1];
        if (!id) return { kind: "error", message: "/routine run requires an <id>" };
        const res = await api.session.command("routine", id);
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      // Bare `/routine <id>` runs the saved routine (the headless/on-demand path).
      if (!args[0]) return { kind: "error", message: "/routine requires an <id> (or `list` / `show <id>` / `save <id> <prompt>` / `delete <id>` / `run <id>`)" };
      const res = await api.session.command("routine", args[0]);
      return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
    }
    case "plan": {
      // plan-blueprint §6 / §3 — the plan command handler requires a STRUCTURED
      // op object `{ op, id, … }`; the CLI parses the subcommand into it. Bare
      // `/plan` opens the plan panel (§6). A validation problem is reported in
      // plain words; the plugin's own errors (unknown id, bad slug) surface too.
      const outcome = parsePlanCommand(args);
      if (outcome.error) return { kind: "error", message: outcome.error };
      if (outcome.openPanel) return { kind: "open_panel", name: "plan" };
      const res = await api.session.command("plan", outcome.payload);
      if (!res.ok) return { kind: "error", message: res.error.message };
      // `show`/`view` print the plan digest as a system message; authoring ops
      // just acknowledge (the panel/context reflect the new state).
      const v = res.value as { digest?: string; status?: string; plan?: unknown } | null;
      if (outcome.show) {
        if (!v || v.plan === null) return { kind: "system_message", text: "no plan yet — create one with /plan create <id> \"<goal>\"" };
        const lines = [v.status, "", v.digest].filter(Boolean).join("\n");
        return { kind: "system_message", text: lines };
      }
      return { kind: "handled" };
    }
    case "compact": {
      const res = await api.session.compact(sessionId);
      return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
    }
    case "undo":
    case "redo":
      return dispatchRollback(api, sessionId, name);
    case "goto": {
      // `/goto` with no argument lists the timeline; `/goto <id>` jumps.
      if (args[0] === undefined) {
        const res = await api.session.moves(sessionId);
        if (!res.ok) return rollbackError(res.error);
        return { kind: "system_message", text: renderTimeline(res.value) };
      }
      const id = Number(args[0]);
      if (!Number.isInteger(id) || id < 0) {
        // §7.5 — a non-integer / negative id is treated as an unknown move id:
        // the fixed unknown-id refusal, naming the (unparseable) argument.
        return { kind: "system_message", text: ROLLBACK_REFUSALS.unknownId(args[0]) };
      }
      return dispatchRollback(api, sessionId, "goto", id);
    }
    case "cancel":
      await api.session.cancel(sessionId);
      return { kind: "cancel" };
    case "editor":
      return { kind: "editor" };
    case "quit":
    case "exit":
      return { kind: "quit" };
    default: {
      // A command the CLI does not special-case routes through session.command
      // when it is registered; otherwise it is unknown (§7.3).
      if (known.includes(name)) {
        const res = await api.session.command(name, args.join(" "));
        return res.ok ? { kind: "handled" } : { kind: "error", message: res.error.message };
      }
      return { kind: "unknown", name };
    }
  }
}

/** Map a rollback CoreError to the fixed §7.5 refusal/system-message outcome.
 * `SESSION_BUSY` → running-turn refusal; `NOT_FOUND` on a goto id → unknown-id
 * line; anything else → a plain error. */
function rollbackError(error: { code?: string; message: string }, gotoId?: number): CommandOutcome {
  if (error.code === "SESSION_BUSY") return { kind: "system_message", text: ROLLBACK_REFUSALS.busy };
  if (error.code === "NOT_FOUND" && gotoId !== undefined) {
    return { kind: "system_message", text: ROLLBACK_REFUSALS.unknownId(gotoId) };
  }
  return { kind: "error", message: error.message };
}

/**
 * Run a rollback op (`/undo`, `/redo`, `/goto <id>`) against the host session
 * API (§7.5). A successful outcome prints its summary; a `rollback is off`
 * outcome (snapshotCount 0) prints the off line; a conflict raises the confirm
 * dialog (the App re-runs with `confirmOverwrite`); a `SESSION_BUSY`/`NOT_FOUND`
 * error maps to the fixed refusal. Never starts a model turn.
 */
async function dispatchRollback(
  api: CoreAPI,
  sessionId: string,
  action: "undo" | "redo" | "goto",
  gotoId?: number,
  confirmOverwrite?: string[],
): Promise<CommandOutcome> {
  const opts = confirmOverwrite ? { confirmOverwrite } : undefined;
  const res =
    action === "undo"
      ? await api.session.undo(sessionId, opts)
      : action === "redo"
        ? await api.session.redo(sessionId, opts)
        : await api.session.goto(sessionId, gotoId!, opts);
  if (!res.ok) return rollbackError(res.error, gotoId);
  const outcome = res.value;
  // Disabled (snapshotCount 0): the structured outcome is not ok with the off
  // message — print the fixed off line.
  if (!outcome.ok && (!outcome.conflicts || outcome.conflicts.length === 0)) {
    // A plan refusal (off, not-undoable merge, already-at-end). Map each to its
    // fixed §7.5 line; a merge gets the two-line explanation naming the previous
    // HEAD, everything else prints the core's own message.
    if (outcome.message.includes("snapshotCount")) {
      return { kind: "system_message", text: ROLLBACK_REFUSALS.off };
    }
    // §7.5 — the empty-timeline boundary: /undo at the start, /redo at the end.
    if (action === "undo" && outcome.message.includes("start of the timeline")) {
      return { kind: "system_message", text: ROLLBACK_REFUSALS.emptyUndo };
    }
    if (action === "redo" && outcome.message.includes("end of the timeline")) {
      return { kind: "system_message", text: ROLLBACK_REFUSALS.emptyRedo };
    }
    const merge = renderNotUndoableMerge(outcome);
    if (merge !== null) return { kind: "system_message", text: merge };
    return { kind: "system_message", text: outcome.message };
  }
  // A conflict: raise the confirm dialog (the App re-runs with confirmOverwrite).
  if (!outcome.ok && outcome.conflicts && outcome.conflicts.length > 0) {
    return {
      kind: "rollback_conflict",
      action,
      ...(gotoId !== undefined ? { gotoId } : {}),
      movePointer: outcome.fromId,
      conflicts: outcome.conflicts,
    };
  }
  return { kind: "system_message", text: renderOutcome(outcome) };
}

/** Re-run a rollback op after the user confirmed the overwrite in the conflict
 * dialog (§7.5). Exposed so the App can continue an all-or-nothing restore. */
export async function confirmRollback(
  api: CoreAPI,
  sessionId: string,
  action: "undo" | "redo" | "goto",
  conflicts: string[],
  gotoId?: number,
): Promise<CommandOutcome> {
  return dispatchRollback(api, sessionId, action, gotoId, conflicts);
}
