import type { ResolvedModel, ModelRole } from "../adapters/factory.js";
import { createRoleAdapter } from "../adapters/factory.js";
import type { VoidRiftConfig } from "../config/loader.js";

export type EscalationCode = "CONTEXT_OVERFLOW" | "REPEATED_AUDIT_FAILURE" | "API_EXCEPTION" | "MANUAL_ESCALATION";

export interface EscalationState {
  escalationId: string;
  timestamp: number;
  sourceRole: ModelRole;
  targetRole: ModelRole;
  triggerReason: {
    code: EscalationCode;
    message: string;
    metrics?: {
      tokenCount?: number;
      limit?: number;
      failureCount?: number;
    };
  };
  originalNode: string;
  sessionState: {
    activePlan: string | null;
    focusedFiles: string[];
    messagesSnapshot: Array<{ role: string; content: string; toolCalls?: unknown[] }>;
  };
}

const ROLE_ORDER: ModelRole[] = ["selected", "utility", "escalation"];
const CONTEXT_THRESHOLD = 0.85;
const MAX_CONSECUTIVE_FAILURES = 2;

/** Escalation: promotes to the next higher tier. */
export function escalateRole(currentRole: ModelRole): ModelRole | null {
  const idx = ROLE_ORDER.indexOf(currentRole);
  if (idx >= ROLE_ORDER.length - 1) return null;
  return ROLE_ORDER[idx + 1];
}

/** Pre-turn analysis: determines if escalation should trigger. */
export function shouldEscalate(tokenCount: number, contextLimit: number, consecutiveFailures: number, thresholds?: { contextPct?: number; failures?: number }): boolean {
  if (tokenCount > contextLimit * (thresholds?.contextPct ?? CONTEXT_THRESHOLD)) return true;
  if (consecutiveFailures >= (thresholds?.failures ?? MAX_CONSECUTIVE_FAILURES)) return true;
  return false;
}

/** Builds the full EscalationState snapshot for tier transition. */
export function buildEscalationState(
  sourceRole: ModelRole,
  targetRole: ModelRole,
  code: EscalationCode,
  message: string,
  originalNode: string,
  sessionState: EscalationState["sessionState"],
  metrics?: EscalationState["triggerReason"]["metrics"]
): EscalationState {
  return {
    escalationId: `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    sourceRole,
    targetRole,
    triggerReason: { code, message, metrics },
    originalNode,
    sessionState,
  };
}

/** Generates the system instruction injected on escalation. */
export function escalationNotice(state: EscalationState): string {
  return `[SYSTEM ESCALATION NOTICE]: Execution transitioned from ${state.sourceRole} to ${state.targetRole} due to ${state.triggerReason.code}. Please resume work smoothly.`;
}

export function resolveEscalation(currentRole: ModelRole, config: VoidRiftConfig): ResolvedModel | null {
  const next = escalateRole(currentRole);
  if (!next) return null;
  return createRoleAdapter(next, config);
}
