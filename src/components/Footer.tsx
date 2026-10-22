import React from "react";
import { Box, Text } from "ink";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { BANNER, welcomeShowsFullBanner, sanitize } from "../render/theme.js";
import { agentLabel, isAllowPosture, type TopAgent } from "../mode.js";
import type { ViewState } from "../state.js";

/** The context-meter color banded by occupancy (§5.3): <50 green, 50–<80
 * yellow, ≥80 red; a crossed level may raise the band early. */
function meterColor(percentage: number, level: string, theme: ThemeTokens): string | undefined {
  if (level === "overflow") return theme.error;
  if (level === "safety_net") return theme.warning;
  if (percentage >= 80) return theme.error;
  if (percentage >= 50) return theme.warning;
  if (level === "notice" || level === "compaction") return theme.warning;
  return theme.success;
}

/** Home-shorten an absolute path to `~/…` (§5.2). */
function shortenPath(p: string): string {
  const home = process.env["HOME"] ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** Visible length of the left status segment (plain text, no color) so the
 * right segment can be truncated to the remaining width at narrow terminals. */
function leftSegmentLength(state: ViewState, bracket: string, glyphs: Glyphs): number {
  let s = `[${bracket}] voidrift · ${state.model || "no model"} · ${glyphs.meter} ${state.contextPercentage}%`;
  if (state.runningTasks > 0) s += ` · ${glyphs.tasks} ${state.runningTasks}`;
  return s.length;
}

/** Head-elide a path to fit `max` columns, keeping the tail (the useful end). */
function elidePath(p: string, max: number): string {
  if (max <= 1) return "";
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - (max - 1));
}

/**
 * The two-line status bar: a full-width dim rule, then `[Mode] voidrift · model
 * · ◎ ctx% · ⟳ n` left and `cwd · branch` right (§5.2). Assembled entirely from
 * events and DTOs; the CLI computes nothing.
 */
