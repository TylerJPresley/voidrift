import { describe, it, expect, vi } from "vitest";
import { ModeCycler } from "../../src/security/mode-cycler.js";

describe("ModeCycler", () => {
  it("starts in chat mode", () => {
    const cycler = new ModeCycler();
    expect(cycler.mode).toBe("chat");
  });

  it("cycles chat → vibe → plan → chat", () => {
    const cycler = new ModeCycler();
    expect(cycler.cycle()).toBe("vibe");
    expect(cycler.cycle()).toBe("plan");
    expect(cycler.cycle()).toBe("chat");
  });

  it("gateEnabled is true only in chat mode", () => {
    const cycler = new ModeCycler();
    expect(cycler.gateEnabled).toBe(true); // chat
    cycler.setMode("vibe");
    expect(cycler.gateEnabled).toBe(false);
    cycler.setMode("plan");
    expect(cycler.gateEnabled).toBe(false);
  });

  it("writesBlocked is true only in plan mode", () => {
    const cycler = new ModeCycler();
    expect(cycler.writesBlocked).toBe(false); // chat
    cycler.setMode("plan");
    expect(cycler.writesBlocked).toBe(true);
    cycler.setMode("vibe");
    expect(cycler.writesBlocked).toBe(false);
  });

  it("setMode sets mode directly", () => {
    const cycler = new ModeCycler();
    cycler.setMode("vibe");
    expect(cycler.mode).toBe("vibe");
    cycler.setMode("plan");
    expect(cycler.mode).toBe("plan");
  });

  it("setMode throws on invalid mode", () => {
    const cycler = new ModeCycler();
    expect(() => cycler.setMode("invalid" as any)).toThrow();
  });

  it("getTools returns appropriate tools for mode + node", () => {
    const cycler = new ModeCycler();
    cycler.setMode("plan");
    const tools = cycler.getTools("engineer");
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).toContain("read_file");
  });

  it("getTools in chat mode with engineer returns all tools", () => {
    const cycler = new ModeCycler();
    const tools = cycler.getTools("engineer");
    expect(tools.length).toBe(12);
  });

  it("notifies listeners on cycle", () => {
    const cycler = new ModeCycler();
    const listener = vi.fn();
    cycler.onModeChange(listener);

    cycler.cycle(); // chat → vibe
    expect(listener).toHaveBeenCalledWith({ previous: "chat", current: "vibe" });
  });

  it("notifies listeners on setMode", () => {
    const cycler = new ModeCycler();
    const listener = vi.fn();
    cycler.onModeChange(listener);

    cycler.setMode("plan");
    expect(listener).toHaveBeenCalledWith({ previous: "chat", current: "plan" });
  });

  it("does not notify when setMode to same mode", () => {
    const cycler = new ModeCycler();
    const listener = vi.fn();
    cycler.onModeChange(listener);

    cycler.setMode("chat"); // already chat
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const cycler = new ModeCycler();
    const listener = vi.fn();
    const unsub = cycler.onModeChange(listener);

    unsub();
    cycler.cycle();
    expect(listener).not.toHaveBeenCalled();
  });
});
