/**
 * Tests for REQ-SKL-2: Skill allowed_tools enforcement.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loopSource = readFileSync(join(__dirname, "../src/agent/loop.ts"), "utf-8");
const developSource = readFileSync(join(__dirname, "../src/commands/develop.ts"), "utf-8");

// ---------------------------------------------------------------------------
// AgentLoop enforcement (AC1)
// ---------------------------------------------------------------------------

describe("AgentLoop skill tool restriction (REQ-SKL-2)", () => {
  it("accepts skillAllowedTools option", () => {
    expect(loopSource).toContain("skillAllowedTools?: { skill: string; tools: string[] }");
  });

  it("stores skillAllowedTools in constructor", () => {
    expect(loopSource).toContain("this._skillAllowedTools = opts.skillAllowedTools");
  });

  it("checks tool name against allowed list before beforeToolCall", () => {
    const restrictIdx = loopSource.indexOf("_skillAllowedTools.tools.includes(name)");
    const beforeIdx = loopSource.indexOf("this.beforeToolCall", restrictIdx);
    expect(restrictIdx).toBeGreaterThan(-1);
    expect(beforeIdx).toBeGreaterThan(restrictIdx);
  });

  it("returns error naming the skill", () => {
    expect(loopSource).toContain("blocked by skill '${this._skillAllowedTools.skill}'");
  });

  it("returns error listing allowed tools", () => {
    expect(loopSource).toContain("Allowed tools: ${this._skillAllowedTools.tools.join");
  });
});

// ---------------------------------------------------------------------------
// No restriction = all tools available (AC2)
// ---------------------------------------------------------------------------

describe("no restriction allows all tools (REQ-SKL-2)", () => {
  it("check is conditional on _skillAllowedTools being set", () => {
    expect(loopSource).toContain("if (this._skillAllowedTools && !");
  });
});

// ---------------------------------------------------------------------------
// Develop wiring
// ---------------------------------------------------------------------------

describe("develop.ts wires skill restrictions (REQ-SKL-2)", () => {
  it("imports getSkillAllowedTools", () => {
    expect(developSource).toContain("getSkillAllowedTools");
  });

  it("calls getSkillAllowedTools for each task skill", () => {
    expect(developSource).toContain("getSkillAllowedTools(String(s))");
  });

  it("passes skillAllowedTools to AgentLoop", () => {
    expect(developSource).toContain("skillAllowedTools: skillRestriction");
  });
});