export function StatusBar({
  state,
  topAgents,
  workspaceRoot,
  width,
  theme,
  glyphs,
}: {
  state: ViewState;
  /** The top-level agents from `agents.list()` (§5.2): the active one supplies
   * the bracket label and whether its `unlisted` is `allow` (bold-red). */
  topAgents?: readonly TopAgent[];
  workspaceRoot: string;
  width: number;
  theme: ThemeTokens;
  glyphs: Glyphs;
}): React.ReactElement {
  const agents = topAgents ?? [];
  const active = agents.find((a) => a.name === state.mode);
  const bracket = agentLabel(active, state.mode);
  // The bold-red bracket is keyed on the active agent's `unlisted: allow`
  // posture, determined from `agents.list()` — NOT from a name (§5.2).
  const allow = isAllowPosture(active);
  const pctColor = meterColor(state.contextPercentage, state.contextLevel, theme);
  const cwdFull = shortenPath(sanitize(workspaceRoot));
  const modelLabel = sanitize(state.model || "no model");
  // Keep the status line to one row at narrow widths (§5.2): the left identity
  // segment is fixed; the right location segment is truncated to the remaining
  // columns (branch dropped first, then the path head-elided) so it never wraps
  // and the cwd stays right-aligned.
  const leftLen = leftSegmentLength({ ...state, model: modelLabel }, bracket, glyphs);
  const branchText = sanitize(state.branch ?? "");
  const rightBudget = Math.max(0, width - leftLen - 1); // 1-col minimum gap
  const branchCost = branchText ? branchText.length + 3 : 0; // " · " + branch
  const showBranch = branchText !== "" && rightBudget >= branchCost + 3;
  const cwdBudget = showBranch ? rightBudget - branchCost : rightBudget;
  const cwd = elidePath(cwdFull, cwdBudget);
  // §5.2 NO_COLOR-safe fallback: with a colour theme the allow bracket is bold
  // red; with NO_COLOR (theme.error undefined) it is bold + inverse so it still
  // stands out without any colour.
  const bracketProps = allow
    ? theme.error
      ? { bold: true as const, color: theme.error }
      : { bold: true as const, inverse: true as const }
    : theme.brand
      ? { color: theme.brand }
      : {};
  return (
    <Box flexDirection="column">
      <Text {...(theme.dim ? { color: theme.dim } : {})}>{"─".repeat(Math.max(1, width))}</Text>
      <Box justifyContent="space-between">
        <Box>
          <Text {...bracketProps}>[{bracket}]</Text>
          <Text> voidrift</Text>
          <Text {...(theme.dim ? { color: theme.dim } : {})}> · </Text>
          <Text>{modelLabel}</Text>
          <Text {...(theme.dim ? { color: theme.dim } : {})}> · </Text>
          <Text {...(pctColor ? { color: pctColor } : {})}>
            {glyphs.meter} {state.contextPercentage}%
          </Text>
          {state.runningTasks > 0 ? (
            <>
              <Text {...(theme.dim ? { color: theme.dim } : {})}> · </Text>
              <Text {...(theme.memory ? { color: theme.memory } : {})}>
                {glyphs.tasks} {state.runningTasks}
              </Text>
            </>
          ) : null}
        </Box>
        <Box>
          {cwd ? <Text {...(theme.info ? { color: theme.info } : {})}>{cwd}</Text> : null}
          {showBranch ? (
            <>
              <Text {...(theme.dim ? { color: theme.dim } : {})}> · </Text>
              <Text {...(theme.branchColor ? { color: theme.branchColor } : {})}>{branchText}</Text>
            </>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

/** The welcome block: block-letter banner + identity + hint (§5.1). */
export function Welcome({
  version,
  workspaceRoot,
  branch,
  sessionId,
  showTips,
  columns,
  theme,
}: {
  version: string;
  workspaceRoot: string;
  model?: string;
  agent?: string | undefined;
  sessionName?: string;
  sessionId: string;
  branch?: string | null;
  showTips: boolean;
  /** Terminal width; below the banner width a compact wordmark is used (§5.1). */
  columns?: number;
  theme: ThemeTokens;
  glyphs?: Glyphs;
}): React.ReactElement {
  // The block-letter banner needs the banner width plus the identity column
  // beside it; a narrower terminal would wrap it mid-glyph-row, so fall back to
  // a compact plain wordmark when the terminal cannot fit the full layout
  // (§5.1). The threshold is derived in the theme (no magic number).
  const narrow = !welcomeShowsFullBanner(columns);
  const safeVersion = sanitize(version);
  const safeWorkspace = sanitize(workspaceRoot);
  const safeBranch = branch ? sanitize(branch) : branch;
  const safeSessionId = sanitize(sessionId);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {narrow ? (
        <Text>
          <Text bold {...(theme.accent ? { color: theme.accent } : {})}>
            VoidRift
          </Text>
          <Text {...(theme.dim ? { color: theme.dim } : {})}> {safeVersion} · Local-first AI harness</Text>
        </Text>
      ) : (
        <Box>
          <Box flexDirection="column">
            {BANNER.map((line, i) => (
              <Text key={i} {...(theme.brand ? { color: theme.brand } : {})}>
                {line}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column" justifyContent="center" marginLeft={2}>
            <Text>
              <Text bold {...(theme.accent ? { color: theme.accent } : {})}>
                VoidRift
              </Text>
              <Text {...(theme.dim ? { color: theme.dim } : {})}> {safeVersion}</Text>
            </Text>
            <Text {...(theme.dim ? { color: theme.dim } : {})}>Local-first AI harness</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        <Text {...(theme.dim ? { color: theme.dim } : {})}>
          {"  "}Workspace{"  "}
          <Text {...(theme.info ? { color: theme.info } : {})}>{safeWorkspace}</Text>
        </Text>
        {safeBranch ? (
          <Text {...(theme.dim ? { color: theme.dim } : {})}>
            {"  "}Branch{"     "}
            <Text {...(theme.branchColor ? { color: theme.branchColor } : {})}>{safeBranch}</Text>
          </Text>
        ) : null}
        <Text {...(theme.dim ? { color: theme.dim } : {})}>
          {"  "}Session{"    "}
          <Text>{safeSessionId}</Text>
        </Text>
      </Box>
      {showTips ? (
        <Box paddingLeft={1} marginTop={1}>
          <Text {...(theme.dim ? { color: theme.dim } : {})}>
            {"  "}Type a message to begin. /help for commands. Shift+Tab to cycle modes.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * The "where you left off" line painted on a resume, AFTER the restored turns
 * and before the live prompt (§5.1): the session summary as the status line, a
 * note of any pending approvals, and a stale-documents warning.
 */
export function ResumeLine({
  summary,
  pendingCount,
  staleDocuments,
  theme,
  glyphs,
}: {
  summary?: string | undefined;
  pendingCount?: number | undefined;
  staleDocuments?: string[] | undefined;
  theme: ThemeTokens;
  glyphs: Glyphs;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {summary ? <Text {...(theme.dim ? { color: theme.dim } : {})}>{sanitize(summary)}</Text> : null}
      {pendingCount && pendingCount > 0 ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>
          {glyphs.warn} {pendingCount} pending approval(s)
        </Text>
      ) : null}
      {staleDocuments && staleDocuments.length > 0 ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>
          {glyphs.warn} {staleDocuments.length} documents changed since you left
        </Text>
      ) : null}
    </Box>
  );
}
