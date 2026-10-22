/**
 * Process exit codes (cli-blueprint.md §2.4).
 *
 * Headless runs map the terminal `RunStatus` to a process exit code so a
 * scheduler or CI host can decide whether to retry, resume, or report. The
 * fixed usage/startup/signal codes live here too (§2.4).
 */
import type { TurnResult } from "@voidrift/core";

export const EXIT = {
  COMPLETED: 0,
  FAILED: 1,
  USAGE: 2,
  STARTUP: 3,
  LIMIT_REACHED: 4,
  WAITING_FOR_APPROVAL: 5,
  WAITING_FOR_INPUT: 6,
  SIGINT: 130,
  SIGTERM: 143,
} as const;

export type RunStatus = TurnResult["status"];

/** Map a terminal `RunStatus` to its process exit code (§2.4). */
export function exitCodeFor(status: RunStatus): number {
  switch (status) {
    case "completed":
      return EXIT.COMPLETED;
    case "failed":
      return EXIT.FAILED;
    case "limit_reached":
      return EXIT.LIMIT_REACHED;
    case "waiting_for_approval":
      return EXIT.WAITING_FOR_APPROVAL;
    case "waiting_for_input":
      return EXIT.WAITING_FOR_INPUT;
    case "cancelled":
      return EXIT.SIGINT;
  }
}
