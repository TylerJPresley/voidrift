/**
 * Slash command classes for chat (REQ-U-2a..e).
 * Each is a peer SlashCommand. ChatCommand dispatches to them.
 */

import type { ModelInterface } from "../models.js";
import type { TUIState } from "../tui/state.js";
import type { AgentLoop } from "../agent/loop.js";
import type { ChatSession } from "../session.js";
import type { ContextCompactor } from "../agent/context.js";
import type { IdeaSession } from "./idea.js";
import { addSystem, addModel, updateLastModel } from "../tui/state.js";
import { SlashCommand } from "./base.js";

/** Shared context passed from ChatCommand to each slash command. */
export interface ChatContext {
  model: ModelInterface;
  agent: AgentLoop;
  state: TUIState;
  session: ChatSession;
  compactor: ContextCompactor;
  ideaSession: IdeaSession;
  projectDir: string;
  logPath: string;
  recentFiles: string[];
  streamBuf: { value: string };
}

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

export class HelpCommand extends SlashCommand {
  readonly name = "help";
  private state: TUIState;
  constructor(ctx: ChatContext) { super(); this.state = ctx.state; }

  async execute(): Promise<number> {
    addSystem(this.state, "Commands:");
    addSystem(this.state, "  /gather [path]  reverse-engineer requirements");
    addSystem(this.state, "  /plan           generate architecture + tasks");
    addSystem(this.state, "  /develop        execute tasks from manifest");
    addSystem(this.state, "  /deploy         prepare release (version, tag)");
    addSystem(this.state, "  /verify         run acceptance tests");
    addSystem(this.state, "  /idea           guided idea refinement");
    addSystem(this.state, "  /compact        summarize context to free space");
    addSystem(this.state, "  /ask <q>        one-shot answer (no context)");
    addSystem(this.state, "  /clear          reset conversation");
    addSystem(this.state, "  /help           this list");
    addSystem(this.state, "  /quit           exit");
    return 0;
  }
}

// ---------------------------------------------------------------------------
// /clear
// ---------------------------------------------------------------------------

export class ClearCommand extends SlashCommand {
  readonly name = "clear";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    this.ctx.session.clear();
    this.ctx.agent.messages = [this.ctx.agent.messages[0]];
    this.ctx.state.messages = [];
    addSystem(this.ctx.state, "Session cleared.");
    return 0;
  }
}

// ---------------------------------------------------------------------------
// /ask <question>
// ---------------------------------------------------------------------------

export class AskCommand extends SlashCommand {
  readonly name = "ask";
  private ctx: ChatContext;
  private question: string;
  constructor(ctx: ChatContext, question: string) { super(); this.ctx = ctx; this.question = question; }

