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
import { buildGovernanceLayer, loadSharedGovernance, checkGovernanceBudget, trimGovernanceToFit, getGovernanceMaxTokens, type GovernanceParts } from "../governance.js";
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
import { statsStr } from "./progress.js";

import { App } from "../tui/App.js";

// ---------------------------------------------------------------------------
// Mode definitions (REQ-CHAT-15)
// ---------------------------------------------------------------------------

/** A chat mode defines personality, skills, and an optional steering message. */
export interface ChatMode {
  /** Prompt section name in chat.md for this mode's personality. */
  personalitySection: string;
  /** Skill names to load for this mode. */
  skills: string[];
  /** One-line steering message injected into work layer on switch. */
  steeringMessage: string;
}

/** Mode definitions keyed by slash command name. */
export const MODE_DEFS: Record<string, ChatMode> = {
  chat:   { personalitySection: "SYSTEM", skills: ["ANALYSIS-REQS"], steeringMessage: "Operating as interactive assistant." },
  plan:   { personalitySection: "PLAN",   skills: ["ARCH-DESIGN"],   steeringMessage: "Operating as planning agent." },
  gather: { personalitySection: "GATHER", skills: ["ANALYSIS-REQS"], steeringMessage: "Operating as requirements agent." },
  idea:   { personalitySection: "IDEA",   skills: ["ANALYSIS-REQS"], steeringMessage: "Operating as idea refinement agent." },
};

interface ChatOptions {
  doc?: string;
  bare?: boolean;
  systemPrompt?: string;
  ref?: string;
}

