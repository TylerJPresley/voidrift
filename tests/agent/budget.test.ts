import { describe, it, expect } from "vitest";
import { TokenBudget, BudgetExhaustedError } from "../../src/agent/budget.js";

describe("TokenBudget", () => {
  it("records usage", () => {
    const b = new TokenBudget(1000, 500);
    b.record(100, 50);
    expect(b.inputTotal).toBe(100);
    expect(b.outputTotal).toBe(50);
  });

  it("throws on input budget exceeded", () => {
    const b = new TokenBudget(100);
    b.record(101, 0);
    expect(() => b.checkBefore()).toThrow(BudgetExhaustedError);
  });

  it("throws on output budget exceeded", () => {
    const b = new TokenBudget(undefined, 100);
    b.record(0, 101);
    expect(() => b.checkBefore()).toThrow(BudgetExhaustedError);
  });

  it("does not throw when within budget", () => {
    const b = new TokenBudget(1000, 500);
    b.record(500, 200);
    expect(() => b.checkBefore()).not.toThrow();
  });

  it("does not throw when no limits set", () => {
    const b = new TokenBudget();
    b.record(999999, 999999);
    expect(() => b.checkBefore()).not.toThrow();
  });

  it("summary includes totals", () => {
    const b = new TokenBudget(1000, 500);
    b.record(300, 150);
    expect(b.summary()).toContain("300/1000");
    expect(b.summary()).toContain("150/500");
  });
});
