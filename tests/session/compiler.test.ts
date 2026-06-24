import { describe, it, expect } from "vitest";
import { compilePrompt } from "../../src/session/compiler.js";
import type { SessionContext } from "../../src/session/context.js";

function makeCtx(overrides?: Partial<SessionContext>): SessionContext {
  return {
    agent: { activePersona: "You are helpful.", activeTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
    orbit: { activePlan: null, activeSkills: [], workspaceCodeMap: "", activeMemory: [] },
    drift: { focusedFiles: [], gitStatus: null },
    void: { messages: [], diagnostics: null, turnContext: [] },
    ...overrides,
  };
}

describe("Prompt Compiler", () => {
  it("puts agent layer first as system message", () => {
    const msgs = compilePrompt(makeCtx());
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("You are helpful.");
  });

  it("includes orbit partition after agent", () => {
    const ctx = makeCtx();
    ctx.orbit.workspaceCodeMap = "src/\n  index.ts";
    ctx.orbit.activePlan = "Step 1: do thing";
    const msgs = compilePrompt(ctx);
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("Active Plan");
  });

  it("places messages (void partition) after orbit", () => {
    const ctx = makeCtx();
    ctx.void.messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const msgs = compilePrompt(ctx);
    const userMsg = msgs.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("hi");
  });

  it("puts diagnostics at the very end", () => {
    const ctx = makeCtx();
    ctx.void.diagnostics = "Error: type mismatch";
    ctx.void.messages = [{ role: "user", content: "fix it" }];
    const msgs = compilePrompt(ctx);
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain("Diagnostics");
    expect(last.content).toContain("type mismatch");
  });

  it("includes skills in agent layer when present", () => {
    const ctx = makeCtx();
    ctx.agent.boundSkills = ["Use React Server Components"];
    const msgs = compilePrompt(ctx);
    expect(msgs[0].content).toContain("Agent Skills");
    expect(msgs[0].content).toContain("React Server Components");
  });
});
