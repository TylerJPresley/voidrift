/**
 * The `/undo`, `/redo`, `/goto` renderers (cli-blueprint.md §7.5). NO_COLOR-safe
 * text over the host rollback results; control-sanitized summaries; fixed
 * refusal lines. The move timeline is UNIFIED (conversation + files), so a
 * chat-only move renders `0 files … —`.
 */
import { describe, it, expect } from "vitest";
import { renderTimeline, renderOutcome, renderConflict, renderNotUndoableMerge, ROLLBACK_REFUSALS } from "./rollback-command.js";
import type { MovesReport, RollbackOutcome, Move } from "@voidrift/core";

const move = (id: number, over: Partial<Move> = {}): Move =>
  ({
    id,
    sessionId: "s",
    turn: id,
    time: "2026-01-01T14:02:00.000Z",
    summary: `move ${id}`,
    conversation: { beforeCheckpointId: id === 1 ? null : `cp-${id - 1}`, afterCheckpointId: `cp-${id}` },
    files: { method: "git" as const, paths: [{ path: "a.ts", kind: "modified" as const, restorable: true }], notUndoable: [] },
    ...over,
  });

/** A chat-only move (empty file half, method none). */
const chatMove = (id: number): Move => move(id, { files: { method: "none", paths: [], notUndoable: [] } });

const outcome = (over: Partial<RollbackOutcome> = {}): RollbackOutcome => ({
  ok: true,
  action: "undo",
  fromPointer: 3,
  toPointer: 2,
  fromId: 3,
  toId: 2,
  restored: ["a.ts", "b.ts"],
  skipped: [],
  undone: 1,
  shellEffects: 0,
  method: "git",
  message: "x",
  ...over,
});

