import { randomUUID } from "crypto";
import type { EventBus } from "../events/bus.js";
import { computeDiff, computeEditDiff } from "../safeguards/diff.js";
import type { ApprovalMode } from "../agents/registry.js";
import { PolicyEngine, inferPattern, inferPatterns, matchGlob, type PolicyCheckResult } from "./policy-engine.js";

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
  private pendingRequests = new Map<string, { resolve: (response: { approved: boolean; persist?: boolean; scope?: "workspace" | "global"; chosenPattern?: string }) => void }>();
  private timeoutMs: number;
  readonly engine: PolicyEngine;

  constructor(private bus: EventBus, workspaceRoot?: string, timeoutSeconds = 120) {
    this.timeoutMs = timeoutSeconds === 0 ? 0 : timeoutSeconds * 1000;
    this.engine = new PolicyEngine(workspaceRoot);

    this.bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (event) => {
      const { requestId, approved, persist, chosenPattern, scope } = event.payload as any;
      if (requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          pending.resolve({ approved, persist, scope, chosenPattern });
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

  async check(tool: string, args: Record<string, unknown>, agent: { approvalMode: ApprovalMode; allowedTools: string[] }, planScope?: { write?: string[]; execute?: string[] }): Promise<GateResult> {
    // Auto-approve tools explicitly in allowedTools (read tools for chat agent)
    if (agent.allowedTools.includes(tool)) return { approved: true };

    // Plan scope: if action falls within approved plan scope, auto-allow
    if (planScope && this.matchesPlanScope(tool, args, planScope)) {
      return { approved: true };
    }

    // Delegate to PolicyEngine
    const result = this.engine.check(tool, args, agent.approvalMode);

    if (result.decision === "allow") return { approved: true };
    if (result.decision === "deny") {
      return { approved: false, reason: result.rule?.label || `Tool "${tool}" denied by policy` };
    }

    // Decision is "ask" — suspend and show confirmation UI
    return this.requestConfirmation(tool, args, result);
  }

  /** Check if a tool call falls within the approved plan scope */
  private matchesPlanScope(tool: string, args: Record<string, unknown>, scope: { write?: string[]; execute?: string[] }): boolean {
    if ((tool === "write_file" || tool === "edit_file") && typeof args.path === "string" && scope.write?.length) {
      return scope.write.some(pattern => matchGlob(args.path as string, pattern));
    }
    if (tool === "execute_command" && typeof args.command === "string" && scope.execute?.length) {
      return scope.execute.some(pattern => (args.command as string).startsWith(pattern) || matchGlob(args.command as string, pattern));
    }
    return false;
  }

  private requestConfirmation(tool: string, args: Record<string, unknown>, policyResult: PolicyCheckResult): Promise<GateResult> {
    const requestId = randomUUID();
    const patterns = inferPatterns(tool, args);

    return new Promise<GateResult>((resolve) => {
      const timer = this.timeoutMs > 0 ? setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ approved: false, reason: "Approval timed out" });
      }, this.timeoutMs) : null;

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timer!);
          const chosenPattern = response.chosenPattern;
          if (response.approved && chosenPattern) {
            const rule = chosenPattern.startsWith("mcp_")
              ? { tool: chosenPattern, decision: "allow" as const }
              : { tool, pattern: chosenPattern, decision: "allow" as const };
            if (response.persist) {
              this.engine.persistRule(rule, response.scope);
              this.bus.publish("POLICY_RULE_ADDED", { tool: rule.tool, pattern: rule.pattern, decision: "allow", source: response.scope || "workspace" } as any);
            } else {
              this.engine.addSessionRule(rule);
              this.bus.publish("POLICY_RULE_ADDED", { tool: rule.tool, pattern: rule.pattern, decision: "allow", source: "session" } as any);
            }
          }
          if (response.approved) {
            this.bus.publish("PERMISSION_GRANTED", { tool, pattern: response.chosenPattern, persist: !!response.persist });
          } else {
            this.bus.publish("PERMISSION_DENIED", { tool, reason: "Operation denied by user." });
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
