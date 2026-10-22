import React from "react";
import { Box, Text } from "ink";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import {
  sanitize,
  toolDisplayName,
  toolColor,
  shortenArg,
  fullArgs,
  summarizeResult,
  displayWidth,
  contentWidth,
} from "../render/theme.js";
import { DiffView } from "./Markdown.js";
import { Spinner } from "./Spinner.js";
import { AUTO_APPROVE_TOOL_MARKER } from "../mode.js";
import type { Block, ToolCall, ViewState, FanoutRow } from "../state.js";
import { statusLine } from "../state.js";

/** Cut a string to at most `max` display columns, appending `…` when it was
 * truncated, so a tool row never overflows the terminal width (§4.4). */
function ellipsize(s: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(s) <= max) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    w += cw;
    out += ch;
  }
  return out + "…";
}

/** The dim `▾/▸ N tool calls` header; collapsed adds ` · M errors` (§4.4). */
function GroupHeader({
  count,
  errors,
  expanded,
  glyphs,
  theme,
}: {
  count: number;
  errors: number;
  expanded: boolean;
  glyphs: Glyphs;
  theme: ThemeTokens;
}): React.ReactElement {
  const caret = expanded ? glyphs.caretDown : glyphs.caretRight;
  const errorTag = !expanded && errors > 0 ? ` · ${errors} error${errors === 1 ? "" : "s"}` : "";
  return (
    <Text {...(theme.dim ? { color: theme.dim } : {})}>
      {caret} {count} tool call{count === 1 ? "" : "s"}{errorTag}
    </Text>
  );
}

/**
 * The single stable dynamic-region status line (§1.4, §4.2). While a turn runs
 * buffered rendering shows ONLY this line below the committed `<Static>`
 * history: a spinner, a verb (`Thinking` before the first token, `Responding`
 * while text buffers, `Reading`/`Searching`/`Fetching`/`Running`/`Saving`/
 * `Editing` + the target during a tool round), the elapsed
 * seconds, and the running token count when known (bare when core-reported,
 * `~`-marked for a char/4 estimate). A `task` fan-out of ≥ 2 workers REPLACES
 * this line with the live fan-out panel (`LiveFanout`, §4.4): `statusLine()`
 * returns null for its duration, so this component renders nothing and the
 * panel's `● Orchestrating (N agents)` header is the only header. Running tool
 * rows are NOT drawn
 * individually. The spinner repaints at most every 120 ms (§4.2); `nowMs` is
 * injectable so a test drives the elapsed clock deterministically.
 */
export function StatusLine({
  state,
  theme,
  reduceMotion,
  nowMs,
}: {
  state: ViewState;
  theme: ThemeTokens;
  reduceMotion: boolean;
  nowMs?: number | undefined;
}): React.ReactElement | null {
  const status = statusLine(state);
  if (!status) return null;
  const now = nowMs ?? Date.now();
  // §4.2/§6.1 — while an approval is pending the line reads `Waiting for
  // approval` with NO spinner animation and a FROZEN elapsed (the time up to the
  // prompt, not a ticking counter), so the user is not pressured by a running
  // clock while they decide. No running token count is shown for it.
  if (state.approvalPending) {
    const frozen =
      state.approvalStartedAt && state.turnStartedAt
        ? Math.max(0, (state.approvalStartedAt - state.turnStartedAt) / 1000)
        : 0;
    const waited = frozen >= 0.1 ? ` · waiting ${(Math.round(frozen * 10) / 10).toFixed(1)}s` : "";
    return (
      <Text {...(theme.dim ? { color: theme.dim } : {})}>
        {"  "}
        {sanitize(`${status.verb}${waited}`)}
      </Text>
    );
  }
  const elapsed = state.turnStartedAt ? Math.max(0, (now - state.turnStartedAt) / 1000) : 0;
  const elapsedStr = elapsed < 0.1 ? "<0.1s" : `${(Math.round(elapsed * 10) / 10).toFixed(1)}s`;
  const tokenStr =
    state.tokenCount > 0 ? ` · ${state.tokenCountEstimated ? "~" : ""}${state.tokenCount} tokens` : "";
  const hint = status.hint ? ` · ${status.hint}` : "";
  const body = `${status.verb} · ${elapsedStr}${tokenStr}${hint}`;
  if (reduceMotion) {
    return (
      <Text {...(theme.dim ? { color: theme.dim } : {})}>
        {"  "}
        {sanitize(body)}
      </Text>
    );
  }
  return (
    <Text>
      {"  "}
      <Spinner color={theme.warning} />{" "}
      <Text {...(theme.dim ? { color: theme.dim } : {})}>{sanitize(body)}</Text>
    </Text>
  );
}

