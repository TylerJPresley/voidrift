/**
 * The `/undo`, `/redo`, `/goto` renderers (cli-blueprint.md §7.5).
 *
 * Pure, NO_COLOR-safe renderers over the host rollback results (core §10.12) —
 * the UNIFIED move timeline where every completed turn is a move pairing the
 * conversation and the files:
 *   - {@link renderTimeline} turns a {@link MovesReport} into the fixed-width
 *     move list `/goto` (no argument) prints, with the pointer marker, the
 *     `(session start)` row (id 0), a `0 files … —` row for a chat-only move,
 *     and a `⚠ not undoable` tag.
 *   - {@link renderOutcome} turns a successful {@link RollbackOutcome} into its
 *     one-line summary naming the conversation move reached and the files.
 *   - {@link renderConflict} renders the conflict confirmation body.
 *   - {@link ROLLBACK_REFUSALS} holds the fixed refusal strings.
 *
 * Every move-derived string (the summary) is `sanitize`d before printing (§7.4),
 * so a crafted user-message first line cannot rewrite the layout. These helpers
 * start no turn and touch no model — the App wires them to `session.moves/undo/
 * redo/goto` and shows the result as a system message (or a confirm dialog).
 */
import type { MovesReport, RollbackOutcome, Move } from "@voidrift/core";
import { sanitize } from "./render/theme.js";

/** The fixed refusal lines (§7.5). The `busy`/`off`/`emptyUndo`/`emptyRedo`
 * forms are value-free; `unknownId` takes the missing id; `notUndoableMerge`
 * takes the blocked move number and the previous HEAD sha. EXACTLY the spec's. */
export const ROLLBACK_REFUSALS = Object.freeze({
  emptyUndo: "Nothing to undo: you are at the start of the session.",
  emptyRedo: "Nothing to redo: you are at the latest move.",
  busy: "Rollback is unavailable while a turn is running.",
  off: "Rollback is off (snapshotCount is 0). Set snapshotCount to enable it.",
  unknownId: (id: number | string): string => `No move ${id}. /goto with no argument lists the timeline.`,
  notUndoableMerge: (move: number, sha: string): string =>
    `Move ${move} applied a worker's changes (merge); /undo can't reverse it.\n` +
    `The previous HEAD was ${sha} — git reset there to undo it manually.`,
});

/** A merge `detail` carries the previous HEAD (e.g. `"previous HEAD abc123"` or
 * a bare sha). Pull the sha out so the refusal names it, falling back to the raw
 * detail when it holds no recognizable sha. Control-sanitized. */
function shaFromMergeDetail(detail: string): string {
  const cleaned = sanitize(detail).trim();
  const m = cleaned.match(/\b([0-9a-f]{7,40})\b/i);
  return m ? m[1]! : cleaned;
}

/**
 * Map a not-undoable (`ok:false`) outcome whose blocked move is a worktree
 * `merge` to the fixed §7.5 refusal, naming the blocked move and the previous
 * HEAD sha. Returns `null` when the outcome is not a merge refusal (the caller
 * then prints the outcome's own message). The move number is the core's refusal
 * message's `move N …` id when present (robust across prunes), else the pointer.
 */
export function renderNotUndoableMerge(outcome: RollbackOutcome): string | null {
  const merge = (outcome.notUndoable ?? []).find((n) => n.kind === "merge");
  if (!merge) return null;
  const fromMessage = outcome.message.match(/\bmove (\d+)\b/i);
  const moveNo = fromMessage ? Number(fromMessage[1]) : outcome.fromPointer;
  return ROLLBACK_REFUSALS.notUndoableMerge(moveNo, shaFromMergeDetail(merge.detail));
}

/** The method label used across the renderers (`git snapshots`/`cache snapshots`). */
function methodLabel(method: "git" | "cache" | undefined): string {
  return method === "git" ? "git snapshots" : "cache snapshots";
}

/** One-line, control-sanitized move summary, defaulting to `(no summary)`. */
function moveSummary(m: Move): string {
  const s = sanitize(m.summary ?? "").trim();
  return s === "" ? "(no summary)" : s;
}

/** The changed-file count phrase (`N file`/`N files`), read from the file half. */
function fileCountPhrase(m: Move): string {
  const n = m.files.paths.length;
  return `${n} file${n === 1 ? "" : "s"}`;
}

/** The method cell for a move row: the file method, or `—` for a chat-only
 * move whose file half is `none` (§7.5). */
function methodCell(m: Move): string {
  return m.files.method === "none" ? "\u2014" : m.files.method;
}

