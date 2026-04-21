/**
 * Tests for REQ-CHAT-12: 4-stage idea refinement flow.
 *
 * AC1: New idea → agent asks to describe (Intake)
 * AC2: Intake complete → clarifying questions (Exploration)
 * AC3: Exploration complete → proposes user story, ACs, modules (Shaping)
 * AC4: Shaping complete → presents complete structured idea (Summary)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ideaSource = readFileSync(join(__dirname, "../../src/commands/idea.ts"), "utf-8");
const chatMd = readFileSync(join(__dirname, "../../resources/prompts/chat.md"), "utf-8");

// Extract the IDEA section from chat.md
const ideaSectionMatch = chatMd.match(/## IDEA\n([\s\S]*?)(?=\n## )/);
const ideaPrompt = ideaSectionMatch?.[1] ?? "";

// ---------------------------------------------------------------------------
// AC1: New idea → Intake stage
// ---------------------------------------------------------------------------

describe("new idea starts Intake (REQ-CHAT-12 AC1)", () => {
  it("IdeaStartCommand sends Intake prompt for new ideas", () => {
    expect(ideaSource).toContain("A new idea is being created. Start with Stage 1");
    expect(ideaSource).toContain("Intake");
  });

  it("new idea path creates session (does not return error)", () => {
    // When id doesn't exist, should NOT return "not found" — should create
    expect(ideaSource).not.toMatch(/not found.*return 1/);
  });

  it("IDEA prompt describes Intake stage", () => {
    expect(ideaPrompt).toContain("Stage 1");
    expect(ideaPrompt).toContain("Intake");
    expect(ideaPrompt).toContain("describe the idea at a high level");
  });
});

// ---------------------------------------------------------------------------
// AC2: Intake → Exploration
// ---------------------------------------------------------------------------

describe("Intake → Exploration (REQ-CHAT-12 AC2)", () => {
  it("IDEA prompt describes Exploration stage with clarifying questions", () => {
    expect(ideaPrompt).toContain("Stage 2");
    expect(ideaPrompt).toContain("Exploration");
    expect(ideaPrompt).toContain("clarifying questions");
  });

  it("Exploration references existing requirements and architecture", () => {
    expect(ideaPrompt).toContain("requirements");
    expect(ideaPrompt).toContain("architecture");
  });

  it("Exploration challenges scope and assumptions", () => {
    expect(ideaPrompt).toContain("scope");
    expect(ideaPrompt).toContain("assumptions");
  });
});

// ---------------------------------------------------------------------------
// AC3: Exploration → Shaping
// ---------------------------------------------------------------------------

describe("Exploration → Shaping (REQ-CHAT-12 AC3)", () => {
  it("IDEA prompt describes Shaping stage", () => {
    expect(ideaPrompt).toContain("Stage 3");
    expect(ideaPrompt).toContain("Shaping");
  });

  it("Shaping proposes user story with acceptance criteria", () => {
    expect(ideaPrompt).toContain("user story");
    expect(ideaPrompt).toContain("acceptance criteria");
  });

  it("Shaping identifies affected modules", () => {
    expect(ideaPrompt).toContain("affected modules");
  });
});

// ---------------------------------------------------------------------------
// AC4: Shaping → Summary
// ---------------------------------------------------------------------------

describe("Shaping → Summary (REQ-CHAT-12 AC4)", () => {
  it("IDEA prompt describes Summary stage", () => {
    expect(ideaPrompt).toContain("Stage 4");
    expect(ideaPrompt).toContain("Summary");
  });

  it("Summary presents complete structured idea for review", () => {
    expect(ideaPrompt).toContain("complete structured idea");
    expect(ideaPrompt).toContain("operator review");
  });
});

// ---------------------------------------------------------------------------
// Agent drives the conversation
// ---------------------------------------------------------------------------

describe("agent drives conversation (REQ-CHAT-12)", () => {
  it("IDEA prompt instructs agent to stay in current stage", () => {
    expect(ideaPrompt).toContain("Stay in the current stage");
  });

  it("IDEA prompt instructs agent to ask limited questions at a time", () => {
    expect(ideaPrompt).toContain("one or two questions at a time");
  });

  it("all 4 stages appear in order in the prompt", () => {
    const s1 = ideaPrompt.indexOf("Stage 1");
    const s2 = ideaPrompt.indexOf("Stage 2");
    const s3 = ideaPrompt.indexOf("Stage 3");
    const s4 = ideaPrompt.indexOf("Stage 4");
    expect(s1).toBeGreaterThan(-1);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(s4).toBeGreaterThan(s3);
  });
});