/** One committed call row: `● <Label> <short arg>  <detail>  <dur>` on a single
 * line, detail dim appended only when it fits, duration dim only when ≥ 1 s;
 * a failed call keeps its red `✗` and one-line error (§4.4, §4.7). */
function CallRow({
  call,
  theme,
  glyphs,
  showDetails,
  columns,
}: {
  call: ToolCall;
  theme: ThemeTokens;
  glyphs: Glyphs;
  showDetails?: boolean | undefined;
  columns: number;
}): React.ReactElement {
  const ok = call.status === "success";
  const color = toolColor(call.name, theme);
  const glyph = ok ? glyphs.dot : glyphs.failure;
  const glyphColor = ok ? color : theme.error;
  const label = toolDisplayName(call.name);
  const arg = showDetails ? fullArgs(call.args) : shortenArg(call.name, call.args);
  const detail = ok ? summarizeResult(call.name, call.summary) : firstLine(call.summary);
  // The row budget is the content width (`columns - 4`: a 2-column left margin
  // — the group's one-space indent plus one more under the header, §4.4 — and a
  // 2-column right padding) less the glyph + its trailing space (`● `) and the
  // auto-approve marker, so a committed tool row never exceeds `columns - 2`.
  const markerW = call.autoApprove ? displayWidth(`${AUTO_APPROVE_TOOL_MARKER} `) : 0;
  const dur = call.durationMs >= 1000 ? `${(call.durationMs / 1000).toFixed(1)}s` : "";
  const budget = Math.max(1, contentWidth(columns) - displayWidth(`${glyph} `) - markerW);
  // Label + arg, ellipsized to the budget less the trailing duration (§4.4).
  const durW = dur ? displayWidth(`  ${dur}`) : 0;
  const head = arg ? `${label}  ${sanitize(arg)}` : label;
  let line = head;
  // Append the detail dim on the same line only when it still fits (§4.4).
  const detailStr = detail ? `  ${sanitize(detail)}` : "";
  if (ok && detailStr && displayWidth(head + detailStr) + durW <= budget) {
    line = head + detailStr;
  }
  line = ellipsize(line, Math.max(1, budget - durW));
  return (
    <Box flexDirection="column">
      <Box>
        <Text {...(glyphColor ? { color: glyphColor } : {})}>{glyph} </Text>
        {call.autoApprove ? (
          <Text bold {...(theme.error ? { color: theme.error } : {})}>{AUTO_APPROVE_TOOL_MARKER} </Text>
        ) : null}
        <Text bold>{line.slice(0, label.length)}</Text>
        <Text {...(color ? { color } : {})}>{line.slice(label.length)}</Text>
        {dur ? <Text {...(theme.dim ? { color: theme.dim } : {})}>{"  "}{dur}</Text> : null}
      </Box>
      {!ok ? (
        <Box paddingLeft={2}>
          <Text {...(theme.error ? { color: theme.error } : {})}>{glyphs.failure} {sanitize(firstLine(call.summary))}</Text>
        </Box>
      ) : null}
      {call.diff ? <DiffView diff={call.diff} theme={theme} /> : null}
    </Box>
  );
}

/** A grouped set of committed tool calls under the dim `▾/▸ N tool calls`
 * header (§4.4). A fan-out `task` dispatch of ≥ 2 workers collapses to one
 * `● Orchestrated (N agents)` row (§4.4). Collapsed by default on a completed
 * turn; a group with any errored call stays expanded so the failure is never
 * hidden behind the header (§4.4). */
