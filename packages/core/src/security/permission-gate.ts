import { randomUUID } from "crypto";
import type { EventBus } from "../events/bus.js";
import { getToolSchema } from "../tools/definitions.js";
import { computeDiff, computeEditDiff } from "../safeguards/diff.js";
import type { Mode } from "../router/index.js";

export interface PendingRequest {
  requestId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestedAt: number;
}

export interface GateResult {
  approved: boolean;
  reason?: string;
}

const GATE_TIMEOUT_MS = 120_000;
const REJECTION_MESSAGE = "Error: Operation rejected by user permission gate.";

/**
 * Interactive Permission Gate (G-07).
 *
 * Uses async Promise suspension to pause tool execution without blocking Node's event loop.
 * Maintains a pendingRequests registry keyed by requestId (UUID).
 *
 * Behavior per mode:
 * - plan: Gated tools rejected outright
 * - chat: Suspends via Promise, publishes TOOL_CONFIRMATION_REQUEST with requestId, awaits response
 * - vibe: All tools auto-approved
 */
export class PermissionGate {
  private pendingRequests = new Map<string, { resolve: (approved: boolean) => void }>();

  constructor(private bus: EventBus, private workspaceRoot?: string) {
    // Listen for responses and resolve matching pending requests
    this.bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (event) => {
      const { requestId, approved } = event.payload as any;
      // Support both requestId-based and simple responses
      if (requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          pending.resolve(approved);
        }
      } else {
        // Legacy: resolve the oldest pending request
        const first = this.pendingRequests.entries().next().value;
        if (first) {
          this.pendingRequests.delete(first[0]);
          first[1].resolve(approved);
        }
      }
    });
  }

  get pending(): PendingRequest[] {
    return [...this.pendingRequests.keys()].map((id) => ({
      requestId: id,
      toolName: "",
      arguments: {},
      requestedAt: 0,
    }));
  }

  async check(tool: string, args: Record<string, unknown>, mode: Mode): Promise<GateResult> {
    // Vibe mode: fully autonomous
    if (mode === "vibe") return { approved: true };

    const schema = getToolSchema(tool);
    if (!schema || schema.safetyProfile === "auto-approved") {
      return { approved: true };
    }

    // Plan mode: gated tools rejected outright
    if (mode === "plan") {
      return { approved: false, reason: `Tool "${tool}" is blocked in plan mode` };
    }

    // Chat mode: suspend via Promise with requestId
    const requestId = randomUUID();

    return new Promise<GateResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ approved: false, reason: "Approval timed out" });
      }, GATE_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: (approved: boolean) => {
          clearTimeout(timer);
          resolve({
            approved,
            reason: approved ? undefined : REJECTION_MESSAGE,
          });
        },
      });

      this.bus.publish("TOOL_CONFIRMATION_REQUEST", { tool, args, requestId, diff: this.computeToolDiff(tool, args) } as any);
    });
  }

  private computeToolDiff(tool: string, args: Record<string, unknown>): string[] | undefined {
    if (!this.workspaceRoot) return undefined;
    if (tool === "write_file" && typeof args.path === "string" && typeof args.content === "string") {
      return computeDiff(this.workspaceRoot, args.path, args.content);
    }
    if (tool === "edit_file" && typeof args.path === "string" && typeof args.search === "string" && typeof args.replace === "string") {
      return computeEditDiff(this.workspaceRoot, args.path, args.search, args.replace);
    }
    return undefined;
  }
}
