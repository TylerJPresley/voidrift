/**
 * Tool Guardrails — mechanical enforcement of golden principles.
 *
 * Runs after permission gate, before tool execution.
 * Two enforcement levels:
 * - Advisory (preWarning/postWarning): injected into tool result, model self-corrects
 * - Blocking (block: true): tool call rejected, model gets error and must retry correctly
 *
 * Golden Principles (blocking):
 * 1. Read before write — edit_file blocked if file not read this turn
 * 2. No /tmp writes — blocked, redirected to .voidrift/cache/
 * 3. Small changes — edit_file blocked if replacement exceeds 80% of file content
 *
 * Advisory:
 * - Large inline content (>50 lines in write_file) — warns about token cost
 * - Repetitive patterns (same tool >4 times) — suggests batching
 * - /tmp in commands — warns but doesn't block
 */

export interface GuardrailResult {
  /** Advisory prepended to tool result */
  preWarning?: string;
  /** Advisory appended to tool result */
  postWarning?: string;
  /** If true, skip execution entirely and return preWarning as the result */
  block?: boolean;
}

interface GuardrailContext {
  workspaceRoot: string;
  sessionId: string;
  /** Paths read this turn */
  filesRead: Set<string>;
  /** Tool calls executed this turn (name:args pairs) */
  callHistory: Array<{ name: string; args: Record<string, unknown> }>;
  /** Current tool loop round */
  round: number;
  /** Current tier (flash/dense/utility) — undefined if pinned */
  tier?: string;
}

type Guardrail = (tool: string, args: Record<string, unknown>, ctx: GuardrailContext) => GuardrailResult | null;

const guardrails: Guardrail[] = [];

function register(fn: Guardrail): void {
  guardrails.push(fn);
}

/**
 * Register a guardrail rule. Plugins and operators can add validation rules at runtime.
 * Rules are evaluated in registration order. A blocking rule short-circuits all subsequent rules.
 */
export function registerGuardrail(fn: Guardrail): void {
  guardrails.push(fn);
}

export type { Guardrail };

/**
 * Run all guardrails for a tool call. Returns merged result.
 */
export function checkGuardrails(tool: string, args: Record<string, unknown>, ctx: GuardrailContext): GuardrailResult {
  const merged: GuardrailResult = {};
  for (const fn of guardrails) {
    const result = fn(tool, args, ctx);
    if (!result) continue;
    if (result.block) return result; // Hard block — return immediately
    if (result.preWarning) merged.preWarning = (merged.preWarning ? merged.preWarning + "\n" : "") + result.preWarning;
    if (result.postWarning) merged.postWarning = (merged.postWarning ? merged.postWarning + "\n" : "") + result.postWarning;
  }
  return merged;
}

export function createGuardrailContext(workspaceRoot: string, sessionId: string, tier?: string): GuardrailContext {
  return { workspaceRoot, sessionId, filesRead: new Set(), callHistory: [], round: 0, tier };
}

// ─── BLOCKING: Edit without read (Golden Principle #1) ───────────────────────

register((tool, args, ctx) => {
  if (tool !== "edit_file") return null;
  const path = args.path as string | undefined;
  if (!path) return null;
  if (!ctx.filesRead.has(path)) {
    return {
      block: true,
      preWarning: `⚠️ BLOCKED: Cannot edit "${path}" without reading it first. Call read_file("${path}") to verify your search block exists and is unique, then retry the edit.`,
    };
  }
  return null;
});

// ─── BLOCKING: Write to /tmp (Golden Principle #2) ───────────────────────────

register((tool, args, ctx) => {
  if (tool !== "write_file") return null;
  const path = args.path as string | undefined;
  if (path && (path.startsWith("/tmp") || path.startsWith("/var/tmp"))) {
    return {
      block: true,
      preWarning: `⚠️ BLOCKED: Do not write to /tmp. Use .voidrift/cache/${ctx.sessionId}/ for temporary files.`,
    };
  }
  return null;
});

// ─── BLOCKING: Large replacement (Golden Principle #3) ───────────────────────

register((tool, args, ctx) => {
  if (tool !== "edit_file") return null;
  const search = args.search as string | undefined;
  const replace = args.replace as string | undefined;
  if (!search || !replace) return null;

  // If the search block is very large relative to what we've seen of the file,
  // and the replacement is substantially different, block it.
  // Heuristic: if search is >50 lines, it's likely a full-file rewrite disguised as an edit.
  const searchLines = search.split("\n").length;
  if (searchLines > 50) {
    return {
      block: true,
      preWarning: `⚠️ BLOCKED: edit_file with a ${searchLines}-line search block is a full rewrite, not a surgical edit. Use write_file for full replacements, or break into smaller targeted edits.`,
    };
  }
  return null;
});

// ─── ADVISORY: /tmp in commands ──────────────────────────────────────────────

register((tool, args, ctx) => {
  if (tool !== "execute_command") return null;
  const cmd = args.command as string | undefined;
  if (cmd && (/\/tmp\//.test(cmd) || /\/var\/tmp\//.test(cmd))) {
    return {
      preWarning: `⚠️ GUARDRAIL: Command references /tmp. Use .voidrift/cache/${ctx.sessionId}/ for temporary files instead.`,
    };
  }
  return null;
});

// ─── ADVISORY: Repetitive tool pattern ───────────────────────────────────────

register((tool, args, ctx) => {
  if (ctx.round < 5) return null;

  // Count how many times this same tool was called
  const sameToolCalls = ctx.callHistory.filter(c => c.name === tool).length;
  if (sameToolCalls < 4) return null;

  // Only warn for action tools, not reads
  const actionTools = new Set(["write_file", "edit_file", "execute_command", "web_fetch", "web_search"]);
  if (!actionTools.has(tool)) return null;

  return {
    postWarning: `⚠️ GUARDRAIL: Repetitive pattern detected — "${tool}" called ${sameToolCalls + 1} times this turn. Consider using register_task + invoke_task, background_exec with a script, or spawn_subagent to batch this work.`,
  };
});

// ─── BLOCKING: Plan creation on flash (auto mode only) ───────────────────────

register((tool, args, ctx) => {
  if (tool !== "add_plan") return null;
  if (!ctx.tier || ctx.tier !== "flash") return null;

  return {
    block: true,
    preWarning: `⚠️ BLOCKED: Plan creation requires the dense model. You are on flash — you cannot architect plans correctly. Call \`escalate\` with the reason, and the dense model will create the plan. Do not retry add_plan on flash. Do not proceed with implementation without a plan — call escalate FIRST.`,
  };
});
