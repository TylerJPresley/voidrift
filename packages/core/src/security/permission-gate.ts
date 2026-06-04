import { randomUUID } from "crypto";
import { resolve, join } from "path";
import type { EventBus } from "../events/bus.js";
import { computeDiff, computeEditDiff } from "../safeguards/diff.js";
import type { AgentManifest, ApprovalMode } from "../agents/registry.js";

/** Simple helper to convert glob pattern string to RegExp */
function matchGlob(pathStr: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(pathStr);
}

function resolveGlobToAbsolute(pattern: string, workspaceRoot: string): string {
  let resolved = pattern;
  if (pattern.startsWith("./")) {
    resolved = join(workspaceRoot, pattern.slice(2));
  } else if (pattern.startsWith("~/")) {
    resolved = join(process.env.HOME || "", pattern.slice(2));
  }
  return resolved;
}

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
 * Behavior per approvalMode:
 * - deny: All mutating tools rejected outright
 * - prompt: Suspends via Promise if tool is not in allowedTools
 * - autonomous: All tools auto-approved
 */
export class PermissionGate {
  private pendingRequests = new Map<string, { resolve: (approved: boolean) => void }>();

  constructor(private bus: EventBus, private workspaceRoot?: string) {
    this.bus.subscribe("TOOL_CONFIRMATION_RESPONSE", (event) => {
      const { requestId, approved } = event.payload as any;
      if (requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          pending.resolve(approved);
        }
      } else {
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

  async check(tool: string, args: Record<string, unknown>, agent: { approvalMode: ApprovalMode; allowedTools: string[]; toolsSettings?: Record<string, any> }): Promise<GateResult> {
    // 1. Enforce allowedPaths glob constraints for file mutation tools
    if ((tool === "write_file" || tool === "edit_file") && this.workspaceRoot) {
      const allowedPaths: string[] = agent.toolsSettings?.[tool]?.allowedPaths || [];
      if (allowedPaths.length > 0 && typeof args.path === "string") {
        const absolutePath = resolve(this.workspaceRoot, args.path);
        const isAllowed = allowedPaths.some(p => {
          const absPattern = resolveGlobToAbsolute(p, this.workspaceRoot!);
          return matchGlob(absolutePath, absPattern);
        });
        if (!isAllowed) {
          return { approved: false, reason: `Error: Write path "${args.path}" violates agent write boundaries.` };
        }
      }
    }

    // 2. Bypass gate if execute_command is read-only and autoAllowReadonly is true
    if (tool === "execute_command" && typeof args.command === "string") {
      const autoAllowReadonly = agent.toolsSettings?.execute_command?.autoAllowReadonly;
      if (autoAllowReadonly) {
        const isReadOnly = /^(git status|git log|git diff|cat|ls|pwd|echo|find|grep)\b/.test(args.command.trim());
        if (isReadOnly) return { approved: true };
      }
    }

    // Autonomous: all tools auto-approved
    if (agent.approvalMode === "autonomous") return { approved: true };

    // Tool is in allowedTools: auto-approved regardless of mode
    if (agent.allowedTools.includes(tool)) return { approved: true };

    // Deny mode: reject anything not in allowedTools
    if (agent.approvalMode === "deny") {
      return { approved: false, reason: `Tool "${tool}" is blocked by agent` };
    }

    // Prompt mode: suspend and ask the operator
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
