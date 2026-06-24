/**
 * Headless Host — runs VoidRift without a terminal UI.
 *
 * Reuses createEngine() verbatim. Wires output/panel callbacks to
 * event emitters instead of Ink components. Exposes OperatorAPI for
 * external frontends to drive sessions.
 *
 * Usage:
 *   const host = await createHeadlessHost({ workspaceRoot: "/path/to/project" });
 *   host.operator.sendInput({ text: "hello" });
 *   host.on("output", (text) => console.log(text));
 *   host.shutdown();
 */
import { createEngine } from "./cli.js";
import { OperatorAPI } from "../operator/api.js";
import type { EngineContext } from "../engine.js";
import type { EventBus } from "../events/bus.js";

export interface HeadlessHostOptions {
  workspaceRoot?: string;
}

export interface HeadlessHost {
  engine: EngineContext;
  operator: OperatorAPI;
  bus: EventBus;
  shutdown: () => void;
}

export async function createHeadlessHost(opts?: HeadlessHostOptions): Promise<HeadlessHost> {
  // Override cwd if workspace specified
  if (opts?.workspaceRoot) {
    process.chdir(opts.workspaceRoot);
  }

  const engine = await createEngine();
  const operator = new OperatorAPI(engine);

  // Wire output callbacks to bus events (no terminal rendering)
  engine.setCmdOutput((text) => {
    engine.container.bus.publish("ERROR_OCCURRED", { message: text, source: "output" });
  });
  engine.setOpenPanel((name) => {
    // Frontends handle panel rendering — emit as notification
    engine.container.bus.publish("ERROR_OCCURRED", { message: `panel:${name}`, source: "panel" });
  });

  const shutdown = () => {
    engine.container.bus.publish("SESSION_END", {
      sessionDurationMs: Date.now(),
      exitCode: 0,
    });
    engine.brain.save(engine.context.context, engine.agents.active.id);
  };

  // Graceful shutdown on signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { engine, operator, bus: engine.container.bus, shutdown };
}
