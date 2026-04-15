/**
 * Chat command: interactive session with Ink TUI (REQ-U-2).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import React from "react";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import { loadPrompt } from "../prompts.js";
import { findSkill } from "../skills.js";
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
import { IdeaSession } from "./idea.js";

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

    // Doc context
    if (options.doc) {
      const docPath = join(d, options.doc);
      if (existsSync(docPath)) {
        const docContent = readFileSync(docPath, "utf-8");
        parts.push(loadPrompt("chat", "DOC").replace("{doc_name}", options.doc).replace("{doc_content}", docContent));
      } else {
        parts.push(loadPrompt("chat", "DOC-NEW").replace(/{doc_name}/g, options.doc));
      }
    }

    // Memory index
    const mm = new MemoryManager(projectDir);
    const memIndex = mm.buildIndex();
    if (memIndex) parts.push(memIndex);

    // Git context
    const snap = captureGitSnapshot(projectDir);
    if (snap) parts.push(snapshotToPromptBlock(snap));

    systemPrompt = parts.filter(Boolean).join("\n\n");
  }

  // Build tools + agent
  const ctx = new WriteContext({ projectDir, maxReadLines: model.config.maxReadLines });
  const [tools, handlers] = buildLocalTools("chat", projectDir, ctx);
  const agent = new AgentLoop({
    model, systemPrompt, tools, toolHandlers: handlers,
    stream: true, maxTokens: getMaxTokens(model.config, "chat.session"),
    logPath: log, showSpinner: false, toolChoice: "auto",
  });

  // Session
  const session = ChatSession.loadOrCreate(d);
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
  if (session.entryCount > 0) {
    addSystem(state, `Resuming session (${session.entryCount} messages).`);
  }

  const ideaSession = new IdeaSession();
  const defaultPromptFn = (f: string, c: string[]) => "skip";

  // Callbacks
  agent.onToken = (token) => {
    const last = state.messages[state.messages.length - 1];
    if (last?.role === "model" && last.streaming) {
      updateLastModel(state, last.text + token, "", true);
    }
  };

  agent.onToolCall = (name, args) => {
    state.thinking = true;
    try {
      const a = JSON.parse(args || "{}");
      const action = a.action ?? "";
      const detail = a.path ?? a.url ?? a.cmd ?? a.name ?? "";
      addTool(state, name, detail, action);
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
      addSystem(state, "  /ask <q>        one-shot answer (no context)");
      addSystem(state, "  /clear          reset conversation");
      addSystem(state, "  /help           this list");
      addSystem(state, "  /quit           exit");
      return;
    }

    if (low.startsWith("/ask")) {
      const q = text.slice(4).trim();
      if (!q) { addSystem(state, "Usage: /ask <question>"); return; }
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

    // Input locking during commands
    if (state.busy && state.mode) {
      addSystem(state, "Command running — use /ask for questions.");
      return;
    }
    if (state.busy) {
      state.pendingMessage = text;
      return;
    }

    // Normal message → agent
    addOperator(state, text);
    session.append("user", text);
    addModel(state, "", "", true);
    state.thinking = true;
    state.busy = true;

    (async () => {
      try {
        const response = await agent.send(text);
        updateLastModel(state, response, "", false);
        session.append("assistant", response);
      } catch (e) {
        addSystem(state, `Error: ${e instanceof Error ? e.message : e}`);
      } finally {
        state.thinking = false;
        state.busy = false;
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
