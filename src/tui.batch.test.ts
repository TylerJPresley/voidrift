/**
 * Worker-ask batching gate (cli-blueprint.md §6.2, core §9.5). The fan-out
 * batched prompt's `a`/`f` approves every batched member at once, so a force-ask
 * (any `forceAskKind`: SSRF, plugin-install, dangerous shell, control-file) must
 * NEVER be batchable — it is routed to the single-action dialog, one decision
 * each. Only a PLAIN worker ask joins the batch.
 */
import { describe, it, expect } from "vitest";
import type { PendingApproval } from "@voidrift/core";
import { isWorkerBatchable } from "./tui.js";

function ask(overrides: Partial<PendingApproval>): PendingApproval {
  return {
    id: "w1",
    tool: "write_file",
    args: {},
    choices: ["approve", "reject"],
    mode: "interactive",
    workerId: "fanout-w1",
    ...overrides,
  } as PendingApproval;
}

describe("§6.2 isWorkerBatchable", () => {
  it("a PLAIN worker ask is batchable", () => {
    expect(isWorkerBatchable(ask({}))).toBe(true);
  });

  it("a non-worker (orchestrator) ask is NEVER batchable", () => {
    // Construct with workerId as empty string (falsy), which represents no worker
    expect(isWorkerBatchable(ask({ workerId: "" }))).toBe(false);
  });

  it("a worker FORCE-ASK is never batchable, for every forceAskKind", () => {
    for (const kind of ["ssrf", "plugin-install", "shell", "control-file"] as const) {
      expect(isWorkerBatchable(ask({ forceAsk: true, forceAskKind: kind }))).toBe(false);
      // Defensive: forceAskKind present even without the boolean flag.
      expect(isWorkerBatchable(ask({ forceAskKind: kind }))).toBe(false);
    }
  });
});
