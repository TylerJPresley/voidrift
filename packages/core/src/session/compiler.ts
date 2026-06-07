import type { SessionContext } from "./context.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Four-Layer Prompt Compiler.
 *
 * Compiles context into messages ordered by ascending volatility:
 * 1. Agent  — identity, rules, Context Guide (never changes)
 * 2. Orbit  — project landscape (rarely changes)
 * 3. Drift  — active working set (changes on tool use)
 * 4. Void   — conversation history (changes every turn)
 *
 * This ordering maximizes prompt cache reuse on providers that support it.
 */
export function compilePrompt(ctx: SessionContext): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  // Layer 1: Agent (session-locked cache anchor)
  messages.push({ role: "system", content: buildAgentLayer(ctx) });

  // Layer 2: Orbit (project landscape, changes ~5% of turns)
  const orbit = buildOrbitLayer(ctx);
  if (orbit) messages.push({ role: "system", content: orbit });

  // Layer 3: Drift (active working set, changes ~30-40% of turns)
  const drift = buildDriftLayer(ctx);
  if (drift) messages.push({ role: "system", content: drift });

  // Layer 4: Void (conversation history, changes every turn)
  for (const msg of ctx.void.messages) {
    messages.push({ role: msg.role === "tool" ? "tool" : msg.role, content: msg.content });
  }

  if (ctx.void.diagnostics) {
    messages.push({ role: "system", content: "--- Diagnostics ---\n" + ctx.void.diagnostics });
  }
  for (const tc of ctx.void.turnContext) {
    messages.push({ role: "system", content: `--- ${tc.label} ---\n${tc.content}` });
  }

  return messages;
}

function buildAgentLayer(ctx: SessionContext): string {
  const parts: string[] = [ctx.agent.activePersona];

  // Context Guide — part of agent identity
  parts.push(`
--- Context Guide ---
Your context has four layers:
• Agent: Your identity, tools, and rules. Do not repeat these back.
• Orbit: Project landscape — workspace map, plan, memory, skills. Reference for navigation.
• Drift: Active files — SUMMARIES ONLY. You do NOT have full file content. Use read_file() to access actual content before quoting or editing.
• Void: Conversation history and diagnostics.

Available systems:
• File Map: Shows all workspace files. Use read_file(path, offset, limit) for content.
• Plan: Persistent task tracker. Use plan() tool to add/backlog/complete/remove items. Priority: now/next/later.
• Memory: Long-term facts and preferences. Use save_memory() to store. Relevant memories are auto-surfaced.
• Skills: Technical guidelines loaded based on file context. Auto-managed by the harness.
• Schedule: Use schedule() tool to set timers or recurring tasks.
• Task Agents: Use run_task_agent() to delegate background work to specialized agents.

Files in Drift are summaries for awareness. Always call read_file(path, offset, limit) for real content.`);

  if (ctx.agent.boundSkills.length) {
    parts.push("\n--- Agent Skills ---\n" + ctx.agent.boundSkills.join("\n\n"));
  }
  if (ctx.agent.skillDiscoveryIndex.length) {
    parts.push("\n--- Available Skills ---\n" + ctx.agent.skillDiscoveryIndex.join("\n"));
  }
  return parts.join("\n");
}

function buildOrbitLayer(ctx: SessionContext): string | null {
  const parts: string[] = [];
  if (ctx.orbit.activeSkills.length) {
    parts.push("--- Active Skills ---\n" + ctx.orbit.activeSkills.join("\n\n"));
  }
  if (ctx.orbit.workspaceCodeMap) {
    parts.push("--- Workspace Map ---\n" + ctx.orbit.workspaceCodeMap);
  }
  if (ctx.orbit.activePlan) {
    parts.push("--- Active Plan ---\n" + ctx.orbit.activePlan);
  }
  if (ctx.orbit.activeMemory.length) {
    parts.push("--- Memory ---\n" + ctx.orbit.activeMemory.join("\n\n"));
  }
  return parts.length ? parts.join("\n\n") : null;
}

function buildDriftLayer(ctx: SessionContext): string | null {
  const parts: string[] = [];
  if (ctx.drift.focusedFiles.length) {
    for (const f of ctx.drift.focusedFiles) {
      parts.push(`--- Focused: ${f.path} (SUMMARY — use read_file for actual content) ---\n${f.summary}`);
    }
  }
  if (ctx.drift.gitStatus) {
    parts.push("--- Git Status ---\n" + ctx.drift.gitStatus);
  }
  return parts.length ? parts.join("\n\n") : null;
}
