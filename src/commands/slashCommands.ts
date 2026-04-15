/**
 * Slash command harness + handlers (REQ-U-2b..2e).
 *
 * wrapCommand provides lifecycle management. Each handler follows the
 * contract: fn(args, mc, state, promptFn, log).
 */

import type { ModelInterface } from "../models.js";
import type { TUIState } from "../tui/state.js";
import { addSystem } from "../tui/state.js";

type PromptFn = (name: string, choices: string[]) => string;
type Handler = (args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string) => Promise<void>;

export function wrapCommand(
  fn: Handler,
  args: string,
  mc: ModelInterface,
  state: TUIState,
  promptFn: PromptFn,
  log: string,
): void {
  const cmdName = fn.name.replace("handle", "").toLowerCase();
  state.busy = true;
  state.mode = `/${cmdName}`;

  const run = async () => {
    try {
      await fn(args, mc, state, promptFn, log);
    } catch (e) {
      addSystem(state, `Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      state.busy = false;
      state.mode = "";
    }
  };

  // Run async — don't block the TUI
  run();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleGather(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runGather } = await import("./gather.js");
  const fromPath = args || process.cwd();
  addSystem(state, `Gathering from ${fromPath}`);
  const result = await runGather(mc, fromPath, undefined, false, undefined, (f, c) => promptFn(f, c));
  addSystem(state, result === 0 ? "✓ Gather complete" : "✗ Gather failed");
}

export async function handlePlan(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { ensureVoidriftDir } = await import("../utils.js");
  const { runPlan } = await import("./plan.js");

  const d = ensureVoidriftDir();
  if (!existsSync(join(d, "REQUIREMENTS.md"))) {
    addSystem(state, "Error: REQUIREMENTS.md not found. Run /gather first.");
    return;
  }

  let overwrite = false;
  if (existsSync(join(d, "ARCHITECTURE.md")) && existsSync(join(d, "tasks", "manifest.yml"))) {
    const choice = promptFn("plan_overwrite", ["overwrite", "update"]);
    overwrite = choice === "overwrite";
  }

  addSystem(state, overwrite ? "Planning (overwrite)..." : "Planning...");
  const result = await runPlan(mc, overwrite);
  addSystem(state, result === 0 ? "✓ Plan complete" : "✗ Plan failed");
}

export async function handleDevelop(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runDevelop } = await import("./develop.js");
  addSystem(state, "Developing...");
  const result = await runDevelop(mc);
  addSystem(state, result === 0 ? "✓ Develop complete" : "✗ Develop finished with errors");
}

export async function handleVerify(args: string, mc: ModelInterface, state: TUIState, promptFn: PromptFn, log: string): Promise<void> {
  const { runVerify } = await import("./verify.js");
  addSystem(state, "Verifying...");
  const result = await runVerify(mc);
  addSystem(state, result === 0 ? "✓ Verification passed" : "✗ Verification failed");
}