describe("renderTimeline (§7.5)", () => {
  it("renders the pointer marker, the (session start) row, a chat-only row, and a not-undoable tag; NO ANSI", () => {
    const report: MovesReport = {
      enabled: true,
      method: "git",
      pointer: 1,
      moves: [
        move(1),
        chatMove(2),
        move(3, {
          files: {
            method: "git",
            notUndoable: [{ kind: "merge", detail: "voidrift-run-7f3a" }],
            paths: [
              { path: "a.ts", kind: "modified", restorable: true },
              { path: "b.ts", kind: "created", restorable: true },
            ],
          },
        }),
      ],
    };
    const out = renderTimeline(report);
    expect(out).not.toMatch(/\u001B\[/);
    expect(out).toContain("Move timeline — 3 moves, git snapshots");
    expect(out).toContain("(session start)");
    expect(out).toMatch(/\u25B6 1 /); // the pointer marks move 1
    // The chat-only move renders `0 files` and an em-dash method cell.
    expect(out).toMatch(/2 .*0 files .*\u2014/);
    expect(out).toContain("\u26A0 not undoable (merge)");
    expect(out).toContain("/undo steps back \u00B7 /redo steps forward \u00B7 /goto <id> jumps");
  });

  it("marks pointer 0 (session start)", () => {
    const out = renderTimeline({ enabled: true, method: "cache", pointer: 0, moves: [move(1)] });
    expect(out).toMatch(/\u25B6 0 /);
    expect(out).toContain("(session start)");
  });

  it("control-sanitizes a crafted summary so it cannot rewrite the layout", () => {
    const out = renderTimeline({ enabled: true, method: "git", pointer: 0, moves: [move(1, { summary: "evil\u001B[2Ktitle" })] });
    expect(out).not.toContain("\u001B");
  });

  it("a disabled report prints the off line", () => {
    expect(renderTimeline({ enabled: false })).toBe(ROLLBACK_REFUSALS.off);
  });
});

describe("renderOutcome (§7.5)", () => {
  it("undo summary names the conversation move reached and the files + redo hint", () => {
    expect(renderOutcome(outcome({ fromId: 12, toId: 11, restored: ["a.ts", "b.ts", "c.ts"] }))).toBe(
      "Undid move 12: conversation rewound to move 11; 3 files restored (git). /redo to reapply.",
    );
  });

  it("undo of a chat-only move prints the (no file changes) variant", () => {
    expect(renderOutcome(outcome({ fromId: 12, toId: 11, restored: [] }))).toBe(
      "Undid move 12: conversation rewound to move 11 (no file changes). /redo to reapply.",
    );
  });

  it("redo summary names the move and the undo hint", () => {
    expect(renderOutcome(outcome({ action: "redo", fromId: 2, toId: 3, fromPointer: 2, toPointer: 3, restored: ["a.ts", "b.ts"] }))).toBe(
      "Redid move 3: conversation advanced to move 3; 2 files restored (git). /undo to reverse.",
    );
  });

  it("goto summary names the moves undone and the method", () => {
    expect(renderOutcome(outcome({ action: "goto", fromPointer: 4, toPointer: 1, fromId: 4, toId: 1, undone: 3, restored: ["a.ts"] }))).toBe(
      "Went to move 1 (3 moves undone, git).",
    );
  });

  it("a cache shell effect appends the not-undoable note", () => {
    const out = renderOutcome(outcome({ method: "cache", shellEffects: 1 }));
    expect(out).toContain("(1 shell effect not undoable: see /goto)");
  });
});

describe("renderConflict (§7.5)", () => {
  it("lists the conflicting paths and the overwrite prompt; sanitized", () => {
    const out = renderConflict("undo", 3, ["src/users.ts", "src/pager.ts"]);
    expect(out).toContain("\u26A0 Rollback conflict");
    expect(out).toContain("Undo move 3 would overwrite 2 files changed since this move:");
    expect(out).toContain("src/users.ts");
    expect(out).toContain("Overwrite them and continue? [y]es  [n]o");
  });

  it("caps the displayed paths at 10 with a +N more line (count still reflects all)", () => {
    const paths = Array.from({ length: 13 }, (_, i) => `src/f${i}.ts`);
    const out = renderConflict("goto", 2, paths);
    expect(out).toContain("would overwrite 13 files changed since this move:");
    expect(out).toContain("src/f0.ts");
    expect(out).toContain("src/f9.ts");
    expect(out).not.toContain("src/f10.ts");
    expect(out).toContain("+3 more");
  });
});

describe("renderNotUndoableMerge / ROLLBACK_REFUSALS.notUndoableMerge (§7.5)", () => {
  const mergeOutcome = outcome({
    ok: false,
    action: "undo",
    fromPointer: 4,
    toPointer: 4,
    fromId: 4,
    toId: 4,
    restored: [],
    undone: 0,
    notUndoable: [{ kind: "merge", detail: "previous HEAD abc1234" }],
    message: "move 4 cannot be undone: it applied a worktree merge (previous HEAD abc1234)",
  });

  it("builds the two-line merge refusal naming the move and the previous HEAD sha", () => {
    expect(renderNotUndoableMerge(mergeOutcome)).toBe(
      "Move 4 applied a worker's changes (merge); /undo can't reverse it.\n" +
        "The previous HEAD was abc1234 — git reset there to undo it manually.",
    );
  });

  it("falls back to the raw detail when it holds no recognizable sha", () => {
    const out = renderNotUndoableMerge({ ...mergeOutcome, notUndoable: [{ kind: "merge", detail: "unknown" }] });
    expect(out).toContain("The previous HEAD was unknown —");
  });

  it("returns null for a non-merge not-undoable outcome (shell/apply/off)", () => {
    expect(renderNotUndoableMerge({ ...mergeOutcome, notUndoable: [{ kind: "shell", detail: "x" }] })).toBeNull();
    const { notUndoable: _omit, ...noNotUndoable } = mergeOutcome;
    expect(renderNotUndoableMerge(noNotUndoable as RollbackOutcome)).toBeNull();
  });

  it("the fixed string matches the spec wording exactly", () => {
    expect(ROLLBACK_REFUSALS.notUndoableMerge(4, "deadbeef")).toBe(
      "Move 4 applied a worker's changes (merge); /undo can't reverse it.\n" +
        "The previous HEAD was deadbeef — git reset there to undo it manually.",
    );
  });
});

describe("ROLLBACK_REFUSALS (§7.5)", () => {
  it("the fixed refusal strings match the spec", () => {
    expect(ROLLBACK_REFUSALS.emptyUndo).toBe("Nothing to undo: you are at the start of the session.");
    expect(ROLLBACK_REFUSALS.busy).toBe("Rollback is unavailable while a turn is running.");
    expect(ROLLBACK_REFUSALS.off).toBe("Rollback is off (snapshotCount is 0). Set snapshotCount to enable it.");
    expect(ROLLBACK_REFUSALS.unknownId(9)).toBe("No move 9. /goto with no argument lists the timeline.");
  });
});
