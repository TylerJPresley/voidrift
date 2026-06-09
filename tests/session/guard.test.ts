import { describe, it, expect, vi } from "vitest";
import { ExceptionGuard } from "../../src/session/guard.js";
import { ContextManager } from "../../src/session/context.js";
import { EventBus } from "../../src/events/bus.js";

describe("ExceptionGuard", () => {
  it("returns result on success", async () => {
    const bus = new EventBus();
    const ctx = new ContextManager("", "");
    const guard = new ExceptionGuard(bus, ctx);

    const result = await guard.run(async () => "ok");
    expect(result).toBe("ok");
  });

  it("catches errors and returns null", async () => {
    const bus = new EventBus();
    const ctx = new ContextManager("", "");
    const guard = new ExceptionGuard(bus, ctx);

    const result = await guard.run(async () => { throw new Error("boom"); });
    expect(result).toBeNull();
  });

  it("adds error message to context", async () => {
    const bus = new EventBus();
    const ctx = new ContextManager("", "");
    const guard = new ExceptionGuard(bus, ctx);

    await guard.run(async () => { throw new Error("API timeout"); });
    const msgs = ctx.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("API timeout");
  });

  it("publishes ERROR_OCCURRED event", async () => {
    const bus = new EventBus();
    const ctx = new ContextManager("", "");
    const guard = new ExceptionGuard(bus, ctx);
    const listener = vi.fn();

    bus.subscribe("ERROR_OCCURRED", listener);
    await guard.run(async () => { throw new Error("fail"); });

    await new Promise((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].payload.message).toBe("fail");
  });
});
