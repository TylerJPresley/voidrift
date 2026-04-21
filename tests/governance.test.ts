/**
 * Tests for governance/work context partition (REQ-CHAT-14).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGovernanceLayer, estimateTokens, checkGovernanceBudget, getGovernanceMaxTokens, trimGovernanceToFit } from "../src/governance.js";
import { ContextCompactor } from "../src/agent/context.js";
import { CONFIG_SCHEMA } from "../src/config.js";
import type { Message } from "../src/agent/types.js";

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildGovernanceLayer
// ---------------------------------------------------------------------------

describe("buildGovernanceLayer", () => {
  it("assembles all parts in order", () => {
    const result = buildGovernanceLayer({
      startMd: "# START",
      contributingMd: "# CONTRIBUTING",
      frameworkContext: "Framework context",
      personality: "Chat personality",
      skills: "ANALYSIS-REQS skill",
      memoryIndex: "Memory index",
      gitSnapshot: "Git snapshot",
    });
    const idx = (s: string) => result.content.indexOf(s);
    expect(idx("# START")).toBeLessThan(idx("# CONTRIBUTING"));
    expect(idx("# CONTRIBUTING")).toBeLessThan(idx("Framework context"));
    expect(idx("Framework context")).toBeLessThan(idx("Chat personality"));
    expect(idx("Chat personality")).toBeLessThan(idx("ANALYSIS-REQS skill"));
    expect(idx("ANALYSIS-REQS skill")).toBeLessThan(idx("Memory index"));
    expect(idx("Memory index")).toBeLessThan(idx("Git snapshot"));
  });

  it("omits undefined parts", () => {
    const result = buildGovernanceLayer({
      frameworkContext: "Framework",
      personality: "Personality",
    });
    expect(result.content).toBe("Framework\n\nPersonality");
  });

  it("returns token estimate", () => {
    const result = buildGovernanceLayer({
      frameworkContext: "a".repeat(400),
      personality: "b".repeat(400),
    });
    // 800 chars + 2 newlines ≈ 200+ tokens
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.tokens).toBe(estimateTokens(result.content));
  });
});

// ---------------------------------------------------------------------------
// checkGovernanceBudget
// ---------------------------------------------------------------------------

describe("checkGovernanceBudget", () => {
  it("returns null when within budget", () => {
    // Default cap is 6144 tokens
    expect(checkGovernanceBudget(5000)).toBeNull();
  });

  it("returns warning when over budget", () => {
    // 7000 tokens exceeds default 6144 cap
    const warning = checkGovernanceBudget(7000);
    expect(warning).toContain("Governance layer uses");
    expect(warning).toContain("cap:");
  });
});

// ---------------------------------------------------------------------------
// CONFIG_SCHEMA governance_budget
// ---------------------------------------------------------------------------

describe("CONFIG_SCHEMA governance_max_tokens", () => {
  it("exists in schema", () => {
    expect(CONFIG_SCHEMA["governance_max_tokens"]).toBeDefined();
    expect(CONFIG_SCHEMA["governance_max_tokens"].type).toBe("number");
  });

  it("validates positive number", () => {
    const validate = CONFIG_SCHEMA["governance_max_tokens"].validate!;
    expect(validate(6144)).toBeNull();
    expect(validate(1)).toBeNull();
    expect(validate(0)).not.toBeNull();
    expect(validate(-100)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ContextCompactor with governance tokens (REQ-CHAT-14)
// ---------------------------------------------------------------------------

describe("ContextCompactor governance partition", () => {
  it("workBudget = maxContext - governanceTokens", () => {
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 5000 });
    expect(c.workBudget).toBe(123000);
  });

  it("workBudget equals maxContext when no governance tokens", () => {
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize" });
    expect(c.workBudget).toBe(128000);
  });

  it("setGovernanceTokens updates work budget", () => {
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 5000 });
    expect(c.workBudget).toBe(123000);
    c.setGovernanceTokens(10000);
    expect(c.workBudget).toBe(118000);
  });

  it("shouldAutoCompact uses work utilization at 80%", () => {
    // maxContext=128000, governance=28000, workBudget=100000
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 28000 });
    // promptTokens includes governance: 28000 (gov) + 79999 (work) = 107999
    // work utilization = 79999/100000 = 79.999% → should NOT trigger
    expect(c.shouldAutoCompact(107999)).toBe(false);
    // 28000 (gov) + 80000 (work) = 108000 → work utilization = 80% → trigger
    expect(c.shouldAutoCompact(108000)).toBe(true);
  });

  it("shouldNudge uses work utilization at 70%", () => {
    // maxContext=128000, governance=28000, workBudget=100000
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 28000 });
    // 28000 + 69999 = 97999 → 69.999% → no nudge
    expect(c.shouldNudge(97999)).toBe(false);
    // 28000 + 70000 = 98000 → 70% → nudge
    expect(c.shouldNudge(98000)).toBe(true);
  });

  it("shouldAutoCompact returns false when work budget is 0", () => {
    const c = new ContextCompactor({ maxContext: 100, compactPrompt: "summarize", governanceTokens: 100 });
    expect(c.shouldAutoCompact(100)).toBe(false);
  });

  it("compact enforces 10% ceiling against work budget", async () => {
    // maxContext=128000, governance=28000, workBudget=100000
    // 10% of workBudget = 10000 tokens = ~40000 chars
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 28000 });
    const messages: Message[] = [
      { role: "system", content: "Governance layer content" },
      { role: "user", content: "Old message" },
      { role: "assistant", content: "Old reply" },
      { role: "user", content: "Old message 2" },
      { role: "assistant", content: "Old reply 2" },
      // Recent 4 messages — each 15000 chars to blow past 40000-char ceiling
      { role: "user", content: "A".repeat(15000) },
      { role: "assistant", content: "B".repeat(15000) },
      { role: "user", content: "C".repeat(15000) },
      { role: "assistant", content: "D".repeat(15000) },
    ];
    const callFn = vi.fn().mockResolvedValue("Short summary");
    const result = await c.compact(messages, callFn);
    // Should have dropped recent messages: only system + summary remain
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toContain("Short summary");
  });

  it("compact keeps recent messages when within work budget ceiling", async () => {
    // maxContext=128000, governance=5000, workBudget=123000
    // 10% of workBudget = 12300 tokens = ~49200 chars — plenty of room
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 5000 });
    const messages: Message[] = [
      { role: "system", content: "Governance layer" },
      { role: "user", content: "Old" },
      { role: "assistant", content: "Old reply" },
      { role: "user", content: "Old 2" },
      { role: "assistant", content: "Old reply 2" },
      { role: "user", content: "Recent 1" },
      { role: "assistant", content: "Recent 2" },
      { role: "user", content: "Recent 3" },
      { role: "assistant", content: "Recent 4" },
    ];
    const callFn = vi.fn().mockResolvedValue("Summary");
    const result = await c.compact(messages, callFn);
    // system + summary + 4 recent = 6
    expect(result.length).toBe(6);
  });

  it("governance layer (messages[0]) is always preserved during compaction", async () => {
    const govContent = "This is the governance layer with START.md and CONTRIBUTING.md";
    const c = new ContextCompactor({ maxContext: 128000, compactPrompt: "summarize", governanceTokens: 5000 });
    const messages: Message[] = [
      { role: "system", content: govContent },
      { role: "user", content: "msg1" },
      { role: "assistant", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "msg4" },
      { role: "user", content: "msg5" },
      { role: "assistant", content: "msg6" },
    ];
    const callFn = vi.fn().mockResolvedValue("Summary");
    const result = await c.compact(messages, callFn);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe(govContent);
  });
});

// ---------------------------------------------------------------------------
// trimGovernanceToFit (REQ-CHAT-14 AC: skills trimmed when over budget)
// ---------------------------------------------------------------------------

describe("trimGovernanceToFit", () => {
  it("returns full governance when within cap", () => {
    const parts = {
      frameworkContext: "Framework",
      personality: "Personality",
      skills: "Skills content",
    };
    // Default cap is 6144 tokens — these tiny strings are well under
    const result = trimGovernanceToFit(parts);
    expect(result.content).toContain("Skills content");
  });

  it("trims skills when governance exceeds cap", () => {
    const parts = {
      frameworkContext: "F".repeat(12000),
      personality: "P".repeat(12000),
      skills: "S".repeat(4000),
    };
    // Total ~28000 chars = ~7000 tokens, exceeds default 6144 cap → trim skills
    const result = trimGovernanceToFit(parts);
    expect(result.content).not.toContain("SSSS");
    expect(result.content).toContain("F".repeat(12000));
    expect(result.content).toContain("P".repeat(12000));
  });
});
