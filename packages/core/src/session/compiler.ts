import type { SessionContext, Message } from "./context.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Prompt Cache Optimizer.
 * Serializes context in ascending volatility order to maximize provider cache prefix hits:
 * 1. Governance (least volatile — persona, mode, skills)
 * 2. Workspace (semi-dynamic — plan, code map, focused files, memory)
 * 3. Work (most volatile — messages, diagnostics)
 */
export function compilePrompt(ctx: SessionContext): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  // 1. Governance partition (static system prompt — cached prefix)
  const systemParts: string[] = [ctx.governance.activePersona];
  if (ctx.governance.activeSkills.length) {
    systemParts.push("\n--- Skills ---\n" + ctx.governance.activeSkills.join("\n\n"));
  }
  messages.push({ role: "system", content: systemParts.join("\n") });

  // 2. Workspace partition (semi-dynamic — changes less frequently)
  const workspaceParts: string[] = [];
  if (ctx.workspace.workspaceCodeMap) {
    workspaceParts.push("--- Workspace Map ---\n" + ctx.workspace.workspaceCodeMap);
  }
  if (ctx.workspace.activePlan) {
    workspaceParts.push("--- Active Plan ---\n" + ctx.workspace.activePlan);
  }
  if (ctx.workspace.focusedFiles.length) {
    for (const f of ctx.workspace.focusedFiles) {
      workspaceParts.push(`--- Focused: ${f.path} ---\n${f.summary}`);
    }
  }
  if (ctx.workspace.activeMemory.length) {
    workspaceParts.push("--- Memory ---\n" + ctx.workspace.activeMemory.join("\n\n"));
  }
  if (ctx.workspace.gitStatus) {
    workspaceParts.push("--- Git Status ---\n" + ctx.workspace.gitStatus);
  }
  if (workspaceParts.length) {
    messages.push({ role: "system", content: workspaceParts.join("\n\n") });
  }

  // 3. Work partition (most volatile — conversation history)
  for (const msg of ctx.work.messages) {
    messages.push({ role: msg.role === "tool" ? "tool" : msg.role, content: msg.content });
  }

  // Diagnostics appended at the very end (most volatile)
  if (ctx.work.diagnostics) {
    messages.push({ role: "system", content: "--- Diagnostics ---\n" + ctx.work.diagnostics });
  }

  return messages;
}
