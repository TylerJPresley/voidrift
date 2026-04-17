/**
 * Chat command: interactive session with Ink TUI (REQ-U-2).
 */

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import React from "react";

// OCP contract (REQ-TOOL-8, REQ-ARCH-9)
export const AGENT_TOOLS = new Set(["file", "http", "shell", "skill", "memory", "session", "analyze", "ask"]);
export const AGENT_TOOL_ACTIONS: Record<string, string[]> = { file: ["read", "write", "edit", "delete", "list"], http: ["get", "post", "put", "delete"] };

import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import { loadPrompt } from "../prompts.js";
import { findSkill } from "../skills.js";
import { ContextCompactor } from "../agent/context.js";
import { ensureVoidriftDir, bootRun } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { buildLocalTools } from "../tools/builder.js";
import { WriteContext } from "../tools/filesystem.js";
import { ChatSession } from "../session.js";
import { MemoryManager } from "../memory.js";
import { captureGitSnapshot, snapshotToPromptBlock } from "../git.js";
import { createState, addOperator, addModel, addTool, addSystem, updateLastModel, type TUIState } from "../tui/state.js";
import { App } from "../tui/App.js";
import { IdeaSession } from "./idea.js";
import { createPermissionGate, type PermCategory, type PermDecision } from "./permissions.js";
import {
  type ChatContext,
  HelpCommand, ClearCommand, QuickCommand, CompactCommand,
  IdeaStartCommand, IdeaDoneCommand,
  wrapCommand, handleGather, handlePlan, handleDevelop, handleVerify, handleDeploy,
} from "./slashCommands.js";

interface ChatOptions {
  doc?: string;
  style?: "verbose" | "terse" | "raw";
  bare?: boolean;
  systemPrompt?: string;
}

