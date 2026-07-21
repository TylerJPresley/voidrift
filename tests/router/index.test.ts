import { describe, it, expect } from "vitest";
import { escalateRole, shouldEscalate, resolveEscalation, buildEscalationState, escalationNotice } from "../../src/router/index.js";
import type { VoidRiftConfig } from "../../src/config/loader.js";

const TEST_CONFIG: VoidRiftConfig = {
  modelSelected: "local", modelUtility: "mid", modelEscalation: "cloud",
  models: {
    local: { protocol: "openai", model: "qwen", baseUrl: "http://localhost:11434/v1", contextLimit: 32768, temperature: 0.2 },
    mid: { protocol: "openai", model: "mixtral", baseUrl: "http://localhost:11434/v1", contextLimit: 65536, temperature: 0.2 },
    cloud: { protocol: "openai", model: "gpt-4o", baseUrl: "https://api.openai.com/v1", contextLimit: 128000, temperature: 0.2 },
  },
};

describe("Escalation", () => {
  it("escalates selected → utility", () => { expect(escalateRole("selected")).toBe("utility"); });
  it("escalates utility → escalation", () => { expect(escalateRole("utility")).toBe("escalation"); });
  it("returns null at escalation", () => { expect(escalateRole("escalation")).toBeNull(); });

  it("triggers on 85% context overflow", () => {
    expect(shouldEscalate(28000, 32768, 0)).toBe(true);
  });
  it("does not trigger under 85%", () => {
    expect(shouldEscalate(20000, 32768, 0)).toBe(false);
  });
  it("triggers on 2 consecutive failures", () => {
    expect(shouldEscalate(1000, 32768, 2)).toBe(true);
  });
  it("does not trigger on 1 failure", () => {
    expect(shouldEscalate(1000, 32768, 1)).toBe(false);
  });

  it("buildEscalationState creates valid snapshot", () => {
    const state = buildEscalationState(
      "selected", "utility", "CONTEXT_OVERFLOW", "Token limit exceeded",
      "engineer", { activePlan: "Step 1", focusedFiles: ["a.ts"], messagesSnapshot: [] },
      { tokenCount: 28000, limit: 32768 }
    );
    expect(state.escalationId).toMatch(/^esc-/);
    expect(state.sourceRole).toBe("selected");
    expect(state.targetRole).toBe("utility");
    expect(state.triggerReason.code).toBe("CONTEXT_OVERFLOW");
    expect(state.triggerReason.metrics?.tokenCount).toBe(28000);
    expect(state.sessionState.activePlan).toBe("Step 1");
  });

  it("escalationNotice generates correct system message", () => {
    const state = buildEscalationState(
      "utility", "escalation", "REPEATED_AUDIT_FAILURE", "Tests failed 3 times",
      "auditor", { activePlan: null, focusedFiles: [], messagesSnapshot: [] }
    );
    const notice = escalationNotice(state);
    expect(notice).toContain("utility");
    expect(notice).toContain("escalation");
    expect(notice).toContain("REPEATED_AUDIT_FAILURE");
  });

  it("resolveEscalation returns next tier model", () => {
    const resolved = resolveEscalation("selected", TEST_CONFIG);
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe("mid");
  });
  it("resolveEscalation returns null at escalation", () => {
    expect(resolveEscalation("escalation", TEST_CONFIG)).toBeNull();
  });
});