export function ToolGroup({
  block,
  glyphs,
  theme,
  showDetails,
  expanded,
  columns = 80,
}: {
  block: Extract<Block, { kind: "toolgroup" }>;
  glyphs: Glyphs;
  theme: ThemeTokens;
  showDetails?: boolean | undefined;
  expanded?: boolean | undefined;
  columns?: number | undefined;
}): React.ReactElement {
  const calls = block.calls;
  const errors = calls.filter((c) => c.status !== "success").length;
  // An errored group never collapses (§4.4).
  const open = errors > 0 || (expanded ?? false);
  return (
    <Box flexDirection="column">
      <GroupHeader count={calls.length} errors={errors} expanded={open} glyphs={glyphs} theme={theme} />
      {open
        ? calls.map((call) => (
            <Box key={call.id} paddingLeft={1}>
              <CallRow call={call} theme={theme} glyphs={glyphs} showDetails={showDetails} columns={columns} />
            </Box>
          ))
        : null}
    </Box>
  );
}

/** The first non-empty line of a raw result, truncated — used for an error row
 * so a multi-line tool error never dumps into the feed (§4.4, §4.7). */
function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 200 ? line.slice(0, 199) + "…" : line;
}

/** The per-worker duration shown on a committed fan-out row (§4.4): the elapsed
 * from the worker's start event to its finish event, shown only when ≥ 1 s. */
function fanoutDuration(row: FanoutRow): string {
  if (row.startedAt === undefined || row.finishedAt === undefined) return "";
  const ms = row.finishedAt - row.startedAt;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : "";
}

/** §4.4 — the row's state glyph and its colour. A `●` running/dispatched in the
 * orchestrate colour, a green `✓`… — here `●` tool colour for live/done, red
 * `✗` for failed, gray `○` for waiting/skipped/cancelled. */
function fanoutGlyph(status: string, glyphs: Glyphs, theme: ThemeTokens): { glyph: string; color: string | undefined } {
  if (status === "failed") return { glyph: glyphs.failure, color: theme.error };
  if (status === "waiting" || status === "dispatched" || status === "skipped" || status === "cancelled") {
    return { glyph: glyphs.pending, color: theme.dim };
  }
  // `running` / `done` → the solid dot in the orchestrate (accent) colour.
  return { glyph: glyphs.dot, color: theme.accent };
}

/** §4.4 — the human live state shown at the end of a row. `Waiting` for an
 * unmet-dependency row, `Completed` for a done worker, the current tool's
 * display name (§4.4 map) while it runs, or `<ToolName> ⚠ tool approval needed`
 * when the worker has a pending plain approval; a committed row shows its final
 * `done`/`failed`/`skipped`/`cancelled` word with a dim duration. */
function fanoutLiveState(row: FanoutRow, approvalTool: string | undefined): string {
  if (approvalTool !== undefined) return `${toolDisplayName(approvalTool)} ⚠ tool approval needed`;
  switch (row.status) {
    case "waiting":
    case "dispatched":
      return "Waiting";
    case "done":
      return "Completed";
    case "running":
      return row.tool ? toolDisplayName(row.tool) : "Running";
    default:
      // A committed/terminal row: the final word, with a dim duration appended
      // by the caller.
      return row.status;
  }
}

/** One fan-out row (§4.4): the state glyph, then `<name padded> <role> <live
 * state>`. `<name>` is the batch task id/short title padded to the widest name
 * in the batch; `<role>` the worker role. The whole row is clamped to the
 * content width; the SELECTED row is shown bold + underlined. A `failed` row
 * shows its one-line reason on an indented line beneath. */
