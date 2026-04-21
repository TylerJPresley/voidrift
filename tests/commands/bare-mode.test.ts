/**
 * Tests for REQ-CHAT-6: /bare mid-session toggle with freeze/resume.
 *
 * AC1: /bare freezes current agent, bare agent has no governance layer
 * AC2: /chat resumes frozen agent exactly as before, in chat mode
 * AC3: /plan resumes frozen agent with plan mode governance
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const chatSource = readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");
const helpSource = readFileSync(join(__dirname, "../../src/commands/help.ts"), "utf-8");

// ---------------------------------------------------------------------------
// AC1: /bare freezes agent, bare agent has no governance
// ---------------------------------------------------------------------------

describe("/bare freezes agent (REQ-CHAT-6 AC1)", () => {
  it("/bare command is routed in slash dispatch", () => {
    expect(chatSource).toContain('cmd === "/bare"');
    expect(chatSource).toContain("enterBare()");
  });

  it("enterBare saves current messages to frozenMessages", () => {
    expect(chatSource).toContain("frozenMessages = [...agent.messages]");
  });

  it("enterBare sets isBare flag", () => {
    expect(chatSource).toContain("isBare = true");
  });

  it("bare agent uses framework context only (no governance)", () => {
    // enterBare creates a new messages array with just the system CONTEXT prompt
    expect(chatSource).toMatch(/enterBare[\s\S]*?loadPrompt\("system", "CONTEXT"\)/);
    // The bare prompt does NOT include START.md, CONTRIBUTING.md, skills, memory, git
    const enterBareBlock = chatSource.match(/function enterBare\(\)[\s\S]*?(?=\n  function exitBare)/)?.[0] ?? "";
    expect(enterBareBlock).not.toContain("startMd");
    expect(enterBareBlock).not.toContain("contributingMd");
    expect(enterBareBlock).not.toContain("findSkill");
    expect(enterBareBlock).not.toContain("memoryIndex");
    expect(enterBareBlock).not.toContain("gitSnapshot");
  });

  it("bare agent starts with fresh message history", () => {
    expect(chatSource).toContain('agent.messages = [{ role: "system", content: barePrompt }]');
  });

  it("footer shows /bare mode", () => {
    expect(chatSource).toContain('footer.setMode("/bare")');
  });
});

// ---------------------------------------------------------------------------
// AC2: /chat resumes frozen agent in chat mode
// ---------------------------------------------------------------------------

describe("/chat resumes from bare (REQ-CHAT-6 AC2)", () => {
  it("/chat calls switchMode which checks isBare", () => {
    expect(chatSource).toContain('switchMode("chat")');
  });

  it("switchMode calls exitBare when isBare is true", () => {
    expect(chatSource).toContain("if (isBare) { exitBare(targetMode)");
  });

  it("exitBare restores frozenMessages", () => {
    expect(chatSource).toContain("agent.messages = frozenMessages");
  });

  it("exitBare clears bare state", () => {
    expect(chatSource).toContain("frozenMessages = null");
    expect(chatSource).toContain("isBare = false");
  });

  it("exitBare calls rebuildGovernance for the target mode", () => {
    const exitBareBlock = chatSource.match(/function exitBare[\s\S]*?(?=\n  \/\*\*|\n  \/\/ Chat context)/)?.[0] ?? "";
    expect(exitBareBlock).toContain("rebuildGovernance(targetMode)");
  });
});

// ---------------------------------------------------------------------------
// AC3: /plan resumes with plan mode governance
// ---------------------------------------------------------------------------

describe("/plan resumes from bare (REQ-CHAT-6 AC3)", () => {
  it("/plan calls switchMode('plan')", () => {
    expect(chatSource).toContain('switchMode("plan")');
  });

  it("switchMode dispatches to exitBare or rebuildGovernance", () => {
    // switchMode handles both bare→mode and mode→mode transitions
    expect(chatSource).toContain("if (isBare) { exitBare(targetMode); } else { rebuildGovernance(targetMode); }");
  });
});

// ---------------------------------------------------------------------------
// All mode commands use switchMode (bare-aware)
// ---------------------------------------------------------------------------

describe("all mode commands are bare-aware (REQ-CHAT-6)", () => {
  it("/gather uses switchMode", () => {
    expect(chatSource).toContain('switchMode("gather")');
  });

  it("/idea uses switchMode", () => {
    expect(chatSource).toContain('switchMode("idea")');
  });
});

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

describe("/bare in help text (REQ-CHAT-6)", () => {
  it("help shows /bare command", () => {
    expect(helpSource).toContain("/bare");
    expect(helpSource).toContain("raw model access");
  });
});
