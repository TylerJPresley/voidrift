import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { platform, release } from "os";
import type { SessionContext } from "./context.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CompileOptions {
  workspaceRoot: string;
  modelName?: string;
  shell?: string;
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
export function compilePrompt(ctx: SessionContext, opts?: CompileOptions): CompiledMessage[] {
  const messages: CompiledMessage[] = [];

  // Layer 1: Agent (session-locked cache anchor)
  messages.push({ role: "system", content: buildAgentLayer(ctx, opts) });

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

// ─── Agent Layer Composition ─────────────────────────────────────────────────

function buildAgentLayer(ctx: SessionContext, opts?: CompileOptions): string {
  const sections: string[] = [];

  // § Preamble — identity
  sections.push(ctx.agent.activePersona);

  // § Context Guide
  sections.push(sectionContextGuide());

  // § Rules — behavioral constraints
  sections.push(sectionRules());

  // § Tool Usage — context efficiency, parallel calls
  sections.push(sectionToolUsage());

  // § Environment — working dir, git, platform, model
  if (opts) sections.push(sectionEnvironment(opts));

  // § User Context — VOIDRIFT.md
  const userCtx = opts ? loadUserContext(opts.workspaceRoot) : null;
  if (userCtx) sections.push(userCtx);

  // § Skills
  if (ctx.agent.boundSkills.length) {
    sections.push("# Agent Skills\n" + ctx.agent.boundSkills.join("\n\n"));
  }
  if (ctx.agent.skillDiscoveryIndex.length) {
    sections.push("# Available Skills\n" + ctx.agent.skillDiscoveryIndex.join("\n"));
  }

  return sections.join("\n\n");
}

// ─── § Context Guide ─────────────────────────────────────────────────────────

function sectionContextGuide(): string {
  return `# Context Guide

Your context has four layers:
• Agent: Your identity, tools, and rules. Do not repeat these back.
• Orbit: Project landscape — file map, plan, memory, skills.
• Drift: Active files — SUMMARIES ONLY. Use read_file() for actual content.
• Void: Conversation history.

Available systems: File Map (workspace structure), Plan (plan tool), Memory (save_memory tool), Skills (auto-loaded), Schedule (schedule tool), Task Agents (run_task_agent tool).

Files in Drift are summaries. Always call read_file(path, offset, limit) for real content before quoting or editing.`;
}

// ─── § Rules ─────────────────────────────────────────────────────────────────

function sectionRules(): string {
  return `# Rules

## Directive vs Inquiry
Distinguish between **Directives** (explicit requests for action) and **Inquiries** (questions, analysis, opinions).
- Assume requests are Inquiries unless they contain an explicit instruction to implement, fix, create, or modify.
- For Inquiries: research and respond. Do NOT modify files until a Directive is issued.
- For Directives: work autonomously. Only clarify if critically underspecified.

## Standards
- Follow existing conventions, patterns, and structure in the workspace.
- Never assume a tool, library, or framework is available — verify first.
- Read files before modifying them. Understand existing content before suggesting changes.
- Prefer editing existing files over creating new ones.
- Do not add scope beyond what was requested.
- Do not revert changes unless explicitly asked. Fix forward.

## Retry Protocol
If an approach has failed 3 times:
1. Stop and restate the original goal.
2. List your current assumptions and identify which may be wrong.
3. Propose a fundamentally different approach rather than patching the current one.

## Safety
- Never expose secrets, API keys, or credentials in file content.
- For destructive or hard-to-reverse actions, explain the action and wait for confirmation.
- Match the scope of actions to what was actually requested.

## Conciseness
- Be direct and concise. Aim for minimal text output outside of tool use.
- No conversational filler, preambles ("I'll now..."), or postambles ("I've finished...").
- Use tools for actions. Use text only for communication.
- After completing a task, provide a brief summary — not a play-by-play.`;
}

// ─── § Tool Usage ────────────────────────────────────────────────────────────

function sectionToolUsage(): string {
  return `# Tool Usage

## Context Efficiency
Minimize unnecessary context consumption while maintaining quality:
- Prefer glob/grep to identify relevant files before reading them in full.
- For large files, use offset/limit for targeted reads. Read only what you need.
- If a file is small (< 1000 lines), read it fully rather than making multiple partial reads.
- Combine independent tool calls in parallel. Sequential only when one depends on another's result.
- Do not re-read files you have already read in the same turn unless they may have changed.

## Tool Preferences
- Read files: use read_file (not execute_command with cat/head)
- Edit files: use edit_file (not execute_command with sed)
- Search files: use glob_files (not execute_command with find)
- Reserve execute_command for shell operations that have no dedicated tool equivalent.

## Parallel Execution
Call multiple independent tools in a single response. Only use sequential calls when a result is needed as input to the next call.`;
}

// ─── § Environment ───────────────────────────────────────────────────────────

function sectionEnvironment(opts: CompileOptions): string {
  const isGit = existsSync(join(opts.workspaceRoot, ".git"));
  const shell = opts.shell || process.env.SHELL || "unknown";
  const lines = [
    `# Environment`,
    `- Working directory: ${opts.workspaceRoot}`,
    `- Git repository: ${isGit ? "Yes" : "No"}`,
    `- Platform: ${platform()}`,
    `- OS: ${platform()} ${release()}`,
    `- Shell: ${shell}`,
  ];
  if (opts.modelName) lines.push(`- Model: ${opts.modelName}`);
  return lines.join("\n");
}

// ─── § User Context (VOIDRIFT.md) ────────────────────────────────────────────

function loadUserContext(workspaceRoot: string): string | null {
  const candidates = [
    join(workspaceRoot, "VOIDRIFT.md"),
    join(workspaceRoot, ".voidrift", "VOIDRIFT.md"),
  ];
  // Also check global context
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) candidates.push(join(home, ".config", "voidrift", "VOIDRIFT.md"));

  const contents: string[] = [];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const text = readFileSync(path, "utf-8").trim();
        if (text) contents.push(text);
      } catch { /* skip unreadable */ }
    }
  }
  if (!contents.length) return null;
  return `# User Context (VOIDRIFT.md)\nThe following instructions take precedence over general system prompt rules.\n\n${contents.join("\n\n---\n\n")}`;
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
