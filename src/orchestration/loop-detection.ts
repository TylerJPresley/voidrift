/**
 * Loop Detection — tracks consecutive failures, repeated tool patterns,
 * and fingerprint doom-loops during tool execution.
 */

export interface LoopDetectionState {
  consecutiveErrors: number;
  toolFailures: Map<string, number>;
  maxConsecutiveErrors: number;
  maxToolFailures: number;
  fingerprints: string[];
  fingerprintWindow: number;
  fingerprintThreshold: number;
}

export function createLoopDetection(): LoopDetectionState {
  return {
    consecutiveErrors: 0,
    toolFailures: new Map(),
    maxConsecutiveErrors: 3,
    maxToolFailures: 4,
    fingerprints: [],
    fingerprintWindow: 20,
    fingerprintThreshold: 3,
  };
}

export interface LoopCheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Record a tool result and check for loop conditions.
 * Returns { blocked: true, reason } if the loop should terminate.
 */
export function recordAndCheck(
  state: LoopDetectionState,
  toolName: string,
  args: string,
  isError: boolean,
): LoopCheckResult {
  // Track consecutive errors
  if (isError) {
    state.consecutiveErrors++;
    state.toolFailures.set(toolName, (state.toolFailures.get(toolName) || 0) + 1);
  } else {
    state.consecutiveErrors = 0;
  }

  // Hard termination: 3 consecutive errors
  if (state.consecutiveErrors >= state.maxConsecutiveErrors) {
    return {
      blocked: true,
      reason: `⚠️ LOOP DETECTED: ${state.maxConsecutiveErrors} consecutive tool failures. STOP calling tools. Restate what you're trying to accomplish and try a fundamentally different approach. Do NOT retry the same operation.`,
    };
  }

  // Hard termination: same tool failing 4+ times
  if ((state.toolFailures.get(toolName) || 0) >= state.maxToolFailures) {
    return {
      blocked: true,
      reason: `⚠️ LOOP DETECTED: "${toolName}" has failed ${state.maxToolFailures} times this turn. STOP using this tool. Either use a different approach or ask the user for help.`,
    };
  }

  // Fingerprint doom-loop: identical (tool+args) repeated
  const fp = `${toolName}:${args}`;
  state.fingerprints.push(fp);
  if (state.fingerprints.length > state.fingerprintWindow) state.fingerprints.shift();
  const fpCount = state.fingerprints.filter(f => f === fp).length;
  if (fpCount >= state.fingerprintThreshold) {
    return {
      blocked: true,
      reason: `⚠️ DOOM LOOP: "${toolName}" called ${fpCount} times with identical arguments in the last ${state.fingerprintWindow} calls. You are not making progress. STOP and try a completely different approach.`,
    };
  }

  return { blocked: false };
}