function FanoutRowView({
  row,
  theme,
  glyphs,
  columns,
  nameWidth,
  selected,
  approvalTool,
  committed,
  gutter,
}: {
  row: FanoutRow;
  theme: ThemeTokens;
  glyphs: Glyphs;
  columns: number;
  nameWidth: number;
  selected?: boolean | undefined;
  approvalTool?: string | undefined;
  committed?: boolean | undefined;
  gutter?: boolean | undefined;
}): React.ReactElement {
  const { glyph, color } = fanoutGlyph(row.status, glyphs, theme);
  const dur = committed ? fanoutDuration(row) : "";
  const live = fanoutLiveState(row, approvalTool);
  const statusTail = dur ? `${live} · ${dur}` : live;
  const gutterW = gutter ? displayWidth("│ ") : 0;
  // Budget: content width less the gutter bar (`│ `, live only) and the glyph.
  const budget = Math.max(1, contentWidth(columns) - gutterW - displayWidth(`${glyph} `));
  const name = sanitize(row.title);
  const padded = name + " ".repeat(Math.max(0, nameWidth - displayWidth(name)));
  const body = ellipsize(`${padded}  ${sanitize(row.worker)}  ${statusTail}`, budget);
  return (
    <Box flexDirection="column">
      <Box>
        {gutter ? <Text {...(theme.accent ? { color: theme.accent } : {})}>{"│ "}</Text> : null}
        <Text {...(color ? { color } : {})}>{glyph} </Text>
        <Text {...(selected ? { bold: true, underline: true } : {})}>{body}</Text>
      </Box>
      {row.status === "failed" && row.reason ? (
        <Box paddingLeft={gutter ? 0 : 2}>
          {gutter ? <Text {...(theme.accent ? { color: theme.accent } : {})}>{"│ "}</Text> : null}
          <Text {...(theme.error ? { color: theme.error } : {})}>{sanitize(firstLine(row.reason))}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** The widest `<name>` (the row title) across the batch, so every row's name
 * column aligns (§4.4). */
function fanoutNameWidth(rows: FanoutRow[]): number {
  return Math.max(0, ...rows.map((r) => displayWidth(sanitize(r.title))));
}

/** A committed fan-out orchestration (§4.4): the `● Orchestrated (N agents)`
 * header (the `●` a static marker in the orchestrate colour) over one row per
 * worker, capped at 8 rows, each carrying a dim duration. A fan-out with any
 * `failed` row stays EXPANDED; a collapsed group shows only the header. */
export function FanoutGroup({
  block,
  glyphs,
  theme,
  columns = 80,
}: {
  block: Extract<Block, { kind: "fanout" }>;
  glyphs: Glyphs;
  theme: ThemeTokens;
  columns?: number | undefined;
}): React.ReactElement {
  const hasFailure = block.rows.some((r) => r.status === "failed");
  const open = hasFailure || !block.collapsed;
  const rows = block.rows.slice(0, 8);
  const nameWidth = fanoutNameWidth(rows);
  return (
    <Box flexDirection="column">
      <Text {...(theme.accent ? { color: theme.accent } : {})}>
        {glyphs.dot} Orchestrated ({block.agents} agents)
      </Text>
      {open
        ? rows.map((row, i) => (
            <Box key={row.taskId ?? `${row.worker}-${i}`}>
              <FanoutRowView row={row} theme={theme} glyphs={glyphs} columns={columns} nameWidth={nameWidth} committed />
            </Box>
          ))
        : null}
      {open ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>ctrl+g open agent monitor</Text>
      ) : null}
    </Box>
  );
}

/** The LIVE fan-out panel beneath the status line while a fan-out runs (§4.4):
 * the `● Orchestrating (N agents)` header (a static marker, never a spinner),
 * two dim hint lines, a coloured left gutter bar, and one aligned
 * `<name> <role> <live state>` row per worker. The selected row is highlighted
 * + underlined; a worker with a pending plain approval shows
 * `<ToolName> ⚠ tool approval needed`. Rows repaint only when a worker changes
 * state or the selection moves (the reducer keeps row objects stable). Capped at
 * 8 rows. Returns null when no fan-out of ≥ 2 workers is running. */
export function LiveFanout({
  state,
  theme,
  glyphs,
  columns = 80,
  workerApprovals,
}: {
  state: ViewState;
  theme: ThemeTokens;
  glyphs: Glyphs;
  columns?: number | undefined;
  /** Pending worker approvals (plain asks), keyed by `workerId`, so a row shows
   * `<ToolName> ⚠ tool approval needed` (§4.4/§6.2). */
  workerApprovals?: ReadonlyArray<{ workerId?: string | undefined; tool: string }> | undefined;
}): React.ReactElement | null {
  const fanout = state.fanout;
  if (!fanout || fanout.rows.length < 2) return null;
  const rows = fanout.rows.slice(0, 8);
  const nameWidth = fanoutNameWidth(rows);
  const approvalFor = (row: FanoutRow): string | undefined => {
    if (!workerApprovals || workerApprovals.length === 0) return undefined;
    const wid = (row as FanoutRow & { workerId?: string }).workerId;
    if (wid === undefined) return undefined;
    return workerApprovals.find((a) => a.workerId === wid)?.tool;
  };
  return (
    <Box flexDirection="column">
      <Text {...(theme.accent ? { color: theme.accent } : {})}>
        {glyphs.dot} Orchestrating ({fanout.agents} agents)
      </Text>
      <Text {...(theme.dim ? { color: theme.dim } : {})}>esc to cancel</Text>
      <Text {...(theme.dim ? { color: theme.dim } : {})}>ctrl+d/u navigate · ctrl+g open agent monitor</Text>
      {rows.map((row, i) => (
        <Box key={row.taskId ?? `${row.worker}-${i}`}>
          <FanoutRowView
            row={row}
            theme={theme}
            glyphs={glyphs}
            columns={columns}
            nameWidth={nameWidth}
            selected={i === fanout.selected}
            approvalTool={approvalFor(row)}
            gutter
          />
        </Box>
      ))}
    </Box>
  );
}

/** The committed `Thought for Ns` lead line on an assistant block that had
 * reasoning (§4.6). Dim, with a `(ctrl+o to view)` hint; the accumulated
 * reasoning is transient and never persisted, so the committed block shows only
 * this lead line. */
export function ThoughtLine({
  thoughtMs,
  theme,
}: {
  thoughtMs: number;
  theme: ThemeTokens;
}): React.ReactElement {
  const seconds = Math.max(1, Math.round(thoughtMs / 1000));
  return (
    <Text {...(theme.dim ? { color: theme.dim } : {})}>
      Thought for {seconds}s   (ctrl+o to view)
    </Text>
  );
}

/** The collapsed/expanded reasoning view for the live turn (§4.6): a dim
 * `Thought for Ns` lead line, the accumulated reasoning shown as dim text
 * indented two spaces (no connector) when expanded (Ctrl+O), collapsed by
 * default. */
export function ReasoningView({
  reasoning,
  expanded,
  theme,
  thoughtMs,
}: {
  reasoning: string;
  expanded: boolean;
  theme: ThemeTokens;
  thoughtMs?: number | undefined;
}): React.ReactElement {
  const seconds = thoughtMs && thoughtMs > 0 ? Math.max(1, Math.round(thoughtMs / 1000)) : 0;
  const lead = seconds > 0 ? `Thought for ${seconds}s` : "Thinking…";
  if (!expanded) {
    return (
      <Text {...(theme.dim ? { color: theme.dim } : {})}>
        {lead}   (ctrl+o to view)
      </Text>
    );
  }
  const lines = sanitize(reasoning).split("\n");
  const tail = lines.slice(-12);
  const earlier = lines.length - tail.length;
  return (
    <Box flexDirection="column">
      <Text {...(theme.dim ? { color: theme.dim } : {})}>{lead}   (ctrl+o to hide)</Text>
      {earlier > 0 ? (
        <Box paddingLeft={2}>
          <Text {...(theme.dim ? { color: theme.dim } : {})}>… ({earlier} earlier lines)</Text>
        </Box>
      ) : null}
      {tail.map((line, i) => (
        <Box key={i} paddingLeft={2}>
          <Text {...(theme.dim ? { color: theme.dim } : {})}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
