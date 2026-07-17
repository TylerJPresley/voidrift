import { describe, it, expect } from "vitest";
import { SkillManager } from "../../src/skills/manager.js";
import { InMemorySkillRepository } from "../../src/skills/repository.js";

describe("SkillManager (in-memory)", () => {
  function create() {
    const repo = new InMemorySkillRepository();
    repo.add({
      name: "react",
      description: "React component patterns",
      triggers: { extensions: [".tsx", ".jsx"], keywords: ["component", "hook"] },
      agents: ["chat"],
      active: true,
      content: "# React\nUse functional components with hooks.",
      filePath: "(test)/react.md",
      sourcePlugin: "test",
    });
    repo.add({
      name: "testing",
      description: "How to write tests",
      triggers: { keywords: ["test", "vitest", "jest"] },
      agents: [],
      active: true,
      content: "# Testing\nUse vitest. Prefer unit tests.",
      filePath: "(test)/testing.md",
      sourcePlugin: "test",
    });
    repo.add({
      name: "disabled",
      description: "This is disabled",
      triggers: { keywords: ["disabled"] },
      agents: [],
      active: false,
      content: "Should not load.",
      filePath: "(test)/disabled.md",
      sourcePlugin: "test",
    });
    const sm = new SkillManager(repo);
    sm.index(["(test)"]);
    return sm;
  }

  it("indexes skills from repository", () => {
    const sm = create();
    expect(sm.indexedSkills).toHaveLength(3);
  });

  it("resolve matches by keyword", () => {
    const sm = create();
    const resolved = sm.resolveMatchingSkillContent({ focusedFiles: [], userInput: "write a test for auth", activePlan: null });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toContain("# Testing");
  });

  it("resolve matches by file extension", () => {
    const sm = create();
    const resolved = sm.resolveMatchingSkillContent({ focusedFiles: ["src/App.tsx"], userInput: "fix this", activePlan: null });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toContain("# React");
  });

  it("resolve matches by agent binding", () => {
    const sm = create();
    const resolved = sm.resolveMatchingSkillContent({ focusedFiles: [], userInput: "something unrelated", activePlan: null }, "chat");
    expect(resolved.some(s => s.includes("# React"))).toBe(true);
  });

  it("resolve skips inactive skills", () => {
    const sm = create();
    const resolved = sm.resolveMatchingSkillContent({ focusedFiles: [], userInput: "disabled keyword here", activePlan: null });
    expect(resolved.every(s => !s.includes("Should not load"))).toBe(true);
  });

  it("builtins persist across reindex", () => {
    const repo = new InMemorySkillRepository();
    const sm = new SkillManager(repo);
    sm.register({
      name: "builtin-skill",
      description: "Always here",
      triggers: { keywords: ["builtin"] },
      agents: [],
      active: true,
      content: "I'm built-in.",
      sourcePlugin: "core",
    });
    sm.index(["(test)"]);
    expect(sm.indexedSkills).toHaveLength(1);
    expect(sm.indexedSkills[0].name).toBe("builtin-skill");
    // Re-index doesn't lose builtins
    sm.index(["(test)"]);
    expect(sm.indexedSkills).toHaveLength(1);
  });

  it("validate detects invalid agent references", () => {
    const sm = create();
    const issues = sm.validate(["chat", "plan", "vibe"]);
    expect(issues).toHaveLength(0);

    const issues2 = sm.validate(["plan", "vibe"]); // "chat" missing
    expect(issues2).toHaveLength(1);
    expect(issues2[0].invalidAgents).toContain("chat");
  });
});
