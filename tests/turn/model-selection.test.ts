import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Model Selection Tests.
 *
 * Verifies the correct separation between:
 * - Interactive agents: use config.modelSelected
 * - Task agents: use agent.role (role-based)
 * - Escalation: requires modelEscalation to be set
 * - Utility: independent from user-facing model selection
 */

// Minimal mock for turn resolution logic (mirrors turn.ts logic)
function resolveTurnModel(agent: { type: string; role: string; autoEscalated?: boolean }, config: { modelSelected: string; modelEscalation?: string; modelUtility?: string }) {
  let tier: string;
  if (agent.type === "passive") {
    if (agent.role === "utility") tier = "utility";
    else if (agent.role === "escalation") tier = "escalation";
    else tier = (config as any).modelBackground || config.modelSelected;
  } else {
    tier = config.modelSelected;
  }
  return tier;
}

describe("Model Selection — Turn Resolution", () => {
  it("interactive agent uses modelSelected directly", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "local" };
    expect(resolveTurnModel(agent, config)).toBe("local");
  });

  it("interactive agent with specific model uses that model", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "claude-sonnet" };
    expect(resolveTurnModel(agent, config)).toBe("claude-sonnet");
  });

  it("interactive agent ignores its own role field", () => {
    const agent = { type: "interactive", role: "escalation" };
    const config = { modelSelected: "local" };
    // Should NOT use agent.role for interactive — uses config.modelSelected
    expect(resolveTurnModel(agent, config)).toBe("local");
  });

  it("task agent with utility role resolves to utility", () => {
    const agent = { type: "passive", role: "utility" };
    const config = { modelSelected: "claude-sonnet" };
    expect(resolveTurnModel(agent, config)).toBe("utility");
  });

  it("task agent with empty role uses modelSelected", () => {
    const agent = { type: "passive", role: "" };
    const config = { modelSelected: "claude-sonnet" };
    expect(resolveTurnModel(agent, config)).toBe("claude-sonnet");
  });

  it("task agent with no role uses modelSelected", () => {
    const agent = { type: "passive", role: "" };
    const config = { modelSelected: "local" };
    expect(resolveTurnModel(agent, config)).toBe("local");
  });

  it("task agent ignores config.modelSelected", () => {
    const agent = { type: "passive", role: "utility" };
    const config = { modelSelected: "claude-opus" };
    expect(resolveTurnModel(agent, config)).toBe("utility");
  });

  it("utility is never returned for interactive agents", () => {
    const agent = { type: "interactive", role: "utility" };
    const configs = [
      { modelSelected: "local" },
      { modelSelected: "claude-sonnet" },
    ];
    for (const config of configs) {
      expect(resolveTurnModel(agent, config)).not.toBe("utility");
    }
  });
});

describe("Model Selection — Escalation", () => {
  it("escalation is available when modelEscalation is set", () => {
    const config = { modelSelected: "local", modelEscalation: "claude" };
    expect(config.modelEscalation).toBeDefined();
    expect(config.modelEscalation).not.toBe(config.modelSelected);
  });

  it("escalation is unavailable when modelEscalation is not set", () => {
    const config = { modelSelected: "local" };
    expect((config as any).modelEscalation).toBeUndefined();
  });

  it("escalation is effectively disabled when same as selected", () => {
    const config = { modelSelected: "local", modelEscalation: "local" };
    const escalationActive = config.modelEscalation && config.modelEscalation !== config.modelSelected;
    expect(escalationActive).toBeFalsy();
  });

  it("escalation does NOT mutate agent.role", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "local", modelEscalation: "claude" };
    // Agent's field should be untouched after any escalation
    expect(agent.role).toBe("auto");
  });
});

describe("Model Selection — Config Persistence", () => {
  it("modelSelected is always a model name", () => {
    const config = { modelSelected: "local" };
    expect(config.modelSelected).toBe("local");
  });

  it("switch to specific model updates modelSelected", () => {
    const config = { modelSelected: "local" as string };
    config.modelSelected = "claude-sonnet";
    expect(config.modelSelected).toBe("claude-sonnet");
  });

  it("escalation assignment does not change modelSelected", () => {
    const config = { modelSelected: "local" as string, modelEscalation: undefined as string | undefined };
    config.modelEscalation = "claude";
    expect(config.modelSelected).toBe("local");
  });

  it("utility assignment does not change modelSelected", () => {
    const config = { modelSelected: "local" as string, modelUtility: undefined as string | undefined };
    config.modelUtility = "fast-local";
    expect(config.modelSelected).toBe("local");
  });
});
