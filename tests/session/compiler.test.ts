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

  it("puts diagnostics before conversation history", () => {
    const ctx = makeCtx();
    ctx.void.diagnostics = "Error: type mismatch";
    ctx.void.messages = [{ role: "user", content: "fix it" }];
    const msgs = compilePrompt(ctx);
    const diagIdx = msgs.findIndex(m => m.content.includes("Diagnostics"));
    const userIdx = msgs.findIndex(m => m.role === "user");
    expect(diagIdx).toBeGreaterThan(-1);
    expect(diagIdx).toBeLessThan(userIdx);
    expect(msgs[diagIdx].content).toContain("type mismatch");
  });

  it("includes skills in agent layer when present", () => {
    const ctx = makeCtx();
    ctx.agent.boundSkills = ["Use React Server Components"];
    const msgs = compilePrompt(ctx);
    expect(msgs[0].content).toContain("Agent Skills");
    expect(msgs[0].content).toContain("React Server Components");
  });

  it("includes drift layer (focused files) after orbit", () => {
    const ctx = makeCtx({
      drift: { focusedFiles: [{ path: "src/main.ts", summary: "Main entry", totalLines: 50, readRanges: [] }], gitStatus: null },
    });
    const messages = compilePrompt(ctx);
    const driftMsg = messages.find(m => m.content.includes("Focused: src/main.ts"));
    expect(driftMsg).toBeDefined();
    expect(driftMsg!.role).toBe("system");
  });

  it("includes git status in drift layer", () => {
    const ctx = makeCtx({
      drift: { focusedFiles: [], gitStatus: "M src/main.ts\nA src/new.ts" },
    });
    const messages = compilePrompt(ctx);
    const driftMsg = messages.find(m => m.content.includes("Git Status"));
    expect(driftMsg).toBeDefined();
    expect(driftMsg!.content).toContain("M src/main.ts");
  });

  it("injects turn context as system messages before history", () => {
    const ctx = makeCtx({
      void: {
        messages: [{ role: "user", content: "hello" }],
        fullHistory: [{ role: "user", content: "hello" }],
        diagnostics: null,
        turnContext: [{ label: "Context Budget", content: "Usage: 60%" }],
      },
    });
    const messages = compilePrompt(ctx);
    const tcMsg = messages.find(m => m.content.includes("Context Budget"));
    expect(tcMsg).toBeDefined();
    expect(tcMsg!.role).toBe("system");
    // Turn context should appear before user messages
    const tcIdx = messages.indexOf(tcMsg!);
    const userIdx = messages.findIndex(m => m.role === "user");
    expect(tcIdx).toBeLessThan(userIdx);
  });

  it("strips <antThinking> tags from assistant messages", () => {
    const ctx = makeCtx({
      void: {
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "<antThinking>internal reasoning</antThinking>The actual response" },
        ],
        fullHistory: [],
        diagnostics: null,
        turnContext: [],
      },
    });
    const messages = compilePrompt(ctx);
    const assistant = messages.find(m => m.role === "assistant");
    expect(assistant!.content).not.toContain("antThinking");
    expect(assistant!.content).toContain("The actual response");
  });

  it("strips <think> tags from assistant messages", () => {
    const ctx = makeCtx({
      void: {
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "<think>reasoning here</think>The answer" },
        ],
        fullHistory: [],
        diagnostics: null,
        turnContext: [],
      },
    });
    const messages = compilePrompt(ctx);
    const assistant = messages.find(m => m.role === "assistant");
    expect(assistant!.content).not.toContain("<think>");
    expect(assistant!.content).toContain("The answer");
  });

  it("filters empty assistant messages with no tool calls", () => {
    const ctx = makeCtx({
      void: {
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "   " },
          { role: "user", content: "again" },
          { role: "assistant", content: "real response" },
        ],
        fullHistory: [],
        diagnostics: null,
        turnContext: [],
      },
    });
    const messages = compilePrompt(ctx);
    const assistants = messages.filter(m => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("real response");
  });

  it("includes active memory in orbit layer", () => {
    const ctx = makeCtx({
      orbit: { activePlan: null, activeSkills: [], workspaceCodeMap: "", activeMemory: ["Always use snake_case for API fields."] },
    });
    const messages = compilePrompt(ctx);
    const orbitMsg = messages.find(m => m.content.includes("Memory"));
    expect(orbitMsg).toBeDefined();
    expect(orbitMsg!.content).toContain("snake_case");
  });
});
