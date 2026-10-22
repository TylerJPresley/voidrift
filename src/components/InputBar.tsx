import React from "react";
import { Box, Text, useInput } from "ink";
import type { ThemeTokens } from "../render/theme.js";
import { sanitize } from "../render/theme.js";
import { completeCommands, completeFiles, windowFor, COMMAND_WINDOW, WINDOW, type Candidate } from "../input/autocomplete.js";
import { toVisualLines, cursorToVisual } from "../input/visual-lines.js";

export interface InputBarProps {
  value: string;
  cursor: number;
  active: boolean;
  turnActive: boolean;
  pendingCtrlC: boolean;
  autocompleteOpen: boolean;
  candidates: Candidate[];
  candidateCursor: number;
  /** Terminal width, so a candidate description truncates (never wraps, §3.3). */
  columns: number;
  theme: ThemeTokens;
  placeholder: string;
  /** When set AND the bar is inactive (a panel owns the keyboard, §7.1 pin 7),
   * the prompt row is replaced by this dim notice — never an inviting input. */
  inactiveNotice?: string | undefined;
  /** Commands + files are supplied by the App (one op per Tab, §3.3). */
  onKey: (key: InputKey) => void;
}

/** A normalized key event the App's input controller applies (§3.4). */
export type InputKey =
  | { type: "char"; value: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "up" }
  | { type: "down" }
  | { type: "submit" }
  | { type: "newline" }
  | { type: "tab" }
  | { type: "shift_tab" }
  | { type: "toggle_reasoning" }
  | { type: "toggle_tools" }
  | { type: "open_monitor" }
  | { type: "escape" }
  | { type: "ctrl_c" }
  | { type: "paste_image" }
  | { type: "compose" }
  | { type: "page_up" }
  | { type: "page_down" }
  | { type: "half_page_up" }
  | { type: "half_page_down" }
  | { type: "scroll_bottom" }
  | { type: "autocomplete_select" };

