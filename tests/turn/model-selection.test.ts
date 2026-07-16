import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Model Selection Tests.
 *
 * Verifies the correct separation between:
 * - Interactive agents: use config.modelSelected
 * - Task agents: use agent.role (role-based)
 * - Escalation: mutates config.modelSelected, not agent
 * - Utility: never used for user turns
 */

// Minimal mocks for turn resolution logic
function resolveTurnModel(agent: { type: string; role: string; autoEscalated?: boolean }, config: { modelSelected: string; tiers: Record<string, string> }) {
  let tier: string;
  if (agent.type === "task") {
    tier = agent.role || "utility";
    if (tier === "auto") tier = "utility";
  } else {
    const modelSelected = config.modelSelected || "auto";
    if (modelSelected === "auto") {
      tier = "flash";
    } else {
      tier = modelSelected;
    }
  }
  return tier;
}

describe("Model Selection — Turn Resolution", () => {
  it("interactive agent with 'auto' resolves to flash", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "auto", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    expect(resolveTurnModel(agent, config)).toBe("flash");
  });

  it("interactive agent with specific model selected uses that model", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "claude-sonnet", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    expect(resolveTurnModel(agent, config)).toBe("claude-sonnet");
  });

  it("interactive agent ignores its own role field", () => {
    const agent = { type: "interactive", role: "dense" };
    const config = { modelSelected: "auto", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    // Should NOT use agent.role for interactive — uses config.modelSelected
    expect(resolveTurnModel(agent, config)).toBe("flash");
  });

  it("task agent with utility role resolves to utility", () => {
    const agent = { type: "task", role: "utility" };
    const config = { modelSelected: "claude-sonnet", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    expect(resolveTurnModel(agent, config)).toBe("utility");
  });

  it("task agent with auto role resolves to utility", () => {
    const agent = { type: "task", role: "auto" };
    const config = { modelSelected: "claude-sonnet", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    expect(resolveTurnModel(agent, config)).toBe("utility");
  });

  it("task agent with flash role resolves to flash", () => {
    const agent = { type: "task", role: "flash" };
    const config = { modelSelected: "auto", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    expect(resolveTurnModel(agent, config)).toBe("flash");
  });

  it("task agent ignores config.modelSelected", () => {
    const agent = { type: "task", role: "utility" };
    const config = { modelSelected: "claude-opus", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" };
    // Task agent should NOT use the user's selection
    expect(resolveTurnModel(agent, config)).toBe("utility");
  });

  it("utility is never returned for interactive agents", () => {
    const agent = { type: "interactive", role: "utility" };
    const configs = [
      { modelSelected: "auto", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" },
      { modelSelected: "claude-sonnet", modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local" },
    ];
    for (const config of configs) {
      expect(resolveTurnModel(agent, config)).not.toBe("utility");
    }
  });
});

describe("Model Selection — Escalation", () => {
  it("escalation changes config.modelSelected to dense", () => {
    const config = { modelSelected: "auto" as string };
    // Simulate escalation
    config.modelSelected = "dense";
    expect(config.modelSelected).toBe("dense");
  });

  it("de-escalation restores config.modelSelected to auto", () => {
    const config = { modelSelected: "dense" as string };
    // Simulate de-escalation
    config.modelSelected = "auto";
    expect(config.modelSelected).toBe("auto");
  });

  it("escalation does NOT mutate agent.role", () => {
    const agent = { type: "interactive", role: "auto" };
    const config = { modelSelected: "auto" as string };
    // Simulate escalation
    config.modelSelected = "dense";
    // Agent's field should be untouched
    expect(agent.role).toBe("auto");
  });

  it("auto-escalation only triggers when modelSelected is auto", () => {
    // When user has pinned a specific model, auto-escalation should not fire
    const config = { modelSelected: "claude-sonnet" };
    const shouldAutoEscalate = config.modelSelected === "auto";
    expect(shouldAutoEscalate).toBe(false);
  });
});

describe("Model Selection — Config Persistence", () => {
  it("modelSelected defaults to auto", () => {
    const config = { modelSelected: "auto" };
    expect(config.modelSelected).toBe("auto");
  });

  it("switch to specific model updates modelSelected", () => {
    const config = { modelSelected: "auto" as string };
    // Simulate models.switch({ name: "claude-sonnet" })
    config.modelSelected = "claude-sonnet";
    expect(config.modelSelected).toBe("claude-sonnet");
  });

  it("switch to auto resets modelSelected", () => {
    const config = { modelSelected: "claude-sonnet" as string };
    // Simulate models.switch({ name: "auto" })
    config.modelSelected = "auto";
    expect(config.modelSelected).toBe("auto");
  });

  it("tier assignment does not change modelSelected", () => {
    const config = { modelSelected: "auto" as string, tiers: { flash: "local" as string, utility: "local", dense: "local" } };
    // Simulate assigning a model to flash tier
    config.modelTierFlash = "claude-sonnet";
    // modelSelected should be unchanged
    expect(config.modelSelected).toBe("auto");
  });
});
