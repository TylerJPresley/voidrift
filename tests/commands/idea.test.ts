import { describe, it, expect } from "vitest";
import { IdeaSession, IdeaState } from "../../src/commands/idea.js";

describe("IdeaSession", () => {
  it("starts in IDLE", () => {
    const s = new IdeaSession();
    expect(s.state).toBe(IdeaState.IDLE);
    expect(s.isActive()).toBe(false);
  });

  it("start transitions to COLLECTING", () => {
    const s = new IdeaSession();
    s.start();
    expect(s.state).toBe(IdeaState.COLLECTING);
    expect(s.isActive()).toBe(true);
  });

  it("addLine accumulates text", () => {
    const s = new IdeaSession();
    s.start();
    s.addLine("line 1");
    s.addLine("line 2");
    expect(s.lines).toHaveLength(2);
  });

  it("addLine throws when IDLE", () => {
    const s = new IdeaSession();
    expect(() => s.addLine("x")).toThrow();
  });

  it("confirm returns joined text and resets", () => {
    const s = new IdeaSession();
    s.start();
    s.addLine("idea part 1");
    s.addLine("idea part 2");
    const text = s.confirm();
    expect(text).toBe("idea part 1\nidea part 2");
    expect(s.state).toBe(IdeaState.IDLE);
    expect(s.lines).toHaveLength(0);
  });

  it("cancel resets to IDLE", () => {
    const s = new IdeaSession();
    s.start(42);
    s.addLine("something");
    s.cancel();
    expect(s.state).toBe(IdeaState.IDLE);
    expect(s.lines).toHaveLength(0);
    expect(s.ideaId).toBeNull();
  });

  it("start with ideaId sets it", () => {
    const s = new IdeaSession();
    s.start(7);
    expect(s.ideaId).toBe(7);
  });

  it("start throws when already active", () => {
    const s = new IdeaSession();
    s.start();
    expect(() => s.start()).toThrow();
  });
});
