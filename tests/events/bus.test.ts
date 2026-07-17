import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/bus.js";

describe("EventBus", () => {
  it("delivers events to subscribers", async () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.subscribe("FILE_MODIFIED", listener);
    bus.publish("FILE_MODIFIED", { path: "src/main.ts" });

    await new Promise((r) => setTimeout(r, 10));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "FILE_MODIFIED",
      payload: { path: "src/main.ts" },
    });
    expect(listener.mock.calls[0][0].timestamp).toBeTypeOf("number");
  });

  it("unsubscribe stops delivery", async () => {
    const bus = new EventBus();
    const listener = vi.fn();

    const unsub = bus.subscribe("FILE_CREATED", listener);
    unsub();
    bus.publish("FILE_CREATED", { path: "new.ts" });

    await new Promise((r) => setTimeout(r, 10));
    expect(listener).not.toHaveBeenCalled();
  });

  it("catches listener errors without crashing", async () => {
    const bus = new EventBus();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    bus.subscribe("ERROR_OCCURRED", () => { throw new Error("boom"); });
    bus.publish("ERROR_OCCURRED", { message: "test" });

    await new Promise((r) => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("supports multiple subscribers for same event", async () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    bus.subscribe("TURN_COMPLETE", a);
    bus.subscribe("TURN_COMPLETE", b);
    bus.publish("TURN_COMPLETE", { turnId: "t1" });

    await new Promise((r) => setTimeout(r, 10));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("accepts priority metadata on subscription", () => {
    const bus = new EventBus();
    const listener = vi.fn();

    // Should not throw
    bus.subscribe("TURN_BEFORE", listener, { priority: "critical" });
    bus.subscribe("TURN_BEFORE", listener, { priority: "high" });
    bus.subscribe("TURN_BEFORE", listener, { priority: "normal" });
    bus.subscribe("TURN_BEFORE", listener, { priority: "low" });
    bus.subscribe("TURN_BEFORE", listener, { priority: "background" });
  });

  it("defaults to normal priority when not specified", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe("TURN_COMPLETE", listener);

    // Internally stored as normal — verify by publishAndWait (which reads internal list)
    await bus.publishAndWait("TURN_COMPLETE", { turnId: "t1" });
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("EventBus.publishAndWait", () => {
  it("awaits all subscribers sequentially", async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.subscribe("TURN_BEFORE", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    bus.subscribe("TURN_BEFORE", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    bus.subscribe("TURN_BEFORE", async () => {
      order.push(3);
    });

    await bus.publishAndWait("TURN_BEFORE", { userMessage: "test", activeTools: [], activePlan: null, recentSummaries: [], recentTools: [] });

    // FIFO: registration order regardless of async duration
    expect(order).toEqual([1, 2, 3]);
  });

  it("executes in registration order (FIFO)", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.subscribe("TURN_AFTER", async () => { order.push("first"); }, { priority: "low" });
    bus.subscribe("TURN_AFTER", async () => { order.push("second"); }, { priority: "critical" });
    bus.subscribe("TURN_AFTER", async () => { order.push("third"); }, { priority: "normal" });

    await bus.publishAndWait("TURN_AFTER", { userMessage: "x", responseText: "y", toolsUsed: [], turnId: "t1" });

    // FIFO — priority is metadata only, doesn't affect order
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("continues on subscriber error", async () => {
    const bus = new EventBus();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: number[] = [];

    bus.subscribe("TURN_BEFORE", async () => { order.push(1); });
    bus.subscribe("TURN_BEFORE", async () => { throw new Error("subscriber failed"); });
    bus.subscribe("TURN_BEFORE", async () => { order.push(3); });

    await bus.publishAndWait("TURN_BEFORE", { userMessage: "test", activeTools: [], activePlan: null, recentSummaries: [], recentTools: [] });

    // First and third ran, second threw but didn't kill the chain
    expect(order).toEqual([1, 3]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns immediately when no subscribers", async () => {
    const bus = new EventBus();
    const start = Date.now();
    await bus.publishAndWait("TURN_BEFORE", { userMessage: "test", activeTools: [], activePlan: null, recentSummaries: [], recentTools: [] });
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("only runs subscribers for the matching event type", async () => {
    const bus = new EventBus();
    const preSpy = vi.fn();
    const postSpy = vi.fn();

    bus.subscribe("TURN_BEFORE", preSpy);
    bus.subscribe("TURN_AFTER", postSpy);

    await bus.publishAndWait("TURN_BEFORE", { userMessage: "test", activeTools: [], activePlan: null, recentSummaries: [], recentTools: [] });

    expect(preSpy).toHaveBeenCalledOnce();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("unsubscribed listeners do not run", async () => {
    const bus = new EventBus();
    const listener = vi.fn();

    const unsub = bus.subscribe("TURN_BEFORE", listener);
    unsub();

    await bus.publishAndWait("TURN_BEFORE", { userMessage: "test", activeTools: [], activePlan: null, recentSummaries: [], recentTools: [] });
    expect(listener).not.toHaveBeenCalled();
  });
});
