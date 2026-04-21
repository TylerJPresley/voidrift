/**
 * Tests for REQ-CHAT-1: /gather slash command — mode switch + pipeline dispatch.
 *
 * AC1: /gather → mode switch with requirements personality, history preserved
 * AC2: /exec gather --import → runs pipeline, REQUIREMENTS.md written, progress as system messages
 * AC3: /exec gather --idea → runs pipeline generating requirements from idea content
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODE_DEFS } from "../../src/commands/chat.js";

const chatSource = readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");
const helpSource = readFileSync(join(__dirname, "../../src/commands/help.ts"), "utf-8");

// ---------------------------------------------------------------------------
// AC1: /gather mode switch (REQ-CHAT-1 + REQ-CHAT-15)
// ---------------------------------------------------------------------------

describe("/gather mode switch (REQ-CHAT-1 AC1)", () => {
  it("bare /gather calls switchMode('gather')", () => {
    expect(chatSource).toContain('switchMode("gather")');
  });

  it("gather mode uses GATHER personality section", () => {
    expect(MODE_DEFS.gather.personalitySection).toBe("GATHER");
  });

  it("GATHER prompt section exists in chat.md with EARS requirements focus", () => {
    const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");
    const sections = chatMd.split(/^## /m).map(s => s.trim());
    const gatherSection = sections.find(s => s.startsWith("GATHER"));
    expect(gatherSection).toBeDefined();
    expect(gatherSection).toContain("EARS");
    expect(gatherSection).toContain("requirements");
  });
});

// ---------------------------------------------------------------------------
// AC2: /exec gather --import (REQ-CHAT-1 + REQ-CHAT-16)
// ---------------------------------------------------------------------------

describe("/exec gather --import (REQ-CHAT-1 AC2)", () => {
  it("handleGather parses --import flag", () => {
    expect(chatSource).toContain("--import\\s+(\\S+)");
  });

  it("--import calls runGather with importPath", () => {
    expect(chatSource).toContain("runGather(mc, importMatch[1]");
  });

  it("progress appears via createTUIStatus", () => {
    expect(chatSource).toContain("createTUIStatus(c)");
  });

  it("shows completion status as system message", () => {
    expect(chatSource).toContain("✓ Gather complete");
    expect(chatSource).toContain("✗ Gather failed");
  });
});

// ---------------------------------------------------------------------------
// AC3: /exec gather --idea (REQ-CHAT-1 + REQ-CHAT-16)
// ---------------------------------------------------------------------------

describe("/exec gather --idea (REQ-CHAT-1 AC3)", () => {
  it("handleGather parses --idea flag", () => {
    expect(chatSource).toContain("--idea\\s+(\\d+)");
  });

  it("--idea calls runGather with ideaId (pipeline, not steer)", () => {
    // Must call runGather with ideaId parameter, NOT agent.steer()
    expect(chatSource).toMatch(/runGather\(mc, undefined, Number\(ideaMatch\[1\]\)/);
  });

  it("does not use agent.steer() for --idea (pipeline mode)", () => {
    // The handleGather function should not contain agent.steer — that was the old bug
    const handleGatherBlock = chatSource.match(/const handleGather = async[\s\S]*?(?=\n  const handlePlan)/)?.[0] ?? "";
    expect(handleGatherBlock).not.toContain("agent.steer");
  });
});

// ---------------------------------------------------------------------------
// /gather routing: bare = mode switch, flags = /exec pipeline
// ---------------------------------------------------------------------------

describe("/gather routing (REQ-CHAT-1)", () => {
  it("/gather with --import delegates to handleExec", () => {
    expect(chatSource).toContain('cmdArgs.includes("--import")');
    expect(chatSource).toContain('handleExec(`gather ${cmdArgs}`)');
  });

  it("/gather with --idea delegates to handleExec", () => {
    expect(chatSource).toContain('cmdArgs.includes("--idea")');
  });

  it("bare /gather without flags is a mode switch", () => {
    // The else branch calls switchMode, not handleExec
    expect(chatSource).toContain('switchMode("gather")');
  });

  it("help shows /gather as mode switch and /exec gather for pipelines", () => {
    expect(helpSource).toContain("/gather");
    expect(helpSource).toContain("/exec gather --import");
    expect(helpSource).toContain("/exec gather --idea");
  });
});
