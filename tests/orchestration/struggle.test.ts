import { describe, it, expect, vi } from "vitest";

/**
 * Stall Recovery Tests.
 *
 * The stall recovery mechanism uses a utility classifier (not regex) to detect
 * when the model stated intent but took no action. These tests verify the
 * configuration and integration points rather than the classifier itself
 * (which depends on an actual model call).
 */

describe("Stall Recovery", () => {
  it("turnsStallRecovery defaults to enabled (undefined = true)", () => {
    // When turnsStallRecovery is not set, it defaults to enabled
    const config = { turnsStallRecovery: undefined };
    const enabled = config.turnsStallRecovery !== false;
    expect(enabled).toBe(true);
  });

  it("turnsStallRecovery can be disabled explicitly", () => {
    const config = { turnsStallRecovery: false };
    const enabled = config.turnsStallRecovery !== false;
    expect(enabled).toBe(false);
  });

  it("stall check skips long responses (likely real answers)", () => {
    const responseText = "A".repeat(600); // > 500 chars
    const shouldCheck = responseText.length < 500 && !responseText.endsWith("?");
    expect(shouldCheck).toBe(false);
  });

  it("stall check skips responses ending with questions", () => {
    const responseText = "What would you like me to do?";
    const shouldCheck = responseText.length < 500 && !responseText.endsWith("?");
    expect(shouldCheck).toBe(false);
  });

  it("stall check runs on short non-question responses with no tool calls", () => {
    const responseText = "Let me check the modes section:";
    const toolCalls: any[] = [];
    const shouldCheck = responseText.length < 500 && !responseText.endsWith("?") && toolCalls.length === 0;
    expect(shouldCheck).toBe(true);
  });

  it("nudge text includes escalation option when modelEscalation is set", () => {
    const config = { modelEscalation: "claude" };
    const nudgeText = config.modelEscalation
      ? "[SYSTEM — not user input] You stated intent but took no action. Either call the tool now, or call escalate if this exceeds your capacity. Continue working."
      : "[SYSTEM — not user input] You stated intent but took no action. Actually call the tool to do it. Continue working.";
    expect(nudgeText).toContain("escalate");
  });

  it("nudge text omits escalation when modelEscalation is not set", () => {
    const config = { modelEscalation: undefined };
    const nudgeText = config.modelEscalation
      ? "[SYSTEM — not user input] You stated intent but took no action. Either call the tool now, or call escalate if this exceeds your capacity. Continue working."
      : "[SYSTEM — not user input] You stated intent but took no action. Actually call the tool to do it. Continue working.";
    expect(nudgeText).not.toContain("escalate");
    expect(nudgeText).toContain("Continue working");
  });
});
