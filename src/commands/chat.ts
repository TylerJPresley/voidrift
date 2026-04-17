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
import { IdeaSession } from "./idea.js";
import { createPermissionGate, type PermCategory, type PermDecision } from "../tools/permissions.js";
import { type ChatContext, wrapCommand, type PromptFn } from "./base.js";

// Regions
import { HeaderRegion } from "../tui/regions/HeaderRegion.js";
import { ContentRegion } from "../tui/regions/ContentRegion.js";
import { FooterRegion } from "../tui/regions/FooterRegion.js";
import { InputRegion } from "../tui/regions/InputRegion.js";

// Commands
import { HelpCommand } from "./help.js";
import { ClearCommand } from "./clear.js";
import { AskCommand } from "./ask.js";
import { CompactCommand } from "./compact.js";
import { SettingsCommand } from "./settings.js";
import { ModelCommand } from "./model.js";
import { IdeaStartCommand, IdeaDoneCommand } from "./idea.js";

import { App } from "../tui/App.js";

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

  if (options.doc) {
    const docPath = join(d, options.doc);
    if (existsSync(docPath)) {
      const docContent = readFileSync(docPath, "utf-8");
      systemPrompt += "\n\n" + (loadPrompt("chat", "DOC")?.replace("{doc_name}", options.doc).replace("{doc_content}", docContent) ?? docContent);
    } else {
      systemPrompt += "\n\n" + (loadPrompt("chat", "DOC-NEW")?.replace(/{doc_name}/g, options.doc) ?? `Document ${options.doc} does not exist yet.`);
    }
  }

  // Regions
  const header = new HeaderRegion();
  const content = new ContentRegion();
  const footer = new FooterRegion();
  const input = new InputRegion();

  const branch = captureGitSnapshot(projectDir)?.branch ?? "";
  const cwd = projectDir.replace(require("os").homedir(), "~");
  header.modelName = model.config.alias;
  footer.modelName = model.config.alias;
  footer.cwd = cwd;
  footer.branch = branch;

  // Tools + agent
  const ctx = new WriteContext({ projectDir, maxReadLines: model.config.maxReadLines });
  const webCache = new Map<string, string>();
  const askFn = (question: string, opts?: string[]): string => {
    content.addSystem(`❓ ${question}${opts ? "\n" + opts.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : ""}`);
    return opts?.[0] ?? "Proceed with your best judgment.";
  };
  const [tools, handlers] = buildLocalTools("chat", projectDir, ctx, {
    memoryManager: memMgr, webFetchKwargs: { model, logPath: log, webCache, allowList: [] }, askFn,
  });

  const agent = new AgentLoop({
    model, systemPrompt, tools, toolHandlers: handlers,
    stream: true, maxTokens: getMaxTokens(model.config, "chat.session"),
    logPath: log, showSpinner: false, toolChoice: "auto",
  });

  // Streaming
  const streamBuf = { value: "" };
  agent.onToken = (token: string) => { streamBuf.value += token; content.updateLastModel(streamBuf.value, "", true); };
  agent.onProgress = (data) => { if (data.ctx_pct !== undefined) footer.setContext(data.ctx_pct); };
  agent.onToolCall = (name, args) => {
    content.setThinking(true);
    try {
      const a = JSON.parse(args || "{}");
      content.addTool(name, a.path ?? a.url ?? a.cmd ?? a.name ?? "", a.action ?? "");
      if (name === "file" && (a.action === "read" || a.action === "list") && a.path) {
        recentFiles.unshift(join(projectDir, a.path));
        if (recentFiles.length > 10) recentFiles.length = 10;
      }
    } catch { content.addTool(name); }
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
    agent.messages.push(...session.restoreMessages());
    agent.messages.push({ role: "user", content: "Session history restored. Treat it as background context only — do not continue previous actions or reference previous conversation unless I ask about it. Wait for new instructions." });
    agent.messages.push({ role: "assistant", content: "Understood. What would you like to work on?" });
    header.setHasMessages(true);
  }

  // Context compactor
  const compactPrompt = loadPrompt("chat", "COMPACT") ?? "Summarize the conversation preserving key decisions, file changes, and next steps.";
  const compactor = new ContextCompactor({
    maxContext: model.config.maxContext ?? 0, compactPrompt,
    logFn: (msg) => { try { appendFileSync(log, msg + "\n"); } catch { /* */ } },
  });
  const recentFiles: string[] = [];

  // Permission gate
  const permGate = createPermissionGate();
  agent.beforeToolCall = permGate.hook(projectDir, () => "allow-once");

  const ideaSession = new IdeaSession();
  const defaultPromptFn: PromptFn = () => "skip";

  // Chat context for slash commands
  const chatCtx: ChatContext = { model, agent, header, content, footer, input, session, compactor, ideaSession, projectDir, logPath: log, recentFiles, streamBuf };

  // Framework command handlers
  const handleGather = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runGather } = await import("./gather.js");
    c.addSystem(`Gathering from ${a || process.cwd()}`);
    const r = await runGather(mc, a || process.cwd());
    c.addSystem(r === 0 ? "✓ Gather complete" : "✗ Gather failed");
  };
  const handlePlan = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runPlan } = await import("./plan.js");
    c.addSystem("Running plan..."); const r = await runPlan(mc, a === "overwrite"); c.addSystem(r === 0 ? "✓ Plan complete" : "✗ Plan failed");
  };
  const handleDevelop = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runDevelop } = await import("./develop.js");
    c.addSystem("Running develop..."); const r = await runDevelop(mc); c.addSystem(r === 0 ? "✓ Develop complete" : "✗ Develop failed");
  };
  const handleVerify = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runVerify } = await import("./verify.js");
    c.addSystem("Running verify..."); const r = await runVerify(mc); c.addSystem(r === 0 ? "✓ Verify complete" : "✗ Verify failed");
  };
  const handleDeploy = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runDeploy } = await import("./deploy.js");
    c.addSystem("Running deploy..."); const r = await runDeploy(mc); c.addSystem(r === 0 ? "✓ Deploy complete" : "✗ Deploy failed");
  };

  // Wrap framework handlers to match wrapCommand signature
  const wrap = (fn: (a: string, mc: ModelInterface, c: ContentRegion) => Promise<void>) =>
    async (args: string, mc: ModelInterface, c: ContentRegion, f: FooterRegion, i: InputRegion, pf: PromptFn, l: string) => fn(args, mc, c);

  // Slash command routing
  const onSubmit = (text: string) => {
    const low = text.toLowerCase().trim();

    if (low === "/help") { new HelpCommand(chatCtx).run(); return; }
    if (low === "/clear") { new ClearCommand(chatCtx).run(); return; }
    if (low.startsWith("/ask")) { new AskCommand(chatCtx, text.slice(4).trim()).run(); return; }
    if (low === "/compact") { new CompactCommand(chatCtx).run(); return; }
    if (low.startsWith("/settings")) { new SettingsCommand(chatCtx, text.slice(9).trim()).run(); return; }
    if (low.startsWith("/model")) { new ModelCommand(chatCtx, text.slice(6).trim()).run(); return; }
    if (low.startsWith("/idea")) { new IdeaStartCommand(chatCtx, text.slice(5).trim()).run(); return; }
    if (low.startsWith("/done")) { new IdeaDoneCommand(chatCtx, text.slice(5).trim().toLowerCase()).run(); return; }
    if (low === "/chat") { footer.setMode(""); return; }

    if (low.startsWith("/gather")) { wrapCommand(wrap(handleGather), text.slice(7).trim(), model, chatCtx, defaultPromptFn, log); return; }
    if (low.startsWith("/plan")) { wrapCommand(wrap(handlePlan), text.slice(5).trim(), model, chatCtx, defaultPromptFn, log); return; }
    if (low.startsWith("/develop")) { wrapCommand(wrap(handleDevelop), text.slice(8).trim(), model, chatCtx, defaultPromptFn, log); return; }
    if (low.startsWith("/verify")) { wrapCommand(wrap(handleVerify), text.slice(7).trim(), model, chatCtx, defaultPromptFn, log); return; }
    if (low.startsWith("/deploy")) { wrapCommand(wrap(handleDeploy), text.slice(7).trim(), model, chatCtx, defaultPromptFn, log); return; }

    if (input.busy && footer.mode) { content.addSystem("Command running — use /ask for questions."); return; }
    if (input.busy) { input.setPending(text); return; }

    // Normal message → agent
    content.addOperator(text);
    header.setInteracted();
    session.append("user", text);
    content.setThinking(true);
    input.setBusy(true);

    (async () => {
      try {
        if (compactor.shouldAutoCompact(footer.contextPct * (model.config.maxContext ?? 0) / 100)) {
          content.addSystem("Auto-compacting context...");
          await new CompactCommand(chatCtx).execute();
        } else if (compactor.shouldNudge(footer.contextPct * (model.config.maxContext ?? 0) / 100)) {
          content.addSystem("Context is filling up. Type /compact to free space.");
        }
        streamBuf.value = "";
        content.addModel("", "", true);
        const response = await agent.send(text);
        content.updateLastModel(response.trim() ? response : "(No response from model)", "", false);
        session.append("assistant", response);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const name = (e as Record<string, unknown>)?.constructor?.name ?? "";
        if (name === "APIConnectionError" || msg.includes("Connection error")) {
          content.addSystem(`Cannot connect to ${model.config.baseUrl} — is the model/gateway running?`);
        } else {
          content.addSystem(`Error: ${msg}`);
        }
      } finally {
        content.setThinking(false);
        input.setBusy(false);
        if (input.pendingMessage) {
          const pending = input.pendingMessage;
          input.setPending(null);
          onSubmit(pending);
        }
      }
    })();
  };

  // Render TUI
  const { waitUntilExit } = render(
    React.createElement(App, { header, content, footer, input, onSubmit, onEscape: () => input.setPending(null) }),
  );
  await waitUntilExit();
}
