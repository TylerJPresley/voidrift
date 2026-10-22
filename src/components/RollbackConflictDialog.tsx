import React from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { ThemeTokens } from "../render/theme.js";
import { renderConflict } from "../rollback-command.js";

/**
 * The rollback conflict confirmation dialog (cli-blueprint.md §7.5). A
 * client-owned confirmation shown when a restore would overwrite a path whose
 * current content differs from what the command expects (core §10.12). `y`
 * confirms the overwrite and the restore proceeds (all-or-nothing); `n` and
 * `Escape` refuse and leave the tree untouched. Enter and every other key are
 * ignored, and a paste cannot trigger it. NO_COLOR-safe; starts no turn.
 */
export function RollbackConflictDialog({
  action,
  movePointer,
  conflicts,
  onResolve,
  theme,
}: {
  action: "undo" | "redo" | "goto";
  movePointer: number;
  conflicts: string[];
  /** `true` → overwrite (`y`); `false` → refuse (`n`/`Escape`). */
  onResolve: (overwrite: boolean) => void;
  theme: ThemeTokens;
}): React.ReactElement {
  const decided = React.useRef(false);
  useInput((input, key) => {
    if (decided.current) return; // one decision per dialog (latch, §7.5)
    const resolve = (overwrite: boolean): void => {
      decided.current = true;
      onResolve(overwrite);
    };
    if (input.length === 1) {
      const ch = input.toLowerCase();
      if (ch === "y") {
        resolve(true);
        return;
      }
      if (ch === "n") {
        resolve(false);
        return;
      }
    }
    if (key.escape) resolve(false);
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} {...(theme.error ? { borderColor: theme.error } : {})}>
      <Text {...(theme.error ? { color: theme.error } : {})}>{renderConflict(action, movePointer, conflicts)}</Text>
    </Box>
  );
}