  async execute(): Promise<number> {
    if (!this.question) { addSystem(this.ctx.state, "Usage: /ask <question>"); return 1; }
    addModel(this.ctx.state, "", "", true);
    this.ctx.state.busy = true;
    try {
      const { AgentLoop } = await import("../agent/loop.js");
      const { getMaxTokens } = await import("../config.js");
      const oneShot = new AgentLoop({
        model: this.ctx.model, systemPrompt: "Answer concisely.", tools: [], toolHandlers: {},
        stream: false, maxTokens: getMaxTokens(this.ctx.model.config, "chat.quick"),
        logPath: this.ctx.logPath, showSpinner: false,
      });
      const answer = await oneShot.send(this.question);
      updateLastModel(this.ctx.state, answer, "", false);
    } catch (e) { addSystem(this.ctx.state, `Ask failed: ${e}`); }
    finally { this.ctx.state.busy = false; }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// /compact
// ---------------------------------------------------------------------------

export class CompactCommand extends SlashCommand {
  readonly name = "compact";
  private ctx: ChatContext;
  constructor(ctx: ChatContext) { super(); this.ctx = ctx; }

  async execute(): Promise<number> {
    if (this.ctx.agent.messages.length <= 2) { addSystem(this.ctx.state, "Nothing to compact."); return 0; }
    this.ctx.state.busy = true;
    addSystem(this.ctx.state, "Compacting context...");
    try {
      const { AgentLoop } = await import("../agent/loop.js");
      const compacted = await this.ctx.compactor.compact(this.ctx.agent.messages, async (msgs, maxTok) => {
        const oneShot = new AgentLoop({
          model: this.ctx.model, systemPrompt: msgs[0].content ?? "", tools: [], toolHandlers: {},
          stream: false, maxTokens: maxTok, logPath: this.ctx.logPath, showSpinner: false,
        });
        return oneShot.send(msgs[1].content ?? "");
      });
      this.ctx.agent.messages = compacted;
      this.ctx.session.appendCompaction(compacted[1]?.content ?? "");
      const maxRestore = Math.floor((this.ctx.model.config.maxContext ?? 100000) * 0.2 * 4);
      const restoration = this.ctx.compactor.buildRestoration(this.ctx.recentFiles, [], maxRestore);
      if (restoration) this.ctx.agent.messages.push({ role: "system", content: restoration });
      addSystem(this.ctx.state, `Compacted to ${this.ctx.agent.messages.length} messages.`);
    } catch (e) { addSystem(this.ctx.state, `Compact failed: ${e}`); }
    finally { this.ctx.state.busy = false; this.ctx.state._notify?.(); }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// /idea [id]
// ---------------------------------------------------------------------------

export class IdeaStartCommand extends SlashCommand {
  readonly name = "idea";
  private ctx: ChatContext;
  private arg: string;
  constructor(ctx: ChatContext, arg: string) { super(); this.ctx = ctx; this.arg = arg; }

  async execute(): Promise<number> {
    const { readIdea, nextIdeaId } = await import("./idea.js");
    if (this.ctx.ideaSession.isActive()) { addSystem(this.ctx.state, "Idea session already active. Type /done to finish."); return 1; }
    const id = this.arg ? parseInt(this.arg, 10) : null;
    if (id !== null && isNaN(id)) { addSystem(this.ctx.state, "Usage: /idea [id]"); return 1; }

    if (id) {
      const content = readIdea(this.ctx.projectDir, id);
      if (!content) { addSystem(this.ctx.state, `IDEA-${id} not found.`); return 1; }
      this.ctx.ideaSession.start(id);
      this.ctx.state.mode = "/idea"; this.ctx.state._notify?.();
      addSystem(this.ctx.state, `Loaded IDEA-${id}. Describe what to refine, or /done to save.`);
      this.ctx.state.busy = true; this.ctx.state.thinking = true; this.ctx.state._notify?.();
      try {
        this.ctx.streamBuf.value = ""; addModel(this.ctx.state, "", "", true);
        const r = await this.ctx.agent.send(`I'm resuming work on this idea:\n\n${content}\n\nSummarize the current state and ask what I'd like to refine.`);
        updateLastModel(this.ctx.state, r, "", false);
      } catch (e) { addSystem(this.ctx.state, `Error: ${e}`); }
      finally { this.ctx.state.thinking = false; this.ctx.state.busy = false; this.ctx.state._notify?.(); }
    } else {
      const newId = nextIdeaId(this.ctx.projectDir);
      this.ctx.ideaSession.start(newId);
      this.ctx.state.mode = "/idea"; this.ctx.state._notify?.();
      addSystem(this.ctx.state, `New idea IDEA-${newId}. Describe your idea — the agent will guide you. /done to save.`);
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// /done [category]
// ---------------------------------------------------------------------------

export class IdeaDoneCommand extends SlashCommand {
  readonly name = "done";
  private ctx: ChatContext;
  private category: string;
  constructor(ctx: ChatContext, category: string) { super(); this.ctx = ctx; this.category = category; }

  async execute(): Promise<number> {
    const { writeIdea, buildIdeaContent, nextIdeaId } = await import("./idea.js");
    if (!this.ctx.ideaSession.isActive()) { addSystem(this.ctx.state, "No active idea session."); return 1; }
    const cat = this.category || "now";
    if (!["now", "next", "later"].includes(cat)) { addSystem(this.ctx.state, "Category: now, next, or later"); return 1; }
    const id = this.ctx.ideaSession.ideaId ?? nextIdeaId(this.ctx.projectDir);
    this.ctx.state.busy = true; this.ctx.state.thinking = true; this.ctx.state._notify?.();
    try {
      this.ctx.streamBuf.value = ""; addModel(this.ctx.state, "", "", true);
      const summary = await this.ctx.agent.send("Produce a structured idea summary: Title, User Story, Acceptance Criteria, Affected Modules, Affected Files. Markdown format.");
      updateLastModel(this.ctx.state, summary, "", false);
      writeIdea(this.ctx.projectDir, id, buildIdeaContent(`IDEA-${id}`, summary, cat as "now" | "next" | "later"));
      this.ctx.ideaSession.cancel();
      this.ctx.state.mode = ""; addSystem(this.ctx.state, `Saved IDEA-${id} as "${cat}".`);
    } catch (e) { addSystem(this.ctx.state, `Error: ${e}`); }
    finally { this.ctx.state.thinking = false; this.ctx.state.busy = false; this.ctx.state._notify?.(); }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Framework command wrappers (run in background thread via wrapCommand pattern)
// ---------------------------------------------------------------------------

export type PromptFn = (filename: string, catList: string[]) => string;

export async function wrapCommand(
  fn: (args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string) => Promise<void>,
  args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string,
): Promise<void> {
  const cmdName = fn.name.replace("handle", "/").toLowerCase();
  state.mode = cmdName;
  state.busy = true;
  state._notify?.();
  try {
    await fn(args, mc, state, promptFn, log);
  } catch (e) {
    addSystem(state, `Error: ${e instanceof Error ? e.message : e}`);
  } finally {
    state.mode = "";
    state.busy = false;
    state._notify?.();
  }
}

export async function handleGather(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runGather } = await import("./gather.js");
  const fromPath = args || process.cwd();
  addSystem(state, `Gathering from ${fromPath}`);
  const result = await runGather(mc, fromPath, undefined, false, undefined, (f, c) => promptFn(f, c));
  addSystem(state, result === 0 ? "✓ Gather complete" : "✗ Gather failed");
}

export async function handlePlan(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runPlan } = await import("./plan.js");
  addSystem(state, "Running plan...");
  const result = await runPlan(mc, args === "overwrite");
  addSystem(state, result === 0 ? "✓ Plan complete" : "✗ Plan failed");
}

export async function handleDevelop(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runDevelop } = await import("./develop.js");
  addSystem(state, "Running develop...");
  const result = await runDevelop(mc);
  addSystem(state, result === 0 ? "✓ Develop complete" : "✗ Develop failed");
}

export async function handleVerify(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runVerify } = await import("./verify.js");
  addSystem(state, "Running verify...");
  const result = await runVerify(mc);
  addSystem(state, result === 0 ? "✓ Verify complete" : "✗ Verify failed");
}

export async function handleDeploy(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runDeploy } = await import("./deploy.js");
  addSystem(state, "Running deploy...");
  const result = await runDeploy(mc);
  addSystem(state, result === 0 ? "✓ Deploy complete" : "✗ Deploy failed");
}