export async function runChat(model: ModelInterface, options: ChatOptions = {}): Promise<void> {
  const d = ensureVoidriftDir();
  const projectDir = join(d, "..");
  const [log, runId] = bootRun("chat");

  // Build system prompt (REQ-RES-7)
  const memMgr = new MemoryManager(projectDir);
  let systemPrompt: string;
  if (options.bare && options.systemPrompt) {
    systemPrompt = readFileSync(options.systemPrompt, "utf-8");
  } else if (options.bare) {
    systemPrompt = loadPrompt("system", "CONTEXT");
  } else {
    const parts = [loadPrompt("system", "CONTEXT")];
    const skill = findSkill("ANALYSIS-REQS");
    if (skill) parts.push(skill);
    parts.push(loadPrompt("chat", "SYSTEM"));
    const memIndex = memMgr.buildIndex();
    if (memIndex) parts.push(memIndex);
    const snap = captureGitSnapshot(projectDir);
    if (snap) parts.push(snapshotToPromptBlock(snap));
    systemPrompt = parts.filter(Boolean).join("\n\n");
  }

  // Doc context — works in all modes including bare (REQ-U-17)
  if (options.doc) {
    const docPath = join(d, options.doc);
    if (existsSync(docPath)) {
      const docContent = readFileSync(docPath, "utf-8");
      const docBlock = loadPrompt("chat", "DOC")?.replace("{doc_name}", options.doc).replace("{doc_content}", docContent) ?? `## ${options.doc}\n\n${docContent}`;
      systemPrompt += "\n\n" + docBlock;
    } else {
      const newBlock = loadPrompt("chat", "DOC-NEW")?.replace(/{doc_name}/g, options.doc) ?? `Document ${options.doc} does not exist yet.`;
      systemPrompt += "\n\n" + newBlock;
    }
  }

  // Build tools + agent
  const ctx = new WriteContext({ projectDir, maxReadLines: model.config.maxReadLines });
  const webCache = new Map<string, string>();
  const askFn = (question: string, opts?: string[]): string => {
    addSystem(state, `❓ ${question}${opts ? "\n" + opts.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : ""}`);
    return opts?.[0] ?? "Proceed with your best judgment.";
  };
  const [tools, handlers] = buildLocalTools("chat", projectDir, ctx, {
    memoryManager: memMgr,
    webFetchKwargs: { model, logPath: log, webCache, allowList: [] },
    askFn,
  });

  const agent = new AgentLoop({
    model, systemPrompt, tools, toolHandlers: handlers,
    stream: true, maxTokens: getMaxTokens(model.config, "chat.session"),
    logPath: log, showSpinner: false, toolChoice: "auto",
  });

  // Streaming token buffer
  const streamBuf = { value: "" };
  agent.onToken = (token: string) => {
    streamBuf.value += token;
    updateLastModel(state, streamBuf.value, "", true);
  };

  // Session
  const session = ChatSession.loadOrCreate(d);
  handlers.session = ((action: unknown, query: unknown, limit: unknown) => {
    if (String(action) === "search") {
      const results = session.searchEntries(String(query), limit ? Number(limit) : 5);
      if (!results.length) return "No matches found.";
      return results.map((r: { timestamp: string; role: string; content: string }) => `[${r.timestamp}] ${r.role}: ${r.content}`).join("\n\n");
    }
    return `Unknown session action: ${action}`;
  }) as (...args: unknown[]) => string;

  if (session.entryCount > 0) {
    const restored = session.restoreMessages();
    agent.messages.push(...restored);
    if (session.shouldInjectGapMarker()) {
      agent.messages.push({ role: "user", content: "Session resumed. Do not continue previous actions — wait for new instructions." });
      agent.messages.push({ role: "assistant", content: "Understood. What would you like to work on?" });
    }
  }

  // TUI state
  const branch = captureGitSnapshot(projectDir)?.branch ?? "";
  const cwd = projectDir.replace(require("os").homedir(), "~");
  const state = createState(model.config.alias, cwd, branch);

  // Context compactor (REQ-U-7, REQ-U-10)
  const compactPrompt = loadPrompt("chat", "COMPACT") ?? "Summarize the conversation preserving key decisions, file changes, and next steps.";
  const compactor = new ContextCompactor({
    maxContext: model.config.maxContext ?? 0,
    compactPrompt,
    logFn: (msg) => { try { appendFileSync(log, msg + "\n"); } catch { /* */ } },
  });
  const recentFiles: string[] = [];

  // Permission gate (REQ-U-22)
  const permGate = createPermissionGate();
  const permPromptFn = (category: PermCategory, description: string): PermDecision => "allow-once";
  agent.beforeToolCall = permGate.hook(projectDir, permPromptFn);

  if (session.entryCount > 0) addSystem(state, `Resuming session (${session.entryCount} messages).`);

  const ideaSession = new IdeaSession();
  const defaultPromptFn = (f: string, c: string[]) => "skip";

  // Shared context for slash commands
  const chatCtx: ChatContext = { model, agent, state, session, compactor, ideaSession, projectDir, logPath: log, recentFiles, streamBuf };

  // Callbacks
  agent.onProgress = (data) => {
    if (data.ctx_pct !== undefined) { state.contextPct = data.ctx_pct; state._notify?.(); }
  };
  agent.onToolCall = (name, args) => {
    state.thinking = true; state._notify?.();
    try {
      const a = JSON.parse(args || "{}");
      const action = a.action ?? "";
      const detail = a.path ?? a.url ?? a.cmd ?? a.name ?? "";
      addTool(state, name, detail, action);
      if (name === "file" && (action === "read" || action === "list") && a.path) {
        const resolved = join(projectDir, a.path);
        recentFiles.unshift(resolved);
        if (recentFiles.length > 10) recentFiles.length = 10;
      }
    } catch { addTool(state, name); }
  };

  // ---------------------------------------------------------------------------
  // Slash command routing
  // ---------------------------------------------------------------------------

  const onSubmit = (text: string) => {
    const low = text.toLowerCase().trim();

    // Slash command dispatch
    if (low === "/help") { new HelpCommand(chatCtx).run(); return; }
    if (low === "/clear") { new ClearCommand(chatCtx).run(); return; }
    if (low.startsWith("/quick")) { new QuickCommand(chatCtx, text.slice(6).trim()).run(); return; }
    if (low === "/compact") { new CompactCommand(chatCtx).run(); return; }
    if (low.startsWith("/idea")) { new IdeaStartCommand(chatCtx, text.slice(5).trim()).run(); return; }
    if (low.startsWith("/done")) { new IdeaDoneCommand(chatCtx, text.slice(5).trim().toLowerCase()).run(); return; }
    if (low === "/chat") { state.mode = ""; state._notify?.(); return; }

    // Framework command dispatch (background thread via wrapCommand)
    if (low.startsWith("/gather")) { wrapCommand(handleGather, text.slice(7).trim(), model, state, defaultPromptFn, log); return; }
    if (low.startsWith("/plan")) { wrapCommand(handlePlan, text.slice(5).trim(), model, state, (f, c) => "update", log); return; }
    if (low.startsWith("/develop")) { wrapCommand(handleDevelop, text.slice(8).trim(), model, state, defaultPromptFn, log); return; }
    if (low.startsWith("/verify")) { wrapCommand(handleVerify, text.slice(7).trim(), model, state, defaultPromptFn, log); return; }
    if (low.startsWith("/deploy")) { wrapCommand(handleDeploy, text.slice(7).trim(), model, state, defaultPromptFn, log); return; }

    // Input locking during commands
    if (state.busy && state.mode) { addSystem(state, "Command running — use /quick for questions."); return; }
    if (state.busy) { state.pendingMessage = text; return; }

    // Normal message → agent
    addOperator(state, text);
    session.append("user", text);
    state.thinking = true; state.busy = true; state._notify?.();

    (async () => {
      try {
        // Auto-compact check (REQ-U-10)
        if (compactor.shouldAutoCompact(state.contextPct * (model.config.maxContext ?? 0) / 100)) {
          addSystem(state, "Auto-compacting context...");
          await new CompactCommand(chatCtx).execute();
        } else if (compactor.shouldNudge(state.contextPct * (model.config.maxContext ?? 0) / 100)) {
          addSystem(state, "Context is filling up. Type /compact to free space.");
        }
        streamBuf.value = "";
        addModel(state, "", "", true);
        const response = await agent.send(text);
        const displayText = response.trim() ? response : "(No response from model)";
        updateLastModel(state, displayText, "", false);
        session.append("assistant", response);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const name = (e as Record<string, unknown>)?.constructor?.name ?? "";
        if (name === "APIConnectionError" || msg.includes("Connection error")) {
          addSystem(state, `Cannot connect to ${model.config.baseUrl} — is the model/gateway running?`);
        } else {
          addSystem(state, `Error: ${msg}`);
        }
      } finally {
        state.thinking = false; state.busy = false; state._notify?.();
        if (state.pendingMessage) {
          const pending = state.pendingMessage;
          state.pendingMessage = null;
          onSubmit(pending);
        }
      }
    })();
  };

  // Render TUI
  const { waitUntilExit } = render(
    React.createElement(App, { state, onSubmit, onEscape: () => { state.pendingMessage = null; } }),
  );
  await waitUntilExit();
}
