import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { platform, release } from "os";
import type { SessionContext } from "./context.js";
import type { PromptRegistry } from "../prompts/registry.js";

export interface CompiledMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  contentBlocks?: import("./context.js").ContentBlock[];
}

export interface CompileOptions {
  workspaceRoot: string;
  modelName?: string;
  shell?: string;
  prompts?: PromptRegistry;
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
    messages.push({ role: msg.role === "tool" ? "tool" : msg.role, content: msg.content, contentBlocks: msg.contentBlocks });
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
  const r = opts?.prompts;

  // § Preamble — identity
  sections.push(ctx.agent.activePersona);

  // § Rules — behavioral constraints
  if (r) sections.push(r.resolve("core.rules")?.body ?? "");

  // § Environment — working dir, git, platform, model
  if (opts) sections.push(sectionEnvironment(opts));

  // § User Context — VOIDRIFT.md
  const userCtx = opts ? loadUserContext(opts.workspaceRoot) : null;
  if (userCtx) sections.push(userCtx);

  // § Skills
  if (ctx.agent.boundSkills.length) {
    sections.push("# Agent Skills\n" + ctx.agent.boundSkills.join("\n\n"));
  }

  return sections.join("\n\n");
}

// ─── § Context Guide ─────────────────────────────────────────────────────────

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
