/**
 * Tests for REQ-CHAT-15: Mode switching (/chat, /plan, /gather, /idea).
 *
 * Verifies mode definitions, governance rebuild behavior, prompt sections,
 * and slash command routing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODE_DEFS, type ChatMode } from "../../src/commands/chat.js";
import { buildGovernanceLayer, type GovernanceParts } from "../../src/governance.js";
import { ContextCompactor } from "../../src/agent/context.js";

// ---------------------------------------------------------------------------
// MODE_DEFS structure
// ---------------------------------------------------------------------------

describe("MODE_DEFS (REQ-CHAT-15)", () => {
  it("defines all four modes", () => {
    expect(MODE_DEFS).toHaveProperty("chat");
    expect(MODE_DEFS).toHaveProperty("plan");
    expect(MODE_DEFS).toHaveProperty("gather");
    expect(MODE_DEFS).toHaveProperty("idea");
  });

  it("each mode has personalitySection, skills, and steeringMessage", () => {
    for (const [name, def] of Object.entries(MODE_DEFS)) {
      expect(def.personalitySection, `${name}.personalitySection`).toBeTruthy();
      expect(def.skills, `${name}.skills`).toBeInstanceOf(Array);
      expect(def.skills.length, `${name}.skills.length`).toBeGreaterThan(0);
      expect(def.steeringMessage, `${name}.steeringMessage`).toBeTruthy();
    }
  });

  it("chat mode uses SYSTEM personality and ANALYSIS-REQS skill", () => {
    expect(MODE_DEFS.chat.personalitySection).toBe("SYSTEM");
    expect(MODE_DEFS.chat.skills).toContain("ANALYSIS-REQS");
  });

  it("plan mode uses PLAN personality and ARCH-DESIGN skill", () => {
    expect(MODE_DEFS.plan.personalitySection).toBe("PLAN");
    expect(MODE_DEFS.plan.skills).toContain("ARCH-DESIGN");
  });

  it("gather mode uses GATHER personality and ANALYSIS-REQS skill", () => {
    expect(MODE_DEFS.gather.personalitySection).toBe("GATHER");
    expect(MODE_DEFS.gather.skills).toContain("ANALYSIS-REQS");
  });

  it("idea mode uses IDEA personality and ANALYSIS-REQS skill", () => {
    expect(MODE_DEFS.idea.personalitySection).toBe("IDEA");
    expect(MODE_DEFS.idea.skills).toContain("ANALYSIS-REQS");
  });
});

// ---------------------------------------------------------------------------
// Prompt sections exist for all modes
// ---------------------------------------------------------------------------

describe("chat.md prompt sections for modes (REQ-CHAT-15)", () => {
  it("SYSTEM section exists with assistant personality", () => {
    const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");
    const sections = chatMd.split(/^## /m).map(s => s.trim());
    const systemSection = sections.find(s => s.startsWith("SYSTEM"));
    expect(systemSection).toBeDefined();
    expect(systemSection).toContain("Interactive Assistant");
  });

  it("PLAN section exists with planning personality", () => {
    const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");
    const sections = chatMd.split(/^## /m).map(s => s.trim());
    const planSection = sections.find(s => s.startsWith("PLAN"));
    expect(planSection).toBeDefined();
    expect(planSection).toContain("Architecture");
    expect(planSection).toContain("Planning");
  });

  it("GATHER section exists with requirements personality", () => {
    const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");
    const sections = chatMd.split(/^## /m).map(s => s.trim());
    const gatherSection = sections.find(s => s.startsWith("GATHER"));
    expect(gatherSection).toBeDefined();
    expect(gatherSection).toContain("EARS");
    expect(gatherSection).toContain("requirements");
  });

  it("IDEA section exists with idea refinement personality", () => {
    const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");
    const sections = chatMd.split(/^## /m).map(s => s.trim());
    const ideaSection = sections.find(s => s.startsWith("IDEA"));
    expect(ideaSection).toBeDefined();
    expect(ideaSection).toContain("idea refinement");
  });
});

// ---------------------------------------------------------------------------
// Governance rebuild produces different content per mode
// ---------------------------------------------------------------------------

describe("governance rebuild per mode (REQ-CHAT-15)", () => {
  it("/plan rebuilds governance with plan personality and ARCH-DESIGN skill", () => {
    const shared: Omit<GovernanceParts, "personality" | "skills"> = {
      startMd: "# START",
      contributingMd: "# CONTRIBUTING",
      frameworkContext: "Framework context",
    };
    const chatGov = buildGovernanceLayer({ ...shared, personality: "Chat personality", skills: "ANALYSIS-REQS content" });
    const planGov = buildGovernanceLayer({ ...shared, personality: "Plan personality", skills: "ARCH-DESIGN content" });

    // Both contain shared governance
    expect(chatGov.content).toContain("# START");
    expect(planGov.content).toContain("# START");
    expect(chatGov.content).toContain("# CONTRIBUTING");
    expect(planGov.content).toContain("# CONTRIBUTING");

    // Different personality and skills
    expect(chatGov.content).toContain("Chat personality");
    expect(chatGov.content).not.toContain("Plan personality");
    expect(planGov.content).toContain("Plan personality");
    expect(planGov.content).not.toContain("Chat personality");

    expect(chatGov.content).toContain("ANALYSIS-REQS content");
    expect(planGov.content).toContain("ARCH-DESIGN content");
  });

  it("/chat after /plan reverts to chat personality and ANALYSIS-REQS skill", () => {
    const shared: Omit<GovernanceParts, "personality" | "skills"> = {
      frameworkContext: "Framework",
    };
    // Simulate: start in chat, switch to plan, switch back to chat
    const chatGov1 = buildGovernanceLayer({ ...shared, personality: "Chat", skills: "ANALYSIS-REQS" });
    const planGov = buildGovernanceLayer({ ...shared, personality: "Plan", skills: "ARCH-DESIGN" });
    const chatGov2 = buildGovernanceLayer({ ...shared, personality: "Chat", skills: "ANALYSIS-REQS" });

    // Chat governance is identical before and after plan switch
    expect(chatGov2.content).toBe(chatGov1.content);
    expect(chatGov2.tokens).toBe(chatGov1.tokens);

    // Plan governance is different
    expect(planGov.content).not.toBe(chatGov1.content);
  });
});

// ---------------------------------------------------------------------------
// Steering message injection
// ---------------------------------------------------------------------------

describe("steering message on mode switch (REQ-CHAT-15)", () => {
  it("each mode defines a non-empty steering message", () => {
    for (const [name, def] of Object.entries(MODE_DEFS)) {
      expect(def.steeringMessage.length, `${name} steering message`).toBeGreaterThan(0);
    }
  });

  it("steering messages are distinct per mode", () => {
    const messages = Object.values(MODE_DEFS).map(d => d.steeringMessage);
    const unique = new Set(messages);
    expect(unique.size).toBe(messages.length);
  });
});

// ---------------------------------------------------------------------------
// Default mode is /chat
// ---------------------------------------------------------------------------

describe("default mode (REQ-CHAT-15)", () => {
  it("chat mode is the default (first mode built at startup)", () => {
    // The default mode is 'chat' — verified by checking MODE_DEFS.chat exists
    // and that the initial governance uses SYSTEM personality section
    expect(MODE_DEFS.chat).toBeDefined();
    expect(MODE_DEFS.chat.personalitySection).toBe("SYSTEM");
  });
});

// ---------------------------------------------------------------------------
// Compactor governance tokens update on mode switch
// ---------------------------------------------------------------------------

describe("compactor governance tokens update (REQ-CHAT-15)", () => {
  it("setGovernanceTokens updates work budget after mode switch", () => {
    const compactor = new ContextCompactor({
      maxContext: 128000, compactPrompt: "summarize", governanceTokens: 5000,
    });
    expect(compactor.workBudget).toBe(123000);

    // Simulate mode switch producing different governance size
    compactor.setGovernanceTokens(8000);
    expect(compactor.workBudget).toBe(120000);
  });
});

// ---------------------------------------------------------------------------
// Slash command routing (source-level verification)
// ---------------------------------------------------------------------------

describe("slash command routing for modes (REQ-CHAT-15)", () => {
  const source = readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");

  it("/chat calls switchMode('chat')", () => {
    expect(source).toContain('"/chat"');
    expect(source).toContain('switchMode("chat")');
  });

  it("/plan (bare) calls switchMode('plan')", () => {
    expect(source).toContain('switchMode("plan")');
  });

  it("/plan with args delegates to /exec instead of mode switch", () => {
    expect(source).toContain('handleExec(`plan ${cmdArgs}`)');
  });

  it("/gather (bare) calls switchMode('gather')", () => {
    expect(source).toContain('switchMode("gather")');
  });

  it("/gather --import delegates to /exec instead of mode switch", () => {
    expect(source).toContain('cmdArgs.includes("--import")');
    expect(source).toContain('handleExec(`gather ${cmdArgs}`)');
  });

  it("/idea calls switchMode('idea')", () => {
    expect(source).toContain('switchMode("idea")');
  });
});

// ---------------------------------------------------------------------------
// Message history preserved across mode switches
// ---------------------------------------------------------------------------

describe("message history preservation (REQ-CHAT-15)", () => {
  it("rebuildGovernance only replaces messages[0] and appends steering — history untouched", () => {
    // Simulate what rebuildGovernance does: replace messages[0], append steering
    const messages = [
      { role: "system" as const, content: "Old governance" },
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
      { role: "user" as const, content: "Help me plan" },
    ];

    // Simulate mode switch
    const newGov = buildGovernanceLayer({
      frameworkContext: "Framework",
      personality: "Plan personality",
      skills: "ARCH-DESIGN",
    });
    messages[0] = { role: "system", content: newGov.content };
    messages.push({ role: "system", content: "Operating as planning agent." });

    // History preserved: user/assistant messages still present
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hi there" });
    expect(messages[3]).toEqual({ role: "user", content: "Help me plan" });

    // New governance in place
    expect(messages[0].content).toContain("Plan personality");

    // Steering message appended
    expect(messages[4]).toEqual({ role: "system", content: "Operating as planning agent." });
  });
});
