import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingApproval, ApprovalResponse } from "@voidrift/core";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { sanitize, contentWidth, wrapPrefixed, displayWidth } from "../render/theme.js";
import { DiffView } from "./Markdown.js";

/** The most rows of the full command/value the dialog renders inline before it
 * shows `… N more lines` and defers the rest to the `v` reveal (§6.1). */
const MAX_VALUE_ROWS = 12;
/** The most inferred patterns shown, each on ONE row (§6.1). */
const MAX_PATTERN_ROWS = 3;

/** The one value a shell/file/url action centers on — the whole command, path,
 * or url — shown in full (wrapped) rather than the old 60-char slice (§6.1). */
function primaryValue(request: PendingApproval): { key: string; value: string } | null {
  const a = request.args;
  for (const key of ["command", "path", "url", "query"]) {
    if (typeof a[key] === "string" && a[key] !== "") return { key, value: String(a[key]) };
  }
  return null;
}

/** Cut a single row to `width` display columns, appending `…` when truncated. */
function ellipsizeRow(s: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(s) <= width) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    w += cw;
    out += ch;
  }
  return out + "…";
}

/**
 * The single-action approval dialog (§6.1, Slice C3 / D2a). Shows the full
 * action READABLY: the tool name and, for a shell/file/url action, the WHOLE
 * command/value wrapped to the content width and sanitized — capped at 12 rows
 * with a dim `… N more lines` and a `v` key that prints the full text into the
 * transcript, so a long one-liner (a 20-line `node -e` script) is never
 * truncated to one opaque slice. The `patterns:` line shows at most three
 * inferred patterns, each cut to one row. For a COMPOUND shell command the
 * classified `segments` are listed one per row with an `ok`/`ask` mark so the
 * user sees which piece is actually asking; when the first inferred pattern
 * covers only a different segment a dim `covers \`<word>\` only` note is added.
 * The four choices (§9.5): `y` approve once, `s` session, `p` project, `n`
 * reject (`Escape` also rejects); `e` edit when offered; `v` reveal. A plain
 * policy ask and a REMEMBERABLE force-ask both show all four; a non-rememberable
 * force-ask shows only `y`/`n` and "This kind of action is always asked."
 * Everything shown passes `sanitize`; secrets already masked by the core stay
 * masked. Resolves via `onResolve` with the closed `ApprovalResponse`.
 */
