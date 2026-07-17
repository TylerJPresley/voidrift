import type { ResolvedModel, Tier } from "../adapters/factory.js";
import { createTierAdapter } from "../adapters/factory.js";
import type { VoidRiftConfig } from "../config/loader.js";

export type EscalationCode = "CONTEXT_OVERFLOW" | "REPEATED_AUDIT_FAILURE" | "API_EXCEPTION" | "MANUAL_ESCALATION";

export interface EscalationState {
  escalationId: string;
  timestamp: number;
  sourceTier: Tier;
  targetTier: Tier;
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

const TIER_ORDER: Tier[] = ["flash", "utility", "dense"];
const CONTEXT_THRESHOLD = 0.85;
const MAX_CONSECUTIVE_FAILURES = 2;

/** Escalation: promotes to the next higher tier. */
export function escalateTier(currentTier: Tier): Tier | null {
  const idx = TIER_ORDER.indexOf(currentTier);
  if (idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

/** Pre-turn analysis: determines if escalation should trigger. */
export function shouldEscalate(tokenCount: number, contextLimit: number, consecutiveFailures: number, thresholds?: { contextPct?: number; failures?: number }): boolean {
  if (tokenCount > contextLimit * (thresholds?.contextPct ?? CONTEXT_THRESHOLD)) return true;
  if (consecutiveFailures >= (thresholds?.failures ?? MAX_CONSECUTIVE_FAILURES)) return true;
  return false;
}

/** Builds the full EscalationState snapshot for tier transition. */
export function buildEscalationState(
  sourceTier: Tier,
  targetTier: Tier,
  code: EscalationCode,
  message: string,
  originalNode: string,
  sessionState: EscalationState["sessionState"],
  metrics?: EscalationState["triggerReason"]["metrics"]
): EscalationState {
  return {
    escalationId: `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    sourceTier,
    targetTier,
    triggerReason: { code, message, metrics },
    originalNode,
    sessionState,
  };
}

/** Generates the system instruction injected on escalation. */
export function escalationNotice(state: EscalationState): string {
  return `[SYSTEM ESCALATION NOTICE]: Execution transitioned from ${state.sourceTier} to ${state.targetTier} due to ${state.triggerReason.code}. Please resume work smoothly.`;
}

export function resolveEscalation(currentTier: Tier, config: VoidRiftConfig): ResolvedModel | null {
  const next = escalateTier(currentTier);
  if (!next) return null;
  return createTierAdapter(next, config);
}
