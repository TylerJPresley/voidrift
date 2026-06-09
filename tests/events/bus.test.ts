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
});
