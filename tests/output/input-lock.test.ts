import { describe, it, expect } from "vitest";
import { InputLock } from "../../src/output/input-lock.js";
import { EventBus } from "../../src/events/bus.js";

describe("InputLock", () => {
  it("starts unlocked", () => {
    const bus = new EventBus();
    const lock = new InputLock(bus);
    expect(lock.locked).toBe(false);
  });

  it("locks on USER_INPUT", async () => {
    const bus = new EventBus();
    const lock = new InputLock(bus);
    bus.publish("USER_INPUT", { text: "hello" });
    await new Promise((r) => setTimeout(r, 10));
    expect(lock.locked).toBe(true);
  });

  it("unlocks on TURN_COMPLETE", async () => {
    const bus = new EventBus();
    const lock = new InputLock(bus);
    lock.lock();
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(lock.locked).toBe(false);
  });

  it("unlocks on ERROR_OCCURRED", async () => {
    const bus = new EventBus();
    const lock = new InputLock(bus);
    lock.lock();
    bus.publish("ERROR_OCCURRED", { message: "fail" });
    await new Promise((r) => setTimeout(r, 10));
    expect(lock.locked).toBe(false);
  });

  it("supports manual lock/release", () => {
    const bus = new EventBus();
    const lock = new InputLock(bus);
    lock.lock();
    expect(lock.locked).toBe(true);
    lock.release();
    expect(lock.locked).toBe(false);
  });
});
