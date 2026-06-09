import { describe, it, expect } from "vitest";
import { TokenBudgetWatcher } from "../../src/output/budget.js";

describe("TokenBudgetWatcher", () => {
  it("starts at 0 usage", () => {
    const w = new TokenBudgetWatcher(100000);
    expect(w.state.used).toBe(0);
    expect(w.state.percentage).toBe(0);
    expect(w.state.color).toBe("green");
  });

  it("tracks added tokens", () => {
    const w = new TokenBudgetWatcher(1000);
    w.add(300);
    expect(w.state.used).toBe(300);
    expect(w.state.percentage).toBe(30);
    expect(w.state.color).toBe("green");
  });

  it("turns yellow at 50%", () => {
    const w = new TokenBudgetWatcher(1000);
    w.set(500);
    expect(w.state.color).toBe("yellow");
  });

  it("turns red at 80%", () => {
    const w = new TokenBudgetWatcher(1000);
    w.set(800);
    expect(w.state.color).toBe("red");
  });

  it("resets to zero", () => {
    const w = new TokenBudgetWatcher(1000);
    w.add(500);
    w.reset();
    expect(w.state.used).toBe(0);
  });

  it("allows changing the limit", () => {
    const w = new TokenBudgetWatcher(1000);
    w.set(500);
    w.setLimit(2000);
    expect(w.state.percentage).toBe(25);
    expect(w.state.color).toBe("green");
  });
});
