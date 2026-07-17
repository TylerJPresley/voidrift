/**
 * createCore — the single entry point for initializing VoidRift.
 *
 * Returns a fully bound CoreAPI instance. Clients never see the engine.
 *
 * Usage:
 *   import { createCore } from "voidrift";
 *   const core = await createCore({ workspaceRoot: process.cwd() });
 *   // done. Use core.session.*, core.plan.*, etc.
 */
import { createEngine } from "./cli.js";
import { CoreAPI } from "../plugins/interface.js";

export interface CreateCoreOptions {
  /** Workspace root directory. Defaults to process.cwd() */
  workspaceRoot?: string;
}

/**
 * Initialize VoidRift and return the CoreAPI.
 * This is the ONLY thing clients need to call.
 */
export async function createCore(opts?: CreateCoreOptions): Promise<CoreAPI> {
  if (opts?.workspaceRoot) {
    process.chdir(opts.workspaceRoot);
  }

  const engine = await createEngine();
  const core = new CoreAPI(
    engine.container.registry,
    engine.container.bus,
    engine.worktree,
    engine.workspaceRoot,
    engine.templates,
    engine.agents,
    engine.prompts,
    engine.context,
    engine.skills,
  );
  core.bindEngine(engine);
  return core;
}
