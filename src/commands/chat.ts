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
import { wrapCommand, handleGather, handlePlan, handleDevelop, handleVerify } from "./slashCommands.js";
import { IdeaSession, readIdea, writeIdea, nextIdeaId, buildIdeaContent } from "./idea.js";
import { createPermissionGate, type PermCategory, type PermDecision } from "./permissions.js";

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

    // Memory index
    const memIndex = memMgr.buildIndex();
    if (memIndex) parts.push(memIndex);

    // Git context
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
  const askFn = (question: string, options?: string[]): string => {
    // Display question in TUI and return a default response
    // Full TUI integration would pause and wait for input
    addSystem(state, `❓ ${question}${options ? "\n" + options.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : ""}`);
    return options?.[0] ?? "Proceed with your best judgment.";
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
  let streamBuf = "";
  agent.onToken = (token: string) => {
    streamBuf += token;
    updateLastModel(state, streamBuf, "", true);
  };

  // Session
  const session = ChatSession.loadOrCreate(d);
  // Wire session handler now that session exists
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
  const recentFiles: string[] = []; // Track files read during session

  // Permission gate (REQ-U-22)
  const permGate = createPermissionGate();
  // Permission prompt — displayed as system message, waits for response
  // For now, use a simple sync approach via addSystem
  let pendingPermResolve: ((d: PermDecision) => void) | null = null;
  const permPromptFn = (category: PermCategory, description: string): PermDecision => {
    // In the TUI, we show the prompt and default to allow-once for now
    // Full TUI integration requires async input which we'll handle via the prompt
    return "allow-once";
  };
  agent.beforeToolCall = permGate.hook(projectDir, permPromptFn);
  if (session.entryCount > 0) {
    addSystem(state, `Resuming session (${session.entryCount} messages).`);
  }

  const ideaSession = new IdeaSession();
  const defaultPromptFn = (f: string, c: string[]) => "skip";

  // Callbacks
  agent.onProgress = (data) => {
    if (data.ctx_pct !== undefined) { state.contextPct = data.ctx_pct; state._notify?.(); }
  };
  agent.onToolCall = (name, args) => {
    state.thinking = true;
    state._notify?.();
    try {
      const a = JSON.parse(args || "{}");
      const action = a.action ?? "";
      const detail = a.path ?? a.url ?? a.cmd ?? a.name ?? "";
      addTool(state, name, detail, action);
      // Track file reads for post-compact restoration
      if (name === "file" && (action === "read" || action === "list") && a.path) {
        const resolved = join(projectDir, a.path);
        recentFiles.unshift(resolved);
        if (recentFiles.length > 10) recentFiles.length = 10;
      }
    } catch {
      addTool(state, name);
    }
  };

  // Submit handler
  const onSubmit = (text: string) => {
    const low = text.toLowerCase().trim();

    if (low === "/clear") {
      session.clear();
      agent.messages = [agent.messages[0]];
      state.messages = [];
      addSystem(state, "Session cleared.");
      return;
    }

    if (low === "/help") {
      addSystem(state, "Commands:");
      addSystem(state, "  /gather [path]  reverse-engineer requirements");
      addSystem(state, "  /plan           generate architecture + tasks");
      addSystem(state, "  /develop        execute tasks from manifest");
      addSystem(state, "  /verify         run acceptance tests");
      addSystem(state, "  /idea           guided idea refinement");
      addSystem(state, "  /compact        summarize context to free space");
      addSystem(state, "  /quick <q>      one-shot answer (no context)");
      addSystem(state, "  /clear          reset conversation");
      addSystem(state, "  /help           this list");
      addSystem(state, "  /quit           exit");
      return;
    }

    if (low.startsWith("/quick")) {
      const q = text.slice(6).trim();
      if (!q) { addSystem(state, "Usage: /quick <question>"); return; }
      // One-shot — not added to session
      addModel(state, "", "", true);
      state.busy = true;
      (async () => {
        try {
          const oneShot = new AgentLoop({
            model, systemPrompt: "Answer concisely.", tools: [], toolHandlers: {},
            stream: false, maxTokens: getMaxTokens(model.config, "chat.quick"), logPath: log, showSpinner: false,
          });
          const answer = await oneShot.send(q);
          updateLastModel(state, answer, "", false);
        } catch (e) { addSystem(state, `Ask failed: ${e}`); }
        finally { state.busy = false; }
      })();
      return;
    }

    if (low === "/compact") {
      if (agent.messages.length <= 2) { addSystem(state, "Nothing to compact."); return; }
      state.busy = true;
      addSystem(state, "Compacting context...");
      (async () => {
        try {
          const compacted = await compactor.compact(agent.messages, async (msgs, maxTok) => {
            const oneShot = new AgentLoop({ model, systemPrompt: msgs[0].content ?? "", tools: [], toolHandlers: {}, stream: false, maxTokens: maxTok, logPath: log, showSpinner: false });
            return oneShot.send(msgs[1].content ?? "");
          });
          agent.messages = compacted;
          session.appendCompaction(compacted[1]?.content ?? "");
          // Restoration (REQ-U-11)
          const maxRestore = Math.floor((model.config.maxContext ?? 100000) * 0.2 * 4); // ~20% of context in bytes
          const restoration = compactor.buildRestoration(recentFiles, [], maxRestore);
          if (restoration) agent.messages.push({ role: "system", content: restoration });
          addSystem(state, `Compacted to ${agent.messages.length} messages.`);
        } catch (e) { addSystem(state, `Compact failed: ${e}`); }
        finally { state.busy = false; state._notify?.(); }
      })();
      return;
    }

    if (low.startsWith("/gather")) {
      wrapCommand(handleGather, text.slice(7).trim(), model, state, defaultPromptFn, log);
      return;
    }
    if (low.startsWith("/plan")) {
      wrapCommand(handlePlan, text.slice(5).trim(), model, state, (f, c) => "update", log);
      return;
    }
    if (low.startsWith("/develop")) {
      wrapCommand(handleDevelop, text.slice(8).trim(), model, state, defaultPromptFn, log);
      return;
    }
    if (low.startsWith("/verify")) {
      wrapCommand(handleVerify, text.slice(7).trim(), model, state, defaultPromptFn, log);
      return;
    }

    // /idea [id] — start or resume idea refinement (REQ-IDEA-1)
    if (low.startsWith("/idea")) {
      const arg = text.slice(5).trim();
      if (ideaSession.isActive()) { addSystem(state, "Idea session already active. Type /done to finish."); return; }
      const id = arg ? parseInt(arg, 10) : null;
      if (id !== null && isNaN(id)) { addSystem(state, "Usage: /idea [id]"); return; }
      if (id) {
        const content = readIdea(projectDir, id);
        if (!content) { addSystem(state, `IDEA-${id} not found.`); return; }
        ideaSession.start(id);
        state.mode = "/idea"; state._notify?.();
        addSystem(state, `Loaded IDEA-${id}. Describe what to refine, or /done to save.`);
        state.busy = true; state.thinking = true; state._notify?.();
        (async () => {
          try {
            streamBuf = ""; addModel(state, "", "", true);
            const r = await agent.send(`I'm resuming work on this idea:\n\n${content}\n\nSummarize the current state and ask what I'd like to refine.`);
            updateLastModel(state, r, "", false);
          } catch (e) { addSystem(state, `Error: ${e}`); }
          finally { state.thinking = false; state.busy = false; state._notify?.(); }
        })();
      } else {
        const newId = nextIdeaId(projectDir);
        ideaSession.start(newId);
        state.mode = "/idea"; state._notify?.();
        addSystem(state, `New idea IDEA-${newId}. Describe your idea — the agent will guide you. /done to save.`);
      }
      return;
    }

    // /done [category] — save idea (REQ-IDEA-3)
    if (low.startsWith("/done")) {
      if (!ideaSession.isActive()) { addSystem(state, "No active idea session."); return; }
      const cat = text.slice(5).trim().toLowerCase() || "now";
      if (!["now", "next", "later"].includes(cat)) { addSystem(state, "Category: now, next, or later"); return; }
      const id = ideaSession.ideaId ?? nextIdeaId(projectDir);
      state.busy = true; state.thinking = true; state._notify?.();
      (async () => {
        try {
          streamBuf = ""; addModel(state, "", "", true);
          const summary = await agent.send("Produce a structured idea summary: Title, User Story, Acceptance Criteria, Affected Modules, Affected Files. Markdown format.");
          updateLastModel(state, summary, "", false);
          writeIdea(projectDir, id, buildIdeaContent(`IDEA-${id}`, summary, cat as "now" | "next" | "later"));
          ideaSession.cancel();
          state.mode = ""; addSystem(state, `Saved IDEA-${id} as "${cat}".`);
        } catch (e) { addSystem(state, `Error: ${e}`); }
        finally { state.thinking = false; state.busy = false; state._notify?.(); }
      })();
      return;
    }

    // /chat — reset mode (REQ-U-2a)
    if (low === "/chat") { state.mode = ""; state._notify?.(); return; }

    // Input locking during commands
    if (state.busy && state.mode) {
      addSystem(state, "Command running — use /quick for questions.");
      return;
    }
    if (state.busy) {
      state.pendingMessage = text;
      return;
    }

    // Normal message → agent
    addOperator(state, text);
    session.append("user", text);
    state.thinking = true;
    state.busy = true;
    state._notify?.();

    (async () => {
      try {
        // Auto-compact check (REQ-U-10)
        if (compactor.shouldAutoCompact(state.contextPct * (model.config.maxContext ?? 0) / 100)) {
          addSystem(state, "Auto-compacting context...");
          const compacted = await compactor.compact(agent.messages, async (msgs, maxTok) => {
            const oneShot = new AgentLoop({ model, systemPrompt: msgs[0].content ?? "", tools: [], toolHandlers: {}, stream: false, maxTokens: maxTok, logPath: log, showSpinner: false });
            return oneShot.send(msgs[1].content ?? "");
          });
          agent.messages = compacted;
          session.appendCompaction(compacted[1]?.content ?? "");
          addSystem(state, `Auto-compacted to ${agent.messages.length} messages.`);
        } else if (compactor.shouldNudge(state.contextPct * (model.config.maxContext ?? 0) / 100)) {
          addSystem(state, "Context is filling up. Type /compact to free space.");
        }
        streamBuf = "";
        addModel(state, "", "", true); // Start streaming placeholder
        const response = await agent.send(text);
        updateLastModel(state, response, "", false); // Finalize
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
        state.thinking = false;
        state.busy = false;
        state._notify?.();
        // Dispatch pending
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
