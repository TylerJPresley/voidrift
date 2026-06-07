import type { SessionContext, Message } from "./context.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Four-Layer Prompt Cache Optimizer.
 *
 * Compiles context into four system messages ordered by ascending volatility,
 * giving providers independent cache boundaries per layer:
 *
 * 1. Agent  — identity & rules (never changes)
 * 2. Orbit  — project landscape (rarely changes)
 * 3. Drift  — active working set (changes on tool use)
 * 4. Void   — conversation history (changes every turn)
 */
export function compilePrompt(ctx: SessionContext): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  // Layer 1: Agent (session-locked, perfect cache anchor)
  const agentParts: string[] = [ctx.agent.activePersona];
  if (ctx.agent.boundSkills.length) {
    agentParts.push("\n--- Agent Skills ---\n" + ctx.agent.boundSkills.join("\n\n"));
  }
  if (ctx.agent.skillDiscoveryIndex.length) {
    agentParts.push("\n--- Available Skills ---\n" + ctx.agent.skillDiscoveryIndex.join("\n"));
  }
  messages.push({ role: "system", content: agentParts.join("\n") });

  // Layer 2: Orbit (project landscape, changes ~5% of turns)
  const orbitParts: string[] = [];
  orbitParts.push(`--- Context Guide ---
Your context has four layers:
• Agent: Your identity, tools, and rules. Do not repeat these back.
• Orbit: Project landscape — workspace map, plan, memory. Reference for navigation.
• Drift: Active files — SUMMARIES ONLY. You do NOT have full file content. Use read_file() to access actual content before quoting or editing.
• Void: Conversation history and diagnostics.

Files shown in Drift are summaries for awareness. Always call read_file(path, offset, limit) for real content.`);
  if (ctx.orbit.activeSkills.length) {
    orbitParts.push("--- Active Skills ---\n" + ctx.orbit.activeSkills.join("\n\n"));
  }
  if (ctx.orbit.workspaceCodeMap) {
    orbitParts.push("--- Workspace Map ---\n" + ctx.orbit.workspaceCodeMap);
  }
  if (ctx.orbit.activePlan) {
    orbitParts.push("--- Active Plan ---\n" + ctx.orbit.activePlan);
  }
  if (ctx.orbit.activeMemory.length) {
    orbitParts.push("--- Memory ---\n" + ctx.orbit.activeMemory.join("\n\n"));
  }
  if (orbitParts.length) {
    messages.push({ role: "system", content: orbitParts.join("\n\n") });
  }

  // Layer 3: Drift (active working set, changes ~30-40% of turns)
  const driftParts: string[] = [];
  if (ctx.drift.focusedFiles.length) {
    for (const f of ctx.drift.focusedFiles) {
      driftParts.push(`--- Focused: ${f.path} (SUMMARY — use read_file for actual content) ---\n${f.summary}`);
    }
  }
  if (ctx.drift.gitStatus) {
    driftParts.push("--- Git Status ---\n" + ctx.drift.gitStatus);
  }
  if (driftParts.length) {
    messages.push({ role: "system", content: driftParts.join("\n\n") });
  }

  // Layer 4: Void (conversation history, changes every turn)
  for (const msg of ctx.void.messages) {
    messages.push({ role: msg.role === "tool" ? "tool" : msg.role, content: msg.content });
  }

  // Diagnostics at the absolute tail (most volatile)
  if (ctx.void.diagnostics) {
    messages.push({ role: "system", content: "--- Diagnostics ---\n" + ctx.void.diagnostics });
  }

  // Turn context (plugin-injected, ephemeral per-turn)
  if (ctx.void.turnContext.length) {
    for (const tc of ctx.void.turnContext) {
      messages.push({ role: "system", content: `--- ${tc.label} ---\n${tc.content}` });
    }
  }

  return messages;
}