/** The `HH:MM` clock of a move's ISO time, or `--:--` when unparseable. */
function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Render the move timeline (`/goto` with no argument, §7.5). The header names
 * the move count and the method; each row carries id, time, summary, changed-
 * file count (`0 files` for a chat-only move), and method (`—` for chat-only),
 * with `▶` on the move at the pointer, a `(session start)` row for pointer 0,
 * and a `⚠ not undoable (<kind>)` tag on a not-undoable move. NO_COLOR-safe.
 */
export function renderTimeline(report: MovesReport): string {
  if (!report.enabled) return ROLLBACK_REFUSALS.off;
  const moves = report.moves ?? [];
  const pointer = report.pointer ?? 0;
  const L: string[] = [];
  L.push(`Move timeline — ${moves.length} move${moves.length === 1 ? "" : "s"}, ${methodLabel(report.method)}`);
  L.push("");
  // Pointer 0 row (session start).
  L.push(`${pointer === 0 ? "\u25B6 " : "  "}0                                    (session start)`);
  for (const m of moves) {
    const marker = pointer === m.id ? "\u25B6 " : "  ";
    const id = String(m.id).padEnd(2);
    const time = clockOf(m.time);
    const summary = moveSummary(m).padEnd(32).slice(0, 32);
    const files = fileCountPhrase(m).padEnd(8);
    let row = `${marker}${id} ${time}  ${summary}  ${files} ${methodCell(m)}`;
    if (m.files.notUndoable.length > 0) {
      row += `  \u26A0 not undoable (${m.files.notUndoable.map((n) => sanitize(n.kind)).join(", ")})`;
    }
    L.push(row);
  }
  L.push("");
  L.push("/undo steps back \u00B7 /redo steps forward \u00B7 /goto <id> jumps");
  return L.join("\n");
}

/** Render a successful rollback outcome's one-line summary (§7.5). It names the
 * conversation move reached and, when files changed, how many and by which
 * method; a chat-only move prints the `(no file changes)` variant. A cache move
 * whose shell effect could not be captured appends the not-undoable note. */
export function renderOutcome(outcome: RollbackOutcome): string {
  const method = outcome.method;
  const n = outcome.restored.length;
  const files = n > 0 ? `${n} file${n === 1 ? "" : "s"} restored (${method})` : "no file changes";
  let line: string;
  if (outcome.action === "undo") {
    line =
      n > 0
        ? `Undid move ${outcome.fromId}: conversation rewound to move ${outcome.toId}; ${files}. /redo to reapply.`
        : `Undid move ${outcome.fromId}: conversation rewound to move ${outcome.toId} (${files}). /redo to reapply.`;
  } else if (outcome.action === "redo") {
    line =
      n > 0
        ? `Redid move ${outcome.toId}: conversation advanced to move ${outcome.toId}; ${files}. /undo to reverse.`
        : `Redid move ${outcome.toId}: conversation advanced to move ${outcome.toId} (${files}). /undo to reverse.`;
  } else {
    const crossed = Math.abs(outcome.toPointer - outcome.fromPointer);
    const dir = outcome.toPointer < outcome.fromPointer ? "undone" : "redone";
    line = `Went to move ${outcome.toId} (${crossed} move${crossed === 1 ? "" : "s"} ${dir}, ${method}).`;
  }
  if (outcome.shellEffects > 0) {
    line += ` (${outcome.shellEffects} shell effect${outcome.shellEffects === 1 ? "" : "s"} not undoable: see /goto)`;
  }
  return line;
}

/** Render the conflict confirmation body (§7.5): the move, the conflicting
 * paths (sanitized, capped at 10 with a `+N more` line), and the overwrite
 * prompt. The App wraps this in its confirm dialog. The restore itself still
 * overwrites ALL conflicting paths — the cap is a display limit only. */
export function renderConflict(
  action: RollbackOutcome["action"],
  movePointer: number,
  conflicts: string[],
): string {
  const L: string[] = [];
  const verb = action === "undo" ? "Undo" : action === "redo" ? "Redo" : "Goto";
  L.push("\u26A0 Rollback conflict");
  L.push(
    `  ${verb} move ${movePointer} would overwrite ${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed since this move:`,
  );
  for (const p of conflicts.slice(0, 10)) L.push(`    ${sanitize(p)}`);
  if (conflicts.length > 10) L.push(`    +${conflicts.length - 10} more`);
  L.push("");
  L.push("  Overwrite them and continue? [y]es  [n]o");
  return L.join("\n");
}
