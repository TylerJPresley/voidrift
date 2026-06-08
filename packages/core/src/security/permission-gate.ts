import { randomUUID } from "crypto";
import type { EventBus } from "../events/bus.js";
import { computeDiff, computeEditDiff } from "../safeguards/diff.js";
import type { ApprovalMode } from "../agents/registry.js";
import { PolicyEngine, inferPattern, inferPatterns, type PolicyCheckResult } from "./policy-engine.js";

export interface PendingRequest {
  requestId: string;
  toolName: string;
}

export interface GateResult {
  approved: boolean;
  reason?: string;
}

const GATE_TIMEOUT_MS = 120_000;

/**
 * Interactive Permission Gate.
 *
 * Delegates policy decisions to PolicyEngine, handles UI suspension for "ask" decisions.
 * Supports 3-option response: allow once, always allow (persist), deny.
 */
export class PermissionGate {
  private pendingRequests = new Map<string, { resolve: (response: { approved: boolean; persist?: boolean; chosenPattern?: string }) => void }>();
  readonly engine: PolicyEngine;

  constructor(private bus: EventBus, workspaceRoot?: string) {
    this.engine = new PolicyEngine(workspaceRoot);

    this.bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (event) => {
      const { requestId, approved, persist, chosenPattern } = event.payload as any;
      if (requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          pending.resolve({ approved, persist, chosenPattern });
        }
      } else {
        const first = this.pendingRequests.entries().next().value;
        if (first) {
          this.pendingRequests.delete(first[0]);
          first[1].resolve({ approved, persist });
        }
      }
    });
  }

  async check(tool: string, args: Record<string, unknown>, agent: { approvalMode: ApprovalMode; allowedTools: string[] }): Promise<GateResult> {
    // Auto-approve tools explicitly in allowedTools (read tools for chat agent)
    if (agent.allowedTools.includes(tool)) return { approved: true };

    // Delegate to PolicyEngine
    const result = this.engine.check(tool, args, agent.approvalMode);

    if (result.decision === "allow") return { approved: true };
    if (result.decision === "deny") {
      return { approved: false, reason: result.rule?.label || `Tool "${tool}" denied by policy` };
    }

    // Decision is "ask" — suspend and show confirmation UI
    return this.requestConfirmation(tool, args, result);
  }

  private requestConfirmation(tool: string, args: Record<string, unknown>, policyResult: PolicyCheckResult): Promise<GateResult> {
    const requestId = randomUUID();
    const patterns = inferPatterns(tool, args);

    return new Promise<GateResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ approved: false, reason: "Approval timed out" });
      }, GATE_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timer);
          const chosenPattern = response.chosenPattern;
          if (response.approved && chosenPattern) {
            // "Trust" option — session-scoped rule for this pattern
            this.engine.addSessionRule({ tool, pattern: chosenPattern, decision: "allow" });
          }
          resolve({
            approved: response.approved,
            reason: response.approved ? undefined : "Operation denied by user.",
          });
        },
      });

      this.bus.publish("TOOL_CONFIRMATION_REQUEST", {
        tool,
        args,
        requestId,
        diff: this.computeToolDiff(tool, args),
        inferredPatterns: patterns,
      } as any);
    });
  }

  private computeToolDiff(tool: string, args: Record<string, unknown>): string[] | undefined {
    if (tool === "write_file" && typeof args.path === "string" && typeof args.content === "string") {
      return computeDiff(".", args.path, args.content);
    }
    if (tool === "edit_file" && typeof args.path === "string" && typeof args.search === "string" && typeof args.replace === "string") {
      return computeEditDiff(".", args.path, args.search, args.replace);
    }
    return undefined;
  }
}
