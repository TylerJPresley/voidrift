import { describe, it, expect, vi } from "vitest";
import { validateFrontmatter, validateSkillFile, validateJSON, validatePromptFile } from "../../src/utils/safe-edit.js";

describe("validateJSON", () => {
  it("passes valid JSON", () => {
    expect(validateJSON('{"key": "value"}')).toEqual({ valid: true });
  });

  it("fails invalid JSON", () => {
    const result = validateJSON("{broken");
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("Invalid JSON");
  });

  it("passes empty object", () => {
    expect(validateJSON("{}")).toEqual({ valid: true });
  });

  it("passes array", () => {
    expect(validateJSON("[1,2,3]")).toEqual({ valid: true });
  });
});

describe("validateFrontmatter", () => {
  it("passes with all required fields", () => {
    const content = "---\nid: mem-1\ntitle: Test\nsummary: A test\n---\nBody content";
    expect(validateFrontmatter(content).valid).toBe(true);
  });

  it("fails without frontmatter", () => {
    const result = validateFrontmatter("No frontmatter here");
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("frontmatter");
  });

  it("fails with missing id", () => {
    const result = validateFrontmatter("---\ntitle: Test\nsummary: A test\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: id");
  });

  it("fails with missing title", () => {
    const result = validateFrontmatter("---\nid: x\nsummary: A test\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: title");
  });

  it("fails with missing summary", () => {
    const result = validateFrontmatter("---\nid: x\ntitle: Test\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: summary");
  });
});

describe("validateSkillFile", () => {
  it("passes valid skill file", () => {
    const content = "---\nname: my-skill\ndescription: Does things\ntriggers:\n  keywords: [test]\nactive: true\n---\nContent";
    expect(validateSkillFile(content).valid).toBe(true);
  });

  it("fails without frontmatter", () => {
    expect(validateSkillFile("No frontmatter").valid).toBe(false);
  });

  it("fails without name", () => {
    const result = validateSkillFile("---\ndescription: x\ntriggers:\n  keywords: []\nactive: true\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: name");
  });

  it("fails without triggers", () => {
    const result = validateSkillFile("---\nname: x\ndescription: x\nactive: true\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: triggers");
  });

  it("fails without active", () => {
    const result = validateSkillFile("---\nname: x\ndescription: x\ntriggers:\n  keywords: []\n---\n");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: active");
  });
});

describe("validatePromptFile", () => {
  it("passes non-empty content", () => {
    expect(validatePromptFile("You are a helpful assistant.").valid).toBe(true);
  });

  it("fails on empty content", () => {
    const result = validatePromptFile("");
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("empty");
  });

  it("fails on whitespace-only", () => {
    expect(validatePromptFile("   \n  ").valid).toBe(false);
  });

  it("passes with valid frontmatter tier", () => {
    expect(validatePromptFile("---\ntier: flash\n---\nContent").valid).toBe(true);
  });

  it("fails with invalid tier", () => {
    const result = validatePromptFile("---\ntier: mega\n---\nContent");
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("tier");
  });
});
