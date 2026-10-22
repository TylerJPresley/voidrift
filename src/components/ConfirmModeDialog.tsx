import React from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { ThemeTokens } from "../render/theme.js";
import { confirmDialogText, confirmProvenanceLine, isAllowPosture, type TopAgent } from "../mode.js";

/**
 * The first-entry agent confirmation dialog (cli-blueprint.md §3.5, §6). A
 * client-owned confirmation — NOT a core `PendingApproval` — shown the FIRST
 * time a session would enter a `confirm: true` top-level agent. `y` enables it
 * (the App calls `session.setMode(name, { confirmed: true })`), `n` and `Escape`
 * cancel and leave the active agent unchanged; `Enter` and every other key are
 * ignored, and a paste cannot trigger it. Later switches into the same agent
 * this session skip this (core §2.7 never re-prompts). The wording is
 * data-driven from the agent's posture (an `unlisted: allow` agent names the
 * approval-prompt disabling; any other `confirm: true` agent uses the generic
 * text) — never from a NAME.
 */
export function ConfirmModeDialog({
  agent,
  onResolve,
  theme,
}: {
  agent: TopAgent;
  /** `true` → enable (`y`); `false` → cancel (`n`/`Escape`). */
  onResolve: (enable: boolean) => void;
  theme: ThemeTokens;
}): React.ReactElement {
  useInput((input, key) => {
    // A paste arrives as a multi-char `input`; a single `y`/`n` is a real
    // keystroke. Enter (key.return) and any other key are ignored (§3.5).
    if (input.length === 1) {
      const ch = input.toLowerCase();
      if (ch === "y") {
        onResolve(true);
        return;
      }
      if (ch === "n") {
        onResolve(false);
        return;
      }
    }
    if (key.escape) onResolve(false);
    // Enter (key.return) and any other key are ignored: only `y` enters (§3.5).
  });

  const allow = isAllowPosture(agent);
  const prov = confirmProvenanceLine(agent);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} {...(allow && theme.error ? { borderColor: theme.error } : {})}>
      <Text bold {...(allow && theme.error ? { color: theme.error } : {})}>
        {confirmDialogText(agent)}
      </Text>
      {prov ? <Text {...(theme.dim ? { color: theme.dim } : {})}>{prov}</Text> : null}
    </Box>
  );
}
