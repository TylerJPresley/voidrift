/**
 * BaseCommand: shared lifecycle for all framework commands.
 *
 * Lifecycle: preflight → boot → execute → finish
 * Subclasses override execute() and optionally preflight().
 */

import type { ModelInterface } from "../models.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, printCommandHeader } from "../utils.js";
import { join } from "node:path";

export abstract class BaseCommand {
  /** Display name for headers and logs. */
  abstract readonly name: string;

  protected model: ModelInterface;
  protected voidriftDir = "";
  protected projectDir = "";
  protected logPath = "";
  protected runId = "";

  constructor(model: ModelInterface) {
    this.model = model;
  }

  /** Override to add command-specific preflight checks. Call super.preflight() first. */
  async preflight(): Promise<void> {
    checkDiskSpace();
    this.voidriftDir = ensureVoidriftDir();
    this.projectDir = join(this.voidriftDir, "..");
  }

  /** Boot logging and print header. Override headerExtra() for additional fields. */
  async boot(): Promise<void> {
    [this.logPath, this.runId] = bootRun(this.name);
    printCommandHeader(this.name, this.model.config.alias, this.logPath, this.headerExtra());
  }

  /** Extra key-value pairs for the command header box. */
  protected headerExtra(): Record<string, string> | undefined {
    return undefined;
  }

  /** The command's core logic. Must be implemented by subclasses. */
  abstract execute(): Promise<number>;

  /** Post-execution: write STATE.md entry. Override for cleanup. */
  async finish(exitCode: number, summary?: string, files?: string[]): Promise<void> {
    if (summary) {
      appendState(this.name, this.model.config.alias, summary, files);
    }
  }

  /** Run the full lifecycle. Returns exit code. */
  async run(): Promise<number> {
    try {
      await this.preflight();
      await this.boot();
      const code = await this.execute();
      return code;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Error: ${msg}\n`);
      return 1;
    }
  }
}

/**
 * SlashCommand: lightweight command for chat slash commands that don't need
 * boot/header/state. Override execute() only.
 */
export abstract class SlashCommand {
  abstract readonly name: string;
  abstract execute(): Promise<number>;

  async run(): Promise<number> {
    try {
      return await this.execute();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Error: ${msg}\n`);
      return 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared chat context for slash commands
// ---------------------------------------------------------------------------

import type { AgentLoop } from "../agent/loop.js";
import type { ChatSession } from "../session.js";
import type { ContextCompactor } from "../agent/context.js";
import type { IdeaSession } from "./idea.js";
import type { TUIState } from "../tui/state.js";
import { addSystem } from "../tui/state.js";

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

export type PromptFn = (filename: string, catList: string[]) => string;

/** Run a framework command handler in the chat shell with busy/mode management. */
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
