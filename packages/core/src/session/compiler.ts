import type { SessionContext, Message } from "./context.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Four-Layer Prompt Cache Optimizer (AMD-017).
 *
 * Compiles context into four system messages ordered by ascending volatility,
 * giving providers independent cache boundaries per layer:
 *
 * 1. Governance      — agent identity (never changes)
 * 2. Workspace Global — project landscape (rarely changes)
 * 3. Workspace Context — active working set (changes on tool use)
 * 4. Work            — conversation history (changes every turn)
 */
export function compilePrompt(ctx: SessionContext): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  // Layer 1: Governance (session-locked, perfect cache anchor)
  const govParts: string[] = [ctx.governance.activePersona];
  if (ctx.governance.boundSkills.length) {
    govParts.push("\n--- Agent Skills ---\n" + ctx.governance.boundSkills.join("\n\n"));
  }
  if (ctx.governance.skillDiscoveryIndex.length) {
    govParts.push("\n--- Available Skills ---\n" + ctx.governance.skillDiscoveryIndex.join("\n"));
  }
  messages.push({ role: "system", content: govParts.join("\n") });

  // Layer 2: Workspace Global (project landscape, changes ~5% of turns)
  const globalParts: string[] = [];
  if (ctx.workspace.activeSkills.length) {
    globalParts.push("--- Active Skills ---\n" + ctx.workspace.activeSkills.join("\n\n"));
  }
  if (ctx.workspace.workspaceCodeMap) {
    globalParts.push("--- Workspace Map ---\n" + ctx.workspace.workspaceCodeMap);
  }
  if (ctx.workspace.activePlan) {
    globalParts.push("--- Active Plan ---\n" + ctx.workspace.activePlan);
  }
  if (ctx.workspace.activeMemory.length) {
    globalParts.push("--- Memory ---\n" + ctx.workspace.activeMemory.join("\n\n"));
  }
  if (globalParts.length) {
    messages.push({ role: "system", content: globalParts.join("\n\n") });
  }

  // Layer 3: Workspace Context (active working set, changes ~30-40% of turns)
  const ctxParts: string[] = [];
  if (ctx.workspace.focusedFiles.length) {
    for (const f of ctx.workspace.focusedFiles) {
      ctxParts.push(`--- Focused: ${f.path} ---\n${f.summary}`);
    }
  }
  if (ctx.workspace.gitStatus) {
    ctxParts.push("--- Git Status ---\n" + ctx.workspace.gitStatus);
  }
  if (ctxParts.length) {
    messages.push({ role: "system", content: ctxParts.join("\n\n") });
  }

  // Layer 4: Work (conversation history, changes every turn)
  for (const msg of ctx.work.messages) {
    messages.push({ role: msg.role === "tool" ? "tool" : msg.role, content: msg.content });
  }

  // Diagnostics at the absolute tail (most volatile)
  if (ctx.work.diagnostics) {
    messages.push({ role: "system", content: "--- Diagnostics ---\n" + ctx.work.diagnostics });
  }

  return messages;
}
