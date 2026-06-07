import type { SessionContext, Message } from "./context.js";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

// Cache the template structure — shape is static, only slot values change
let _cachedTemplate: ChatPromptTemplate | null = null;

function getTemplate(): ChatPromptTemplate {
  if (_cachedTemplate) return _cachedTemplate;
  _cachedTemplate = ChatPromptTemplate.fromMessages([
    ["system", "{agent_layer}"],
    ["system", "{orbit_layer}"],
    ["system", "{drift_layer}"],
    new MessagesPlaceholder("history"),
  ]);
  return _cachedTemplate;
}

/**
 * Compiles context into LangChain BaseMessage[] using ChatPromptTemplate.
 *
 * Four layers ordered by ascending volatility:
 * 1. Agent  — identity, rules, Context Guide (never changes)
 * 2. Orbit  — project landscape (rarely changes)
 * 3. Drift  — active working set (changes on tool use)
 * 4. Void   — conversation history via MessagesPlaceholder (every turn)
 */
export async function compilePromptLC(ctx: SessionContext): Promise<BaseMessage[]> {
  const template = getTemplate();

  const formatted = await template.formatMessages({
    agent_layer: buildAgentLayer(ctx),
    orbit_layer: buildOrbitLayer(ctx),
    drift_layer: buildDriftLayer(ctx),
    history: buildHistory(ctx),
  });

  // Post-template volatile content (diagnostics, turn context)
  if (ctx.void.diagnostics) {
    formatted.push(new SystemMessage(`--- Diagnostics ---\n${ctx.void.diagnostics}`));
  }
  for (const tc of ctx.void.turnContext) {
    formatted.push(new SystemMessage(`--- ${tc.label} ---\n${tc.content}`));
  }

  return formatted;
}

// ─── Layer Builders ──────────────────────────────────────────────────────────

function buildAgentLayer(ctx: SessionContext): string {
  const parts: string[] = [ctx.agent.activePersona];

  // Context Guide — part of agent identity, never changes
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

function buildOrbitLayer(ctx: SessionContext): string {
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
  return parts.join("\n\n") || "(no orbit context)";
}

function buildDriftLayer(ctx: SessionContext): string {
  const parts: string[] = [];
  if (ctx.drift.focusedFiles.length) {
    for (const f of ctx.drift.focusedFiles) {
      parts.push(`--- Focused: ${f.path} (SUMMARY — use read_file for actual content) ---\n${f.summary}`);
    }
  }
  if (ctx.drift.gitStatus) {
    parts.push("--- Git Status ---\n" + ctx.drift.gitStatus);
  }
  return parts.join("\n\n") || "(no drift context)";
}

function buildHistory(ctx: SessionContext): BaseMessage[] {
  return ctx.void.messages.map((msg) => {
    switch (msg.role) {
      case "user": return new HumanMessage(msg.content);
      case "assistant": return new AIMessage(msg.content);
      default: return new HumanMessage(msg.content);
    }
  });
}

// ─── Legacy Path ─────────────────────────────────────────────────────────────

/**
 * Legacy compile — produces raw CompiledMessage[] for backward compatibility.
 * graph.ts uses this until fully migrated to compilePromptLC.
 */
export function compilePrompt(ctx: SessionContext): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  messages.push({ role: "system", content: buildAgentLayer(ctx) });

  const orbit = buildOrbitLayer(ctx);
  if (orbit !== "(no orbit context)") {
    messages.push({ role: "system", content: orbit });
  }

  const drift = buildDriftLayer(ctx);
  if (drift !== "(no drift context)") {
    messages.push({ role: "system", content: drift });
  }

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
