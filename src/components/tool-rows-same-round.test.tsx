/**
 * Regression (owner-reported, real session, cli-blueprint §4.2/§4.4): an
 * approved `edit_file` and a `save_memory` issued in the SAME model round must
 * BOTH commit as rows, in call order, and both survive the turn-end
 * auto-collapse. The real session showed NO rows at all for that round even
 * though the log proved `edit_file` ran. This feeds the real event sequence
 * through the actual reducer and renders the committed group through the real
 * OutputPane; the group carries a failed `save_memory`, so it stays expanded
 * after auto-collapse and both rows are visible.
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { OutputPane } from "./OutputPane.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { reduce, pushUser, initialState, type ViewState } from "../state.js";
import type { ViewEffect } from "../events/subscriptions.js";

const caps = (cols: number) =>
  detectCapabilities({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" }, { columns: cols, rows: 40 });

/** The exact ordering the owner's transcript produced in ONE model round:
 * edit_file starts and awaits approval, save_memory starts while it waits,
 * save_memory finishes with an error, then edit_file finishes ok with a diff. */
const ROUND: ViewEffect[] = [
  { type: "tool_started", id: "edit1", name: "edit_file", args: { path: "src/app.ts" } },
  // (the permission request/approval for edit_file is driven by the onApproval
  // bridge, not the reducer; it sets approvalPending via the approval effect)
  { type: "approval_pending", pending: true },
  { type: "approval_pending", pending: false },
  { type: "tool_started", id: "mem1", name: "save_memory", args: { title: "a fact" } },
  {
    type: "tool_finished",
    id: "mem1",
    name: "save_memory",
    status: "error",
    durationMs: 12,
    summary: "memory store is read-only",
  },
  {
    type: "tool_finished",
    id: "edit1",
    name: "edit_file",
    status: "success",
    durationMs: 48,
    summary: "1 file changed",
    diff: "@@ -1 +1 @@\n-old\n+new",
  },
];

function drive(effects: ViewEffect[]): ViewState {
  let s = pushUser(initialState(5000), "edit and remember");
  for (const e of effects) s = reduce(s, e);
  return s;
}

function renderRows(s: ViewState, cols: number): string {
  const theme = resolveTheme(caps(cols));
  const glyphs = resolveGlyphs(caps(cols));
  const r = render(
    <OutputPane state={s} theme={theme} glyphs={glyphs} caps={caps(cols)} reduceMotion columns={cols} />,
  );
  const frame = r.lastFrame()!;
  r.unmount();
  return frame;
}

describe("§4.2/§4.4 both tool rows of one round commit, in order", () => {
  it("edit_file and save_memory both appear when the round's last call finishes", () => {
    const s = drive(ROUND);
    // The group committed as ONE toolgroup block carrying both calls, in order.
    const group = s.blocks.find((b) => b.kind === "toolgroup");
    expect(group).toBeDefined();
    const calls = (group as { calls: { name: string }[] }).calls;
    expect(calls.map((c) => c.name)).toEqual(["save_memory", "edit_file"]);

    const frame = renderRows(s, 100);
    // Both friendly labels render as rows (Remember = save_memory, Edit = edit_file).
    expect(frame).toContain("Remember");
    expect(frame).toContain("Edit");
    // Order: the failing save_memory row precedes the edit_file row (call order).
    expect(frame.indexOf("Remember")).toBeLessThan(frame.indexOf("Edit"));
  });

  it("both rows survive the turn-end auto-collapse (errored group stays expanded)", () => {
    const after = reduce(drive(ROUND), {
      type: "turn_complete",
      status: "completed",
      text: "done",
      usage: { promptTokens: 10, completionTokens: 5, totalMs: 100 },
    });
    const frame = renderRows(after, 100);
    // The group has a failed call, so it stays EXPANDED after auto-collapse: the
    // header shows the open caret and both rows are still visible.
    expect(frame).toContain("2 tool calls");
    expect(frame).toContain("Remember");
    expect(frame).toContain("Edit");
    expect(frame.indexOf("Remember")).toBeLessThan(frame.indexOf("Edit"));
  });
});
