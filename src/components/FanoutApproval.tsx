import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingApproval } from "@voidrift/core";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { sanitize } from "../render/theme.js";

export type FanoutChoice = "approve_all" | "approve_all_and_grant" | "review_individually" | "cancel";

/**
 * The batched fan-out approval prompt (§6.2). Lists each worker's pending action
 * in full (tool and args, never a bare name) with four choices: approve-all,
 * approve-and-grant, review-individually (opens the monitor), and cancel. When
 * `autoDenySeconds > 0` (§9.5) a countdown shows and, at expiry, CANCELS the
 * batch (deny-and-continue — every pending worker ask is denied, the fail-closed
 * outcome).
 */
export function FanoutApproval({
  pending,
  onChoice,
  theme,
  glyphs,
  autoDenySeconds,
}: {
  pending: PendingApproval[];
  onChoice: (choice: FanoutChoice) => void;
  theme: ThemeTokens;
  glyphs: Glyphs;
  /** The unattended-approval countdown in seconds (`limits.approval.autoDenySeconds`,
   * §9.5). >0 → a countdown that cancels (deny-and-continue) at expiry. */
  autoDenySeconds?: number | undefined;
}): React.ReactElement {
  const decidedRef = React.useRef(false);
  const choose = (choice: FanoutChoice): void => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onChoice(choice);
  };
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
        choose("cancel");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [countdownEnabled]);

  useInput((input) => {
    const ch = input.toLowerCase();
    if (ch === "a") choose("approve_all");
    else if (ch === "f") choose("approve_all_and_grant");
    else if (ch === "c") choose("review_individually");
    else if (ch === "x") choose("cancel");
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text {...(theme.warning ? { color: theme.warning } : {})}>
        {glyphs.warn} {pending.length} tool approvals pending
      </Text>
      {pending.map((p, i) => (
        <Text key={p.id || i}>
          {i + 1}. {sanitize(p.tool)} {sanitize(JSON.stringify(p.args))}
        </Text>
      ))}
      {countdownEnabled ? (
        <Text {...(theme.warning ? { color: theme.warning } : {})}>auto-deny in {remaining}s</Text>
      ) : null}
      <Text {...(theme.dim ? { color: theme.dim } : {})}>
        [a] approve all  [f] approve all + grant (this run)  [c] configure individually  [x] exit (cancel subagents)
      </Text>
    </Box>
  );
}
