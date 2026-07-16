import type { EventBus } from "../events/bus.js";
import type { ContextManager } from "./context.js";

/**
 * Session Exception Guard.
 * Wraps async operations, catches errors, pushes clean error blocks
 * to conversation history, and publishes ERROR_OCCURRED to release the UI.
 */
export class ExceptionGuard {
  constructor(private bus: EventBus, private ctx: ContextManager) {}

  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.addMessage({ role: "assistant", content: `⚠️ Error: ${message}` });
      this.bus.publish("ERROR_OCCURRED", { message, source: "session" });
      return null;
    }
  }
}
