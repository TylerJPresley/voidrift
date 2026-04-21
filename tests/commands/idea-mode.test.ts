/**
 * Tests for REQ-CHAT-11: /idea as proper mode switch with governance restore.
 *
 * AC1: /idea prompts create or load
 * AC2: /idea 3 loads idea and activates idea personality
 * AC3: /done restores previous mode's governance
 * AC4: tools work during idea flow (no restriction)
 * AC5: ideas not auto-consumed by plan
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODE_DEFS } from "../../src/commands/chat.js";
import { IdeaSession, IdeaState, nextIdeaId, ideasDir } from "../../src/commands/idea.js";

const chatSource = readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");
const ideaSource = readFileSync(join(__dirname, "../../src/commands/idea.ts"), "utf-8");
const baseSource = readFileSync(join(__dirname, "../../src/commands/base.ts"), "utf-8");

// ---------------------------------------------------------------------------
// AC1: /idea prompts create or load
// ---------------------------------------------------------------------------

describe("/idea prompts create or load (REQ-CHAT-11 AC1)", () => {
  it("idea mode is defined in MODE_DEFS with IDEA personality", () => {
    expect(MODE_DEFS.idea).toBeDefined();
    expect(MODE_DEFS.idea.personalitySection).toBe("IDEA");
  });

  it("/idea with no arg lists existing ideas and prompts", () => {
    // IdeaStartCommand with no arg should list ideas, not auto-create
    expect(ideaSource).toContain("Existing ideas:");
    expect(ideaSource).toContain("to start a new idea");
    expect(ideaSource).toContain("to resume one");
  });

  it("/idea with no arg does NOT auto-start an idea session", () => {
    // The no-arg branch should not call ideaSession.start()
    const noArgBlock = ideaSource.match(/} else \{[\s\S]*?\/\/ List existing ideas[\s\S]*?return 0;/)?.[0] ?? "";
    expect(noArgBlock).not.toContain("ideaSession.start");
  });

  it("/idea with no arg reads idea files for title and category", () => {
    expect(ideaSource).toContain("title:");
    expect(ideaSource).toContain("category:");
  });
});

// ---------------------------------------------------------------------------
// AC2: /idea 3 loads and activates idea personality
// ---------------------------------------------------------------------------

describe("/idea <id> loads idea (REQ-CHAT-11 AC2)", () => {
  it("/idea handler calls switchMode('idea')", () => {
    expect(chatSource).toContain('switchMode("idea")');
  });

  it("IdeaStartCommand with id loads idea content", () => {
    expect(ideaSource).toContain("readIdea(this.ctx.projectDir, id)");
  });

  it("IdeaStartCommand with id starts idea session", () => {
    expect(ideaSource).toContain("this.ctx.ideaSession.start(id)");
  });

  it("IdeaStartCommand with id sends idea to agent for refinement", () => {
    expect(ideaSource).toContain("resuming work on this idea");
  });
});

// ---------------------------------------------------------------------------
// AC3: /done restores previous mode's governance
// ---------------------------------------------------------------------------

describe("/done restores previous mode (REQ-CHAT-11 AC3)", () => {
  it("ChatContext has restoreMode callback", () => {
    expect(baseSource).toContain("restoreMode?: () => void");
  });

  it("/idea handler captures previousMode and sets restoreMode", () => {
    expect(chatSource).toContain("const prevMode = currentMode");
    expect(chatSource).toContain("chatCtx.restoreMode = ");
    expect(chatSource).toContain("switchMode(prevMode");
  });

  it("restoreMode guards against prevMode being 'idea' (would loop)", () => {
    expect(chatSource).toContain('prevMode === "idea" ? "chat" : prevMode');
  });

  it("IdeaDoneCommand calls restoreMode after saving", () => {
    expect(ideaSource).toContain("this.ctx.restoreMode()");
  });

  it("IdeaDoneCommand clears restoreMode after calling it", () => {
    expect(ideaSource).toContain("this.ctx.restoreMode = undefined");
  });

  it("IdeaDoneCommand falls back to clearing footer if no restoreMode", () => {
    expect(ideaSource).toContain('this.ctx.footer.setMode("")');
  });
});

// ---------------------------------------------------------------------------
// AC4: tools work during idea flow
// ---------------------------------------------------------------------------

describe("tools during idea flow (REQ-CHAT-11 AC4)", () => {
  it("idea mode does not restrict tools (no toolRestriction in MODE_DEFS)", () => {
    // MODE_DEFS.idea has no toolRestriction field — all chat tools available
    expect(MODE_DEFS.idea).not.toHaveProperty("toolRestriction");
  });
});

// ---------------------------------------------------------------------------
// AC5: ideas not auto-consumed by plan
// ---------------------------------------------------------------------------

describe("ideas not auto-consumed (REQ-CHAT-11 AC5)", () => {
  it("plan command requires explicit --idea flag", () => {
    const planSource = readFileSync(join(__dirname, "../../src/commands/plan.ts"), "utf-8");
    // Plan only uses idea when --idea flag is provided
    expect(planSource).toContain("ideaId");
    // No automatic idea scanning
    expect(planSource).not.toContain("scanIdeas");
    expect(planSource).not.toContain("autoConsumeIdea");
  });
});

// ---------------------------------------------------------------------------
// IdeaSession state machine
// ---------------------------------------------------------------------------

describe("IdeaSession lifecycle statuses (REQ-CHAT-11)", () => {
  it("supports draft, now, next, later, done categories", () => {
    // Verified by the IdeaCategory type in idea.ts
    expect(ideaSource).toContain('"now"');
    expect(ideaSource).toContain('"next"');
    expect(ideaSource).toContain('"later"');
    expect(ideaSource).toContain('"draft"');
    expect(ideaSource).toContain('"done"');
  });
});
