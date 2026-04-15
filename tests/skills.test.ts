import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSkill, listSkills, availableSkillsWithDesc, clearSkillCache } from "../src/skills.js";

describe("findSkill", () => {
  const tmp = join(tmpdir(), `voidrift-test-skills-${Date.now()}`);
  const nsDir = join(tmp, "resources", "skills");
  const domainDir = join(tmp, "domain-skills");
  const projectDir = join(tmp, "project");
  const projectSkillDir = join(projectDir, ".voidrift", "skills");

  beforeEach(() => {
    clearSkillCache();
    mkdirSync(nsDir, { recursive: true });
    mkdirSync(domainDir, { recursive: true });
    mkdirSync(projectSkillDir, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearSkillCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves from north star layer", () => {
    writeFileSync(join(nsDir, "BACKEND-ENG.md"), "---\nname: BACKEND-ENG\ndescription: Backend\n---\n\n# Backend Engineering\n\nContent here.");
    const result = findSkill("BACKEND-ENG", projectDir);
    expect(result).toContain("# Backend Engineering");
    expect(result).not.toContain("---");
  });

  it("project skill overrides north star", () => {
    writeFileSync(join(nsDir, "QUALITY-QA.md"), "---\nname: QUALITY-QA\n---\n\nNorth star version");
    writeFileSync(join(projectSkillDir, "QUALITY-QA.md"), "---\nname: QUALITY-QA\n---\n\nProject version");
    const result = findSkill("QUALITY-QA", projectDir);
    expect(result).toContain("Project version");
    expect(result).not.toContain("North star");
  });

  it("returns null for missing skill", () => {
    expect(findSkill("NONEXISTENT", projectDir)).toBeNull();
  });

  it("is case-insensitive", () => {
    writeFileSync(join(nsDir, "WEB-ENG.md"), "---\nname: WEB-ENG\n---\n\nWeb content");
    expect(findSkill("web-eng", projectDir)).toContain("Web content");
  });

  it("strips YAML frontmatter", () => {
    writeFileSync(join(nsDir, "TEST.md"), "---\nname: TEST\ndescription: A test\nallowed_tools: [file]\n---\n\nBody only");
    const result = findSkill("TEST", projectDir);
    expect(result).toBe("\nBody only");
    expect(result).not.toContain("allowed_tools");
  });
});

describe("listSkills", () => {
  const tmp = join(tmpdir(), `voidrift-test-list-skills-${Date.now()}`);
  const nsDir = join(tmp, "resources", "skills");

  beforeEach(() => {
    clearSkillCache();
    mkdirSync(nsDir, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearSkillCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("lists skills with layer attribution", () => {
    writeFileSync(join(nsDir, "A.md"), "---\nname: A\ndescription: Skill A\n---\n\nBody");
    writeFileSync(join(nsDir, "B.md"), "---\nname: B\ndescription: Skill B\n---\n\nBody");
    const skills = listSkills("/nonexistent");
    expect(skills.length).toBe(2);
    expect(skills[0].layer).toBe("north-star");
    expect(skills.map(s => s.name).sort()).toEqual(["A", "B"]);
  });
});

describe("availableSkillsWithDesc", () => {
  const tmp = join(tmpdir(), `voidrift-test-desc-${Date.now()}`);
  const nsDir = join(tmp, "resources", "skills");

  beforeEach(() => {
    clearSkillCache();
    mkdirSync(nsDir, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearSkillCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns name:description map", () => {
    writeFileSync(join(nsDir, "X.md"), "---\nname: X\ndescription: Does X things\n---\n\nBody");
    const result = availableSkillsWithDesc("/nonexistent");
    expect(result["X"]).toBe("Does X things");
  });
});