export function ConfirmationDialog({
  request,
  onResolve,
  theme,
  glyphs,
  columns,
  onReveal,
  autoDenySeconds,
}: {
  request: PendingApproval;
  onResolve: (response: ApprovalResponse) => void;
  theme: ThemeTokens;
  glyphs: Glyphs;
  /** The terminal width, so the full value wraps to the content width (§4.1).
   * Defaults to 80 for tests/hosts that do not pass it. */
  columns?: number | undefined;
  /** Print the full command/value into the transcript when the user presses `v`
   * (§6.1). Absent → the `v` key is inert and not advertised. */
  onReveal?: ((text: string) => void) | undefined;
  /**
   * The unattended-approval countdown in seconds (`limits.approval.autoDenySeconds`,
   * §9.5). When greater than 0 and interactive, the dialog shows `auto-deny in Ns`
   * counting down once a second and, at expiry, resolves as REJECT (deny-and-continue,
   * the same fail-closed outcome as pressing `n`) so an unattended prompt never blocks
   * forever. The core records the reject in the permission trail. `0` or absent → no
   * countdown; the dialog waits for a human. NEVER wired in a headless run (which never
   * reaches a dialog). */
  autoDenySeconds?: number | undefined;
}): React.ReactElement {
  const patterns = request.inferredPatterns ?? [];
  const segments = request.segments ?? [];
  const rememberable = request.rememberable === true;
  const exactOnly = request.exactOnly === true;
  const forceAsk = request.forceAskKind !== undefined;
  const width = contentWidth(columns);
  const primary = primaryValue(request);
  // Latch: the first keypress resolves; every later keypress is a no-op. The
  // Ink input handler can fire twice before the parent unmounts the dialog, so
  // guard with a ref to send exactly one response (§9.5).
  const decidedRef = React.useRef(false);
  const resolveOnce = (response: ApprovalResponse): void => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onResolve(response);
  };

  // §9.5 — the unattended-approval countdown. When `autoDenySeconds > 0`, the
  // dialog shows `auto-deny in Ns` and ticks down once a second; at 0 it resolves
  // as REJECT (deny-and-continue, the fail-closed outcome). The latch in
  // `resolveOnce` means a human keypress before expiry wins and the timer becomes
  // inert. The interval is cleared on unmount and on the first decision.
  const countdownEnabled = typeof autoDenySeconds === "number" && autoDenySeconds > 0;
  const [remaining, setRemaining] = React.useState<number>(countdownEnabled ? autoDenySeconds! : 0);
  const remainingRef = React.useRef<number>(countdownEnabled ? autoDenySeconds! : 0);
  React.useEffect(() => {
    if (!countdownEnabled) return;
    const id = setInterval(() => {
      remainingRef.current -= 1;
      setRemaining(remainingRef.current);
      if (remainingRef.current <= 0) {
        clearInterval(id);
        resolveOnce({ requestId: request.id, decision: "reject" });
      }
    }, 1000);
    return () => clearInterval(id);
    // The timer is armed once for the life of a given request; a new request
    // remounts the dialog with a fresh latch and counter.
  }, [countdownEnabled, request.id]);
  // The suggestion the core will build the persisted rule from: the first
  // inferred pattern it attached (or, with none, the tool name). The core
  // re-validates whatever the host sends, so a host can only ever offer one of
  // the core's own suggestions here.
  const chosenPattern = patterns.length > 0 ? patterns[0]! : undefined;

  // The exact entry that would be saved, shown BEFORE the user chooses (§9.2).
  // Mirrors the rule the core builds: a tool-name glob for a tool with no value
  // to match, else a `{tool, pattern}` command/path rule. Masked via `sanitize`.
  const savePreview = buildSavePreview(request.tool, chosenPattern, exactOnly);

  // The full value wrapped to the content width, sanitized, then capped at 12
  // rows (§6.1). `v` prints the untruncated text into the transcript.
  const fullValue = primary ? sanitize(primary.value) : "";
  const canReveal = Boolean(onReveal) && primary !== null;
  const allRows = fullValue !== "" ? wrapPrefixed(fullValue, width, 0) : [];
  const shownRows = allRows.slice(0, MAX_VALUE_ROWS);
  const moreRows = allRows.length - shownRows.length;

  // `covers \`<word>\` only` — the first inferred pattern covers only a segment
  // OTHER than the one asking. The asking segment is the first `ask` segment;
  // the covering word is the first token of the first inferred pattern. When the
  // pattern's head word is not the asking segment's head word, note it (§6.1).
  const coversNote = coversOnlyNote(patterns, segments);

  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (key.escape || ch === "r" || ch === "n") {
      resolveOnce({ requestId: request.id, decision: "reject" });
    } else if (ch === "y" || ch === "a") {
      resolveOnce({ requestId: request.id, decision: "approve" });
    } else if (ch === "v" && canReveal) {
      // Reveal is NOT a decision: it prints the full value into the transcript
      // and leaves the dialog open (no latch) so the user still decides.
      onReveal!(`${primary!.key}: ${fullValue}`);
    } else if (ch === "e" && request.choices.includes("edit")) {
      // Edit opens the editor (§3.8); Slice A returns the args unchanged.
      resolveOnce({ requestId: request.id, decision: "edit", editedArgs: request.args });
    } else if (ch === "s" && rememberable) {
      resolveOnce({
        requestId: request.id,
        decision: "approve",
        remember: "session",
        ...(chosenPattern ? { chosenPattern } : {}),
      });
    } else if (ch === "p" && rememberable) {
      resolveOnce({
        requestId: request.id,
        decision: "approve",
        remember: "project",
        ...(chosenPattern ? { chosenPattern } : {}),
      });
    }
  });

  const choiceLabels: string[] = ["[y]es (once)"];
  if (request.choices.includes("edit")) choiceLabels.push("[e]dit");
  if (rememberable) {
    choiceLabels.push("[s]ession");
    choiceLabels.push("[p]roject");
  }
  if (canReveal && moreRows > 0) choiceLabels.push("[v]iew full");
  choiceLabels.push("[n]o");

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} {...(theme.warning ? { borderColor: theme.warning } : {})}>
      <Text bold {...(theme.warning ? { color: theme.warning } : {})}>
        {glyphs.warn} Tool requires approval
      </Text>
      <Text bold>{sanitize(request.tool)}</Text>
      {/* The full command/value, wrapped and capped; a non-primary tool shows
          its short args as before. */}
      {primary ? (
        <Box flexDirection="column" paddingLeft={1}>
          {shownRows.map((row, i) => (
            <Text key={i}>{i === 0 ? `${primary.key}: ` : "  "}{row}</Text>
          ))}
          {moreRows > 0 ? (
            <Text {...(theme.dim ? { color: theme.dim } : {})}>… {moreRows} more line{moreRows === 1 ? "" : "s"}</Text>
          ) : null}
        </Box>
      ) : (
        <Text>
          {Object.entries(request.args)
            .map(([k, v]) => `${k}: ${sanitize(String(v)).slice(0, 60)}`)
            .join("  ")}
        </Text>
      )}
      {/* Compound-command segments, one per row with an ok/ask mark (§6.1). */}
      {segments.length > 0 ? (
        <Box flexDirection="column" paddingLeft={1}>
          {segments.map((s, i) => (
            <Text key={i} {...(s.decision === "ask" ? (theme.warning ? { color: theme.warning } : {}) : theme.dim ? { color: theme.dim } : {})}>
              {s.decision === "ask" ? "ask" : "ok "} {ellipsizeRow(sanitize(s.text), Math.max(1, width - 4))}
            </Text>
          ))}
        </Box>
      ) : null}
      {request.forceAskKind === "outside-workspace" ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>
          This command touches paths outside the workspace.
        </Text>
      ) : null}
      {patterns.length > 0 ? (
        <Box flexDirection="column">
          <Text {...(theme.dim ? { color: theme.dim } : {})}>patterns:</Text>
          {patterns.slice(0, MAX_PATTERN_ROWS).map((p, i) => (
            <Text key={i} {...(theme.dim ? { color: theme.dim } : {})}>
              {"  "}{ellipsizeRow(sanitize(p), Math.max(1, width - 2))}
            </Text>
          ))}
        </Box>
      ) : null}
      {coversNote ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>{coversNote}</Text>
      ) : null}
      {rememberable ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>
          will save to .voidrift/config.json: {sanitize(savePreview)}
        </Text>
      ) : null}
      {exactOnly ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>{exactOnlyNote(request.forceAskKind, request.tool)}</Text>
      ) : null}
      {forceAsk && !rememberable ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>This kind of action is always asked.</Text>
      ) : null}
      {request.diff ? <DiffView diff={request.diff} theme={theme} maxLines={8} /> : null}
      {countdownEnabled ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>auto-deny in {remaining}s</Text>
      ) : null}
      <Text {...(theme.dim ? { color: theme.dim } : {})}>{choiceLabels.join("  ")}</Text>
    </Box>
  );
}

