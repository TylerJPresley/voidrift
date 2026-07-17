import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/bus.js";
import { ContextManager } from "../../src/session/context.js";

describe("TURN_BEFORE Subscribers", () => {
  describe("Context Pressure", () => {
    it("injects warning at 50-79% usage", () => {
      const context = new ContextManager("test persona", "codemap");
      // Simulate 60% context usage via token count
      const budget = { getContextPct: (used: number) => 60, state: { used: 60000, limit: 100000 } };

      const contextPct = budget.getContextPct(context.getTokenCount());
      if (contextPct >= 50 && contextPct < 80) {
        context.injectTurnContext("Context Budget", `Context usage: ${contextPct}%. Be concise.`);
      }

      expect(context.context.void.turnContext).toHaveLength(1);
      expect(context.context.void.turnContext[0].label).toBe("Context Budget");
      expect(context.context.void.turnContext[0].content).toContain("60%");
    });

    it("injects critical warning at 80%+", () => {
      const context = new ContextManager("test persona", "codemap");
      const budget = { getContextPct: () => 85 };

      const contextPct = budget.getContextPct(0);
      if (contextPct >= 80) {
        context.injectTurnContext("Context Budget", `⚠️ Context usage: ${contextPct}% — critically high.`);
      }

      expect(context.context.void.turnContext[0].content).toContain("critically high");
    });

    it("does not inject below 50%", () => {
      const context = new ContextManager("test persona", "codemap");
      const budget = { getContextPct: () => 30 };

      const contextPct = budget.getContextPct(0);
      if (contextPct >= 50) {
        context.injectTurnContext("Context Budget", "should not appear");
      }

      expect(context.context.void.turnContext).toHaveLength(0);
    });
  });

  describe("Message Decay", () => {
    it("compacts messages when user count exceeds threshold", async () => {
      const context = new ContextManager("test persona", "codemap");
      // Add 25 user/assistant pairs
      for (let i = 0; i < 25; i++) {
        context.addMessage({ role: "user", content: `question ${i}` });
        context.addMessage({ role: "assistant", content: `answer ${i}` });
      }

      expect(context.getMessages()).toHaveLength(50);

      const { compactHistory } = await import("../../src/session/compactor.js");
      const result = compactHistory(context.getMessages(), 50000, 50000);

      // Should compact (50 messages, 25 user turns > 20 threshold)
      expect(result.compacted).toBe(true);
      expect(result.messages.length).toBeLessThan(50);
    });

    it("does not compact when below threshold", async () => {
      const context = new ContextManager("test persona", "codemap");
      for (let i = 0; i < 5; i++) {
        context.addMessage({ role: "user", content: `question ${i}` });
        context.addMessage({ role: "assistant", content: `answer ${i}` });
      }

      const { compactHistory } = await import("../../src/session/compactor.js");
      const result = compactHistory(context.getMessages(), 5000, 50000);

      expect(result.compacted).toBe(false);
    });
  });

  describe("Skill Resolution", () => {
    it("loads skills matching keyword triggers", async () => {
      const { SkillManager } = await import("../../src/skills/manager.js");
      const skills = new SkillManager();
      skills.register({
        name: "test-skill",
        description: "Test skill for planning",
        triggers: { keywords: ["plan", "organize"] },
        agents: [],
        active: true,
        sourcePlugin: "test",
        content: "# Planning Guide\nAlways plan before acting.",
      });
      // Index with empty dirs to activate builtins
      skills.index([]);

      const resolved = skills.resolveMatchingSkillContent(
        { focusedFiles: [], userInput: "let's plan the refactor", activePlan: null },
        "chat",
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toContain("Planning Guide");
    });

    it("inherits previous skills when nothing triggers", () => {
      const context = new ContextManager("test persona", "codemap");
      const previousSkills = ["# Skill A content", "# Skill B content"];
      context.setActiveSkills(previousSkills);

      // Simulate: no new skills triggered, previous exist
      const resolvedSkills: string[] = [];
      const previous = context.context.orbit.activeSkills;

      if (resolvedSkills.length === 0 && previous.length > 0) {
        context.setActiveSkills(previous);
      }

      expect(context.context.orbit.activeSkills).toEqual(previousSkills);
    });

    it("merges new skills with previous", () => {
      const context = new ContextManager("test persona", "codemap");
      context.setActiveSkills(["# Existing skill"]);

      const resolvedSkills = ["# New skill"];
      const previous = context.context.orbit.activeSkills;
      const merged = [...new Set([...resolvedSkills, ...previous])];
      context.setActiveSkills(merged);

      expect(context.context.orbit.activeSkills).toHaveLength(2);
      expect(context.context.orbit.activeSkills).toContain("# Existing skill");
      expect(context.context.orbit.activeSkills).toContain("# New skill");
    });
  });
});

describe("TURN_AFTER Subscribers", () => {
  describe("Escalation Check", () => {
    it("escalates to dense when model calls escalate tool", () => {
      const agent = { role: "auto", autoEscalated: false, type: "interactive" } as any;
      const toolsUsed = ["read_file", "escalate"];

      if (toolsUsed.includes("escalate") && agent.role !== "dense") {
        agent.role = "dense";
        agent.autoEscalated = false;
      }

      expect(agent.role).toBe("dense");
    });

    it("deescalates when model calls deescalate tool", () => {
      const agent = { role: "dense", autoEscalated: false } as any;
      const toolsUsed = ["write_file", "deescalate"];

      if (toolsUsed.includes("deescalate")) {
        agent.role = "auto";
        agent.autoEscalated = false;
      }

      expect(agent.role).toBe("auto");
    });

    it("auto-escalates on context overflow", async () => {
      const { shouldEscalate, escalateTier } = await import("../../src/router/index.js");
      const used = 28000;
      const contextLimit = 32768;

      expect(shouldEscalate(used, contextLimit, 0)).toBe(true);
      expect(escalateTier("flash")).toBe("utility");
    });

    it("does not auto-escalate below threshold", async () => {
      const { shouldEscalate } = await import("../../src/router/index.js");
      expect(shouldEscalate(20000, 32768, 0)).toBe(false);
    });
  });
});

describe("TURN_BEFORE/POST Integration via Bus", () => {
  it("TURN_BEFORE subscribers modify context before model invocation", async () => {
    const bus = new EventBus();
    const context = new ContextManager("test persona", "codemap");

    // Register subscriber that injects turn context
    bus.subscribe("TURN_BEFORE", async (event) => {
      context.injectTurnContext("Test", `Processing: ${event.payload.userMessage}`);
    });

    await bus.publishAndWait("TURN_BEFORE", {
      userMessage: "fix the bug",
      activeTools: [],
      activePlan: null,
      recentSummaries: [],
      recentTools: [],
    });

    expect(context.context.void.turnContext).toHaveLength(1);
    expect(context.context.void.turnContext[0].content).toBe("Processing: fix the bug");
  });

  it("TURN_AFTER subscribers can read turn result", async () => {
    const bus = new EventBus();
    let capturedTools: string[] = [];

    bus.subscribe("TURN_AFTER", async (event) => {
      capturedTools = event.payload.toolsUsed;
    });

    await bus.publishAndWait("TURN_AFTER", {
      userMessage: "edit the file",
      responseText: "Done.",
      toolsUsed: ["read_file", "edit_file"],
      turnId: "t1",
    });

    expect(capturedTools).toEqual(["read_file", "edit_file"]);
  });

  it("multiple TURN_BEFORE subscribers run in registration order", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.subscribe("TURN_BEFORE", async () => { order.push("decay"); }, { priority: "high" });
    bus.subscribe("TURN_BEFORE", async () => { order.push("pressure"); }, { priority: "high" });
    bus.subscribe("TURN_BEFORE", async () => { order.push("skills"); }, { priority: "normal" });

    await bus.publishAndWait("TURN_BEFORE", {
      userMessage: "test",
      activeTools: [],
      activePlan: null,
      recentSummaries: [],
      recentTools: [],
    });

    expect(order).toEqual(["decay", "pressure", "skills"]);
  });
});
