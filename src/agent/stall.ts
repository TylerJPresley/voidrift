/**
 * Stall detection (REQ-ARCH-4).
 *
 * Compares tool call signatures between consecutive turns.
 * If any signature overlaps → stall detected.
 */

import type { ToolCall } from "./types.js";

export function tcSig(tc: ToolCall): string {
  const name = tc.function.name;
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }

  const isWrite = name === "file" && ["write", "edit", "delete"].includes(String(args.action));
  if (isWrite) return `${name}:${args.path ?? ""}`;
  return `${name}:${tc.function.arguments || ""}`;
}

export function detectStall(currentCalls: ToolCall[], prevSigs: Set<string>): boolean {
  if (!prevSigs.size) return false;
  for (const tc of currentCalls) {
    if (prevSigs.has(tcSig(tc))) return true;
  }
  return false;
}

export function buildSigSet(calls: ToolCall[]): Set<string> {
  return new Set(calls.map(tcSig));
}