/** The dim `covers \`<word>\` only` note (§6.1): when the first inferred pattern
 * (the one a save would persist) matches only a segment OTHER than the asking
 * one, name the word it covers so the user understands a save would not cover
 * the piece that is actually asking. Returns null when there is nothing to warn
 * about (no segments, no ask segment, or the pattern already covers it). */
function coversOnlyNote(
  patterns: string[],
  segments: { text: string; decision: "ask" | "ok" }[],
): string | null {
  if (patterns.length === 0 || segments.length === 0) return null;
  const asking = segments.find((s) => s.decision === "ask");
  if (!asking) return null;
  const headOf = (s: string): string => sanitize(s.trim().split(/\s+/)[0] ?? "");
  const patternHead = headOf(patterns[0]!);
  const askingHead = headOf(asking.text);
  if (patternHead === "" || patternHead === askingHead) return null;
  return `covers \`${patternHead}\` only`;
}

/** The exact persisted-rule JSON the core would build, for the preview line. */
function buildSavePreview(tool: string, chosenPattern: string | undefined, exactOnly = false): string {
  // A tool-name glob (an MCP `mcp_*` or a plugin tool's name) carries no
  // `pattern`; a command/path/url rule carries the chosen pattern. An exact
  // force-ask lift (owner D2a) carries `exact: true` with the literal value. The
  // preview is best-effort display only — the core is the authority on the rule.
  const isToolNameRule =
    !exactOnly && chosenPattern !== undefined && (tool.startsWith("mcp_") || chosenPattern === tool);
  const rule =
    chosenPattern === undefined
      ? { tool, decision: "allow", priority: 0, source: "workspace" }
      : isToolNameRule
        ? { tool: chosenPattern, decision: "allow", priority: 0, source: "workspace" }
        : {
            tool,
            pattern: chosenPattern,
            ...(exactOnly ? { exact: true } : {}),
            decision: "allow",
            priority: 0,
            source: "workspace",
          };
  return JSON.stringify(rule);
}

/** The exact-only save note, adapted by force-ask family (owner D2a). A
 * `control-file` lift derives its wording from the TOOL: a file tool saves for
 * this exact FILE, a shell command for this exact COMMAND. */
function exactOnlyNote(kind: PendingApproval["forceAskKind"], tool?: string): string {
  if (kind === "ssrf") return "Saved for this exact host only.";
  if (kind === "plugin-install") return "Saved for this exact package version only.";
  if (kind === "control-file" && (tool === "write_file" || tool === "edit_file")) {
    return "Saved for this exact file only.";
  }
  return "Saved as this exact command only.";
}