export async function runChat(model: ModelInterface | null, options: ChatOptions = {}): Promise<void> {
  const d = ensureVoidriftDir();
  const projectDir = join(d, "..");
  const [log, runId] = bootRun("chat");

  // Build governance layer (REQ-CHAT-14, REQ-ARCH-19)
  const memMgr = new MemoryManager(projectDir);
  let systemPrompt: string;
  let governanceTokens = 0;
  let currentMode = "chat";

  // Shared governance parts — constant across mode switches (REQ-CHAT-15)
  let sharedGovParts: Omit<GovernanceParts, "personality" | "skills"> | null = null;
  const maxCtx = model?.config.maxContext ?? 0;

  if (options.bare && options.systemPrompt) {
    systemPrompt = readFileSync(options.systemPrompt, "utf-8");
  } else if (options.bare) {
    systemPrompt = loadPrompt("system", "CONTEXT");
  } else {
    const shared = loadSharedGovernance(projectDir);
    const memIndex = memMgr.buildIndex();
    const snap = captureGitSnapshot(projectDir);

    // Capture shared parts for rebuildGovernance() reuse
    sharedGovParts = {
      startMd: shared.startMd || undefined,
      contributingMd: shared.contributingMd || undefined,
      frameworkContext: loadPrompt("system", "CONTEXT"),
      memoryIndex: memIndex || undefined,
      gitSnapshot: snap ? snapshotToPromptBlock(snap) : undefined,
    };

    // Build initial governance with default mode (chat)
    const modeDef = MODE_DEFS[currentMode];
    const govParts: GovernanceParts = {
      ...sharedGovParts,
      personality: loadPrompt("chat", modeDef.personalitySection),
      skills: modeDef.skills.map(s => findSkill(s)).filter(Boolean).join("\n\n") || undefined,
    };
    const governance = trimGovernanceToFit(govParts);
    systemPrompt = governance.content;
    governanceTokens = governance.tokens;

    // Governance budget warning (REQ-CHAT-14)
    const warning = checkGovernanceBudget(governanceTokens);
    if (warning) process.stderr.write(`⚠ ${warning}\n`);
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

  // --ref: load external codebase as context without running pipeline (REQ-G-1)
  if (options.ref) {
    const { statSync: stat } = await import("node:fs");
    const refPath = options.ref;
    if (!existsSync(refPath) || !stat(refPath).isDirectory()) {
      process.stderr.write(`Warning: --ref path ${refPath} is not a valid directory\n`);
    } else {
      const { buildFileTree } = await import("./gather.js");
      try {
        const tree = buildFileTree(refPath);
        systemPrompt += `\n\n## Reference Codebase (${refPath})\n\nFile tree:\n\`\`\`\n${tree}\n\`\`\`\n\nUse the file tool to read files from this codebase when needed for requirements analysis.`;
      } catch (e) {
        process.stderr.write(`Warning: Could not read --ref path: ${e instanceof Error ? e.message : e}\n`);
      }
    }
  }

  // Regions
  const header = new HeaderRegion();
  const content = new ContentRegion();
  const footer = new FooterRegion();
  const input = new InputRegion();

  const branch = captureGitSnapshot(projectDir)?.branch ?? "";
  const cwd = projectDir.replace(require("os").homedir(), "~");
  header.modelName = model?.config.alias ?? "none";
  footer.modelName = model?.config.alias ?? "none";
  footer.cwd = cwd;
  footer.branch = branch;
  footer.setMode(options.bare ? "/bare" : "/chat");
  if (!options.bare) footer.setGovernance(governanceTokens, getGovernanceMaxTokens());
  content.onContentAdded = () => header.setInteracted();

  // Tools + agent (null if no model)
  let agent: AgentLoop | null = null;
  const streamBuf = { value: "" };
  const webCache = new Map<string, string>();
  const recentFiles: string[] = [];
  const loadedSkills: string[] = [];
  let lastPromptTokens = 0;
  let sendStartTime = 0;
  let handlers: Record<string, (...args: unknown[]) => string> = {};

  if (model) {
    const ctx = new WriteContext({ projectDir, maxReadLines: model.config.maxReadLines });
    const askFn = (question: string, opts?: string[]): string => {
      content.addSystem(`❓ ${question}${opts ? "\n" + opts.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : ""}`);
      return opts?.[0] ?? "Proceed with your best judgment.";
    };
    const [tools, h] = buildLocalTools("chat", projectDir, ctx, {
      memoryManager: memMgr, webFetchKwargs: { model, logPath: log, webCache, allowList: [] }, askFn,
    });
    handlers = h;

    // Track skills loaded via the skill tool for restoration after compaction (REQ-CHAT-4)
    const origSkillHandler = handlers.skill;
    if (origSkillHandler) {
      handlers.skill = ((...args: unknown[]) => {
        const result = origSkillHandler(...args);
        if (String(args[0]) === "get" && result && !result.startsWith("Skill '")) {
          const name = String(args[1]);
          if (!loadedSkills.includes(name)) loadedSkills.push(name);
        }
        return result;
      }) as typeof origSkillHandler;
    }

    agent = new AgentLoop({
      model, systemPrompt, tools, toolHandlers: handlers,
      stream: true, maxTokens: getMaxTokens(model.config, "chat.session"),
      logPath: log, showSpinner: false, toolChoice: "auto",
    });

    agent.onToken = (token: string) => { streamBuf.value += token; content.updateLastModel(streamBuf.value, "", true); };
    agent.onProgress = (data) => {
      if (data.prompt_tokens) lastPromptTokens = data.prompt_tokens;
      if (data.ctx_pct !== undefined) footer.setContext(data.ctx_pct);
      // Live token display during thinking (REQ-UI-10)
      if (content.thinking && sendStartTime) {
        const elapsed = (Date.now() - sendStartTime) / 1000;
        const parts: string[] = [content.thinkingBaseLabel];
        if (elapsed >= 1) parts.push(`${Math.round(elapsed)}s`);
        if (data.completion_tokens) parts.push(`↑ ${data.completion_tokens}`);
        content.setThinking(true, parts.join(" · "));
      }
    };
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
  } else {
    content.addSystem("No model selected. Use /model to choose one.");
  }

  // Session
  const session = ChatSession.loadOrCreate(d);
  if (agent) {
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
  }

  // Context compactor
  const compactPrompt = loadPrompt("chat", "COMPACT") ?? "Summarize the conversation preserving key decisions, file changes, and next steps.";
  const compactor = new ContextCompactor({
    maxContext: model?.config.maxContext ?? 0, compactPrompt,
    governanceTokens,
    logFn: (msg) => { try { appendFileSync(log, msg + "\n"); } catch { /* */ } },
  });
  // Permission gate
  if (agent) {
    const permGate = createPermissionGate();
    agent.beforeToolCall = permGate.hook(projectDir, () => "allow-once");
  }

  const ideaSession = new IdeaSession();
  const defaultPromptFn: PromptFn = () => "skip";

  // ---------------------------------------------------------------------------
  // rebuildGovernance: switch mode by rebuilding the system prompt (REQ-CHAT-15)
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the governance layer for a target mode, update the agent's system
   * prompt (messages[0]), update compactor governance tokens, inject a steering
   * message, and update the footer mode indicator.
   */
  function rebuildGovernance(targetMode: string): void {
    if (!agent || !sharedGovParts) return;
    const modeDef = MODE_DEFS[targetMode];
    if (!modeDef) return;

    const govParts: GovernanceParts = {
      ...sharedGovParts,
      personality: loadPrompt("chat", modeDef.personalitySection),
      skills: modeDef.skills.map(s => findSkill(s)).filter(Boolean).join("\n\n") || undefined,
    };
    const governance = trimGovernanceToFit(govParts);

    // Update system prompt (messages[0])
    agent.messages[0] = { role: "system", content: governance.content };
    governanceTokens = governance.tokens;
    compactor.setGovernanceTokens(governanceTokens);

    // Inject steering message into work layer
    agent.messages.push({ role: "system", content: modeDef.steeringMessage });

    // Update footer and track current mode
    currentMode = targetMode;
    footer.setMode(`/${targetMode}`);
    footer.setGovernance(governanceTokens, getGovernanceMaxTokens());

    content.addSystem(`Switched to ${targetMode} mode.`);
  }

  // ---------------------------------------------------------------------------
  // Bare mode: freeze/resume (REQ-CHAT-6)
  // ---------------------------------------------------------------------------

  type Message = import("../agent/types.js").Message;
  let frozenMessages: Message[] | null = null;
  let isBare = false;

  function enterBare(): void {
    if (!agent || !model) return;
    // Freeze current agent's messages
    frozenMessages = [...agent.messages];
    isBare = true;

    // Replace with bare system prompt — framework context only, no governance
    const barePrompt = loadPrompt("system", "CONTEXT");
    agent.messages = [{ role: "system", content: barePrompt }];

    currentMode = "bare";
    footer.setMode("/bare");
    content.addSystem("Bare mode — no skills, memory, or project context. Type /chat, /plan, /gather, or /idea to return.");
  }

  function exitBare(targetMode: string): void {
    if (!agent || !frozenMessages) return;
    // Restore frozen messages
    agent.messages = frozenMessages;
    frozenMessages = null;
    isBare = false;

    // Rebuild governance for the target mode
    rebuildGovernance(targetMode);
  }

  /** Switch to a mode — exits bare first if active (REQ-CHAT-6). */
  function switchMode(targetMode: string): void {
    if (isBare) { exitBare(targetMode); } else { rebuildGovernance(targetMode); }
  }

  // Chat context for slash commands
  const chatCtx: ChatContext = { model: model!, agent: agent!, header, content, footer, input, session, compactor, ideaSession, projectDir, logPath: log, recentFiles, loadedSkills, streamBuf };

  // Framework command handlers
  const progress = (msg: string) => content.appendSystem(msg);
  const handleGather = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const importMatch = a.match(/--import\s+(\S+)/);
    const ideaMatch = a.match(/--idea\s+(\d+)/);
    const overwrite = a.includes("--overwrite");

    const { runGather } = await import("./gather.js");
    const { createTUIStatus } = await import("./status-line.js");
    c.setThinking(true);
    const status = createTUIStatus(c);

    let r: number;
    if (importMatch) {
      r = await runGather(mc, importMatch[1], undefined, overwrite, undefined, undefined, status);
    } else if (ideaMatch) {
      r = await runGather(mc, undefined, Number(ideaMatch[1]), overwrite, undefined, undefined, status);
    } else {
      c.setThinking(false);
      c.addSystem("Usage: /exec gather --import <path> | /exec gather --idea <id>");
      return;
    }

    c.setThinking(false);
    c.appendSystem(r === 0 ? "✓ Gather complete" : "✗ Gather failed");
  };
  const handlePlan = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runPlan } = await import("./plan.js");
    c.addSystem("Running plan...");
    c.setThinking(true);
    const r = await runPlan(mc, a === "overwrite", undefined, progress);
    c.setThinking(false);
    c.appendSystem(r === 0 ? "✓ Plan complete" : "✗ Plan failed");
  };
  const handleDevelop = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runDevelop } = await import("./develop.js");
    c.addSystem("Running develop...");
    c.setThinking(true);
    const r = await runDevelop(mc, undefined, undefined, progress);
    c.setThinking(false);
    c.appendSystem(r === 0 ? "✓ Develop complete" : "✗ Develop failed");
  };
  const handleVerify = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runVerify } = await import("./verify.js");
    c.addSystem("Running verify...");
    c.setThinking(true);
    const r = await runVerify(mc, progress);
    c.setThinking(false);
    c.appendSystem(r === 0 ? "✓ Verify complete" : "✗ Verify failed");
  };
  const handleDeploy = async (a: string, mc: ModelInterface, c: ContentRegion) => {
    const { runDeploy } = await import("./deploy.js");
    c.addSystem("Running deploy...");
    c.setThinking(true);
    const r = await runDeploy(mc, undefined, progress);
    c.setThinking(false);
    c.appendSystem(r === 0 ? "✓ Deploy complete" : "✗ Deploy failed");
  };

  // Wrap framework handlers to match wrapCommand signature
  const wrap = (fn: (a: string, mc: ModelInterface, c: ContentRegion) => Promise<void>) =>
    async (args: string, mc: ModelInterface, c: ContentRegion, f: FooterRegion, i: InputRegion, pf: PromptFn, l: string) => fn(args, mc, c);

  // ---------------------------------------------------------------------------
  // /exec gateway: lifecycle pipeline dispatch (REQ-CHAT-16)
  // ---------------------------------------------------------------------------

  /** Valid /exec subcommands mapped to their pipeline handlers. */
  const EXEC_COMMANDS: Record<string, (a: string, mc: ModelInterface, c: ContentRegion) => Promise<void>> = {
    gather: handleGather,
    plan: handlePlan,
    develop: handleDevelop,
    verify: handleVerify,
    deploy: handleDeploy,
  };

  function handleExec(fullArgs: string): void {
    if (!model) { content.addSystem("No model selected. Use /model to choose one."); return; }
    const parts = fullArgs.trim().split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();
    const subArgs = fullArgs.trim().slice(subCmd?.length ?? 0).trim();

    if (!subCmd) {
      content.addSystem([
        "Available /exec commands:",
        "  /exec gather --import <path>  reverse-engineer requirements",
        "  /exec gather --idea <id>      requirements from idea",
        "  /exec plan [overwrite]        generate architecture + tasks",
        "  /exec develop                 execute tasks from manifest",
        "  /exec verify                  run acceptance tests",
        "  /exec deploy                  prepare release",
      ].join("\n"));
      return;
    }

    const handler = EXEC_COMMANDS[subCmd];
    if (!handler) {
      content.addSystem(`Unknown exec command: ${subCmd}. Type /exec for available commands.`);
      return;
    }

    wrapCommand(wrap(handler), `/exec ${subCmd}`, subArgs, model, chatCtx, defaultPromptFn, log);
  }

  // Slash command routing
  /** Auto-dispatch queued message after agent completes (REQ-UI-7). */
  function dispatchPendingMessage(): void {
    if (input.pendingMessage) {
      const pending = input.pendingMessage;
      input.setPending(null);
      onSubmit(pending);
    }
  }

  const onSubmit = (text: string) => {
    const low = text.toLowerCase().trim();
    header.setInteracted();

    // Slash command dispatch — match exact name or name + space
    const cmd = low.split(" ")[0];
    const cmdArgs = text.slice(cmd.length).trim();

    if (cmd === "/help") { new HelpCommand(chatCtx).run(); return; }
    if (cmd === "/clear") { new ClearCommand(chatCtx).run(); return; }
    if (cmd === "/ask") { new AskCommand(chatCtx, cmdArgs).run(); return; }
    if (cmd === "/compact") { new CompactCommand(chatCtx).run(); return; }
    if (cmd === "/settings") { new SettingsCommand(chatCtx, cmdArgs).run(); return; }
    if (cmd === "/model") { new ModelCommand(chatCtx, cmdArgs).run(); return; }
    if (cmd === "/idea") {
      const prevMode = currentMode;
      switchMode("idea");
      chatCtx.restoreMode = () => switchMode(prevMode === "idea" ? "chat" : prevMode);
      new IdeaStartCommand(chatCtx, cmdArgs).run();
      return;
    }
    if (cmd === "/done") { new IdeaDoneCommand(chatCtx, cmdArgs.toLowerCase()).run(); return; }
    if (cmd === "/chat") { switchMode("chat"); return; }
    if (cmd === "/bare") { enterBare(); return; }
    if (cmd === "/exec") { handleExec(cmdArgs); return; }
    if (cmd === "/gather") {
      if (cmdArgs.includes("--import") || cmdArgs.includes("--idea")) {
        handleExec(`gather ${cmdArgs}`);
      } else {
        switchMode("gather");
      }
      return;
    }
    if (cmd === "/plan") {
      if (cmdArgs) {
        // Pipeline args → delegate to /exec (REQ-CHAT-16)
        handleExec(`plan ${cmdArgs}`);
      } else {
        switchMode("plan");
      }
      return;
    }
    if (cmd === "/develop") { handleExec(`develop ${cmdArgs}`); return; }
    if (cmd === "/verify") { handleExec(`verify ${cmdArgs}`); return; }
    if (cmd === "/deploy") { handleExec(`deploy ${cmdArgs}`); return; }

    // Unknown slash command
    if (cmd.startsWith("/")) { content.addSystem(`Unknown command: ${cmd}. Type /help for available commands.`); return; }

    if (input.busy && footer.mode) { content.addSystem("Command running — use /ask for questions."); return; }
    if (input.busy) { input.setPending(text); return; }
    if (!agent) { content.addSystem("No model selected. Use /model to choose one."); return; }

    // Normal message → agent
    content.addOperator(text);
    session.append("user", text);
    content.setThinking(true);
    input.setBusy(true);

    (async () => {
      try {
        if (model && compactor.shouldAutoCompact(lastPromptTokens)) {
          content.addSystem("Auto-compacting context...");
          await new CompactCommand(chatCtx).execute();
          if (compactor.disabled) {
            content.addSystem("⚠ Auto-compact disabled after repeated failures. Consider starting a new session with /clear.");
          }
        } else if (model && compactor.shouldNudge(lastPromptTokens)) {
          content.addSystem("Context is filling up. Type /compact to free space.");
        }
        streamBuf.value = "";
        content.addModel("", "", true);
        let completionIn = 0, completionOut = 0;
        agent.onComplete = (s) => {
          completionIn = (s.prompt_tokens as number) || 0;
          completionOut = (s.completion_tokens as number) || 0;
        };
        const t0 = Date.now();
        sendStartTime = t0;
        // Tick elapsed time on the thinking label every second
        const thinkTimer = setInterval(() => {
          if (!content.thinking) return;
          const s = Math.round((Date.now() - t0) / 1000);
          if (s >= 1) content.setThinking(true, `${content.thinkingBaseLabel} · ${s}s`);
        }, 1000);
        let response: string;
        try {
          response = await agent.send(text);
        } finally {
          clearInterval(thinkTimer);
        }
        const elapsed = (Date.now() - t0) / 1000;
        const ctxPct = model?.config.maxContext && completionIn ? Math.round((completionIn / model.config.maxContext) * 100) : undefined;
        const stats = statsStr(elapsed, completionIn, completionOut, ctxPct, "✓ complete");
        content.updateLastModel(response.trim() ? response : "(No response from model)", stats, false);
        session.append("assistant", response);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const name = (e as Record<string, unknown>)?.constructor?.name ?? "";
        if (name === "APIConnectionError" || msg.includes("Connection error")) {
          content.addSystem(`Cannot connect to ${model?.config.baseUrl ?? "model"} — is the model/gateway running?`);
        } else {
          content.addSystem(`Error: ${msg}`);
        }
      } finally {
        content.setThinking(false);
        input.setBusy(false);
        dispatchPendingMessage();
      }
    })();
  };

  // Render TUI
  const { waitUntilExit } = render(
    React.createElement(App, { header, content, footer, input, onSubmit, onEscape: () => input.setPending(null) }),
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
}
