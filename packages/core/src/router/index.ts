import type { Tier, ResolvedModel } from "../adapters/factory.js";
import { createTierAdapter } from "../adapters/factory.js";
import type { VoidRiftConfig } from "../config/loader.js";

export type NodeType = "architect" | "engineer" | "auditor" | null;
export type Mode = "plan" | "chat" | "vibe";

export interface RoutingContext {
  activeNode: NodeType;
  activeMode: Mode;
  inputLength: number;
  mentionedFiles: number;
}

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

/**
 * Three-tier model router.
 * Signal 1: active node → Signal 2: mode → Signal 3: complexity heuristics.
 */
export function routeTier(ctx: RoutingContext): Tier {
  if (ctx.activeNode === "auditor") return "flash";
  if (ctx.activeNode === "engineer") return "utility";
  if (ctx.activeMode === "plan") return "dense";
  if (ctx.inputLength < 100 && ctx.mentionedFiles <= 1) return "flash";
  if (ctx.inputLength < 500 && ctx.mentionedFiles <= 3) return "utility";
  return "dense";
}

/**
 * Escalation: promotes to the next higher tier.
 * Returns null if already at dense (no higher tier).
 */
export function escalateTier(currentTier: Tier): Tier | null {
  const idx = TIER_ORDER.indexOf(currentTier);
  if (idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

/**
 * Delegation: demotes to flash tier for simple read-only sub-tasks.
 */
export function delegateTier(): Tier {
  return "flash";
}

/**
 * Pre-turn analysis: determines if escalation should trigger.
 * Triggers when tokens exceed 85% of context limit OR consecutive failures >= 2.
 */
export function shouldEscalate(tokenCount: number, contextLimit: number, consecutiveFailures: number): boolean {
  if (tokenCount > contextLimit * CONTEXT_THRESHOLD) return true;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return true;
  return false;
}

/**
 * Builds the full EscalationState snapshot for tier transition.
 */
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

/**
 * Generates the system instruction injected into the Work Partition on escalation.
 */
export function escalationNotice(state: EscalationState): string {
  return `[SYSTEM ESCALATION NOTICE]: Execution transitioned from ${state.sourceTier} to ${state.targetTier} for ${state.originalNode} node due to ${state.triggerReason.code}. Please resume work smoothly.`;
}

export function resolveRouter(ctx: RoutingContext, config: VoidRiftConfig): ResolvedModel {
  const tier = routeTier(ctx);
  return createTierAdapter(tier, config);
}

export function resolveEscalation(currentTier: Tier, config: VoidRiftConfig): ResolvedModel | null {
  const next = escalateTier(currentTier);
  if (!next) return null;
  return createTierAdapter(next, config);
}

export function resolveDelegation(config: VoidRiftConfig): ResolvedModel {
  return createTierAdapter(delegateTier(), config);
}