/** The input bar: single-line editor, status, and autocomplete dropdown (§3.1). */
export function InputBar(props: InputBarProps): React.ReactElement {
  const { value, cursor, active, theme, onKey } = props;

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") return onKey({ type: "ctrl_c" });
      // History visual-line navigation (§4.10/§3.4): PageUp/PageDown scroll the
      // committed buffer by a viewport page and `End` returns to the live
      // bottom. Ink flags these keys directly (`pageUp`/`pageDown`/`end`).
      if (key.pageUp) return onKey({ type: "page_up" });
      if (key.pageDown) return onKey({ type: "page_down" });
      // Ctrl+U/Ctrl+D scroll the committed buffer by HALF a viewport page
      // (§4.10/§3.4). `End` returns to the live bottom.
      if (key.ctrl && input === "u") return onKey({ type: "half_page_up" });
      if (key.ctrl && input === "d") return onKey({ type: "half_page_down" });
      if (key.end) return onKey({ type: "scroll_bottom" });
      if (key.escape) return onKey({ type: "escape" });
      if (key.ctrl && input === "o") return onKey({ type: "toggle_reasoning" });
      if (key.ctrl && input === "t") return onKey({ type: "toggle_tools" });
      if (key.ctrl && input === "g") return onKey({ type: "open_monitor" });
      if (key.ctrl && input === "j") return onKey({ type: "newline" });
      if (key.ctrl && input === "v") return onKey({ type: "paste_image" });
      if (key.ctrl && input === "x") return onKey({ type: "compose" });
      if (key.tab && key.shift) return onKey({ type: "shift_tab" });
      if (key.tab) return onKey({ type: "tab" });
      if (key.return) {
        return onKey(props.autocompleteOpen ? { type: "autocomplete_select" } : { type: "submit" });
      }
      if (key.backspace) return onKey({ type: "backspace" });
      if (key.delete) return onKey({ type: "delete" });
      if (key.leftArrow) return onKey({ type: "left" });
      if (key.rightArrow) return onKey({ type: "right" });
      if (key.upArrow) return onKey({ type: "up" });
      if (key.downArrow) return onKey({ type: "down" });
      if (key.ctrl && input === "a") return onKey({ type: "home" });
      if (key.ctrl && input === "e") return onKey({ type: "end" });
      if (input && !key.ctrl && !key.meta) return onKey({ type: "char", value: input });
    },
    { isActive: active },
  );

  const status = props.pendingCtrlC
    ? "press ctrl+c again to exit"
    : props.turnActive
      ? "working… (esc to cancel)"
      : "";

  // The slash dropdown uses an 8-row window, the file dropdown 5 (§3.3). The
  // domain follows the buffer: a `/`-led buffer is slash completion.
  const slashDomain = value.startsWith("/");
  const win = windowFor(props.candidates, props.candidateCursor, slashDomain ? COMMAND_WINDOW : WINDOW);
  const nameWidth = Math.max(0, ...props.candidates.map((c) => c.label.length));

  return (
    <Box flexDirection="column">
      {/* While a turn runs the status line REPLACES the input row entirely
          (§3.1, §5.2): the `❯` prompt and placeholder are not shown at all —
          `working… (esc to cancel)`, or `press ctrl+c again to exit` when a
          first Ctrl+C is pending (§3.9). When idle the input prompt is shown. */}
      {status ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>{status}</Text>
      ) : !active && props.inactiveNotice ? (
        // §7.1 pin 7 — while a panel owns the keyboard the prompt row is replaced
        // by a dim notice, never an inviting input.
        <Text {...(theme.dim ? { color: theme.dim } : {})}>{props.inactiveNotice}</Text>
      ) : (
        <Box flexDirection="column">
          {value === "" ? (
            <Box>
              <Text {...(theme.brand ? { color: theme.brand } : {})}>❯ </Text>
              <Text {...(theme.dim ? { color: theme.dim } : {})}>{props.placeholder}</Text>
            </Box>
          ) : (
            renderBuffer(value, cursor, props.columns, theme)
          )}
        </Box>
      )}
      {props.autocompleteOpen && props.candidates.length > 0 && !props.turnActive && active ? (
        <Box flexDirection="column">
          <Text {...(theme.dim ? { color: theme.dim } : {})}>{"─".repeat(24)}</Text>
          {win.visible.map((c, i) => {
            const globalIndex = win.offset + i;
            const isCursor = globalIndex === props.candidateCursor;
            // Sanitize before render: a plugin/unknown command's label or
            // description must never inject control chars (§3.3 pin 6).
            const name = sanitize(c.label).padEnd(nameWidth);
            // The description is dimmed beside the name and truncated with `…`
            // to the terminal width so a row never wraps (§3.3). Budget =
            // columns − marker(2) − name − gap(2).
            const descBudget = Math.max(0, props.columns - 2 - nameWidth - 2);
            const desc = c.description ? truncate(sanitize(c.description), descBudget) : "";
            return (
              <Box key={c.value}>
                <Text {...(isCursor && theme.brand ? { color: theme.brand } : {})}>{isCursor ? "❯ " : "  "}</Text>
                <Text bold={isCursor} {...(isCursor && theme.brand ? { color: theme.brand } : {})}>
                  {name}
                </Text>
                {desc ? (
                  <Text {...(theme.dim ? { color: theme.dim } : {})}>{"  "}{desc}</Text>
                ) : null}
              </Box>
            );
          })}
          {win.more > 0 ? (
            <Text {...(theme.dim ? { color: theme.dim } : {})}>(+{win.more} more)</Text>
          ) : null}
          <Text {...(theme.dim ? { color: theme.dim } : {})}>
            ↑↓ navigate  enter select  tab complete  esc close
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Re-export the pure matchers so the App builds candidates with one source. */
export { completeCommands, completeFiles };

/** Cut a string to at most `max` columns, appending `…` when truncated, so a
 * dropdown description never wraps the row past the terminal width (§3.3). */
function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;
}

/**
 * Render the buffer as explicit visual lines (§3.1 pin 1), so the wrap the user
 * sees is exactly the wrap navigation uses (`toVisualLines` is the one source of
 * truth for both). The `❯ ` prompt takes two columns on the first row, so the
 * content wraps at `columns - 2`; continuation rows indent two spaces to align.
 * The inverse-video block cursor sits over the code point at `cursor` (a space
 * past the end of a line), placed by the visual (row, col) mapping.
 */
function renderBuffer(
  value: string,
  cursor: number,
  columns: number,
  theme: ThemeTokens,
): React.ReactElement {
  const contentWidth = Math.max(1, columns - 2);
  const lines = toVisualLines(value, contentWidth);
  const pos = cursorToVisual(lines, cursor);
  return (
    <Box flexDirection="column">
      {lines.map((line, row) => {
        const chars = Array.from(line.text);
        const onThisRow = row === pos.row;
        const before = onThisRow ? chars.slice(0, pos.col).join("") : line.text;
        const at = onThisRow ? (chars[pos.col] ?? " ") : "";
        const after = onThisRow ? chars.slice(pos.col + 1).join("") : "";
        return (
          <Box key={row}>
            {row === 0 ? (
              <Text {...(theme.brand ? { color: theme.brand } : {})}>❯ </Text>
            ) : (
              <Text>{"  "}</Text>
            )}
            <Text>
              {sanitize(before)}
              {onThisRow ? <Text inverse>{sanitize(at)}</Text> : null}
              {sanitize(after)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
