import { describe, it, expect } from "vitest";
import { compilePrompt } from "../../src/session/compiler.js";
import type { SessionContext } from "../../src/session/context.js";

function makeCtx(overrides?: Partial<SessionContext>): SessionContext {
  return {
    governance: { activePersona: "You are helpful.", activeTools: [], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
    workspace: { activePlan: null, focusedFiles: [], activeSkills: [], workspaceCodeMap: "", activeMemory: [], gitStatus: null },
    work: { messages: [], diagnostics: null },
    ...overrides,
  };
}

describe("Prompt Compiler", () => {
  it("puts governance first as system message", () => {
    const msgs = compilePrompt(makeCtx());
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("You are helpful.");
  });

  it("includes workspace partition after governance", () => {
    const ctx = makeCtx();
    ctx.workspace.workspaceCodeMap = "src/\n  index.ts";
    ctx.workspace.activePlan = "Step 1: do thing";
    const msgs = compilePrompt(ctx);
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("Workspace Map");
    expect(msgs[1].content).toContain("Active Plan");
  });

  it("places messages (work partition) after workspace", () => {
    const ctx = makeCtx();
    ctx.work.messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const msgs = compilePrompt(ctx);
    const userMsg = msgs.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("hi");
  });

  it("puts diagnostics at the very end", () => {
    const ctx = makeCtx();
    ctx.work.diagnostics = "Error: type mismatch";
    ctx.work.messages = [{ role: "user", content: "fix it" }];
    const msgs = compilePrompt(ctx);
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain("Diagnostics");
    expect(last.content).toContain("type mismatch");
  });

  it("includes skills in governance when present", () => {
    const ctx = makeCtx();
    ctx.governance.boundSkills = ["Use React Server Components"];
    const msgs = compilePrompt(ctx);
    expect(msgs[0].content).toContain("Agent Skills");
    expect(msgs[0].content).toContain("React Server Components");
  });
});
