/**
 * Headless Host — runs VoidRift without a terminal UI.
 *
 * Reuses createEngine() verbatim. Wires output/panel callbacks to
 * event emitters instead of Ink components. Exposes CoreAPI for
 * external frontends to drive sessions.
 *
 * Usage:
 *   const host = await createHeadlessHost({ workspaceRoot: "/path/to/project" });
 *   host.core.sendInput({ text: "hello" });
 *   host.on("output", (text) => console.log(text));
 *   host.shutdown();
 */
import { createEngine } from "./cli.js";
import { CoreAPI } from "../plugins/interface.js";
import type { EngineContext } from "../engine.js";

export interface HeadlessHostOptions {
  workspaceRoot?: string;
}

export interface HeadlessHost {

  core: CoreAPI;

  shutdown: () => void;
}

export async function createHeadlessHost(opts?: HeadlessHostOptions): Promise<HeadlessHost> {
  // Override cwd if workspace specified
  if (opts?.workspaceRoot) {
    process.chdir(opts.workspaceRoot);
  }

  const engine = await createEngine();
  const core = new CoreAPI(engine.container.registry, engine.container.bus, engine.worktree, engine.workspaceRoot, engine.templates, engine.agents, engine.prompts, engine.context, engine.skills);
  core.bindEngine(engine);

  // Wire output callbacks to bus events (no terminal rendering)
  core.session.setCmdOutput((text) => {
    core.events.emit("ERROR_OCCURRED", { message: text, source: "output" });
  });
  core.session.setOpenPanel((name) => {
    core.events.emit("ERROR_OCCURRED", { message: `panel:${name}`, source: "panel" });
  });

  const shutdown = () => {
    core.events.emit("SESSION_END", {
      sessionDurationMs: Date.now(),
      exitCode: 0,
    });
  };

  // Graceful shutdown on signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { core: core, shutdown };
}
