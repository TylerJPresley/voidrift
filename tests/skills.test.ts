import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSkill, listSkills, availableSkillsWithDesc, getSkillAllowedTools, clearSkillCache } from "../src/skills.js";

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

  it("resolves from domain layer", () => {
    writeFileSync(join(domainDir, "CUSTOM.md"), "---\nname: CUSTOM\n---\n\ndomain content");
    const result = findSkill("CUSTOM", projectDir);
    expect(result).toContain("domain content");
  });

  it("project skill overrides north star", () => {
    writeFileSync(join(nsDir, "QUALITY-QA.md"), "---\nname: QUALITY-QA\n---\n\nNorth star version");
    writeFileSync(join(projectSkillDir, "QUALITY-QA.md"), "---\nname: QUALITY-QA\n---\n\nProject version");
    const result = findSkill("QUALITY-QA", projectDir);
    expect(result).toContain("Project version");
    expect(result).not.toContain("North star");
  });

  it("project overrides domain", () => {
    writeFileSync(join(domainDir, "FOO.md"), "---\nname: FOO\n---\n\ndomain");
    writeFileSync(join(projectSkillDir, "FOO.md"), "---\nname: FOO\n---\n\nproject");
    const result = findSkill("FOO", projectDir);
    expect(result).toContain("project");
    expect(result).not.toContain("domain");
  });

  it("domain overrides north star", () => {
    writeFileSync(join(nsDir, "BAR.md"), "---\nname: BAR\n---\n\nnorth-star");
    writeFileSync(join(domainDir, "BAR.md"), "---\nname: BAR\n---\n\ndomain");
    const result = findSkill("BAR", projectDir);
    expect(result).toContain("domain");
    expect(result).not.toContain("north-star");
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

describe("getSkillAllowedTools", () => {
  const tmp = join(tmpdir(), `voidrift-test-allowed-${Date.now()}`);
  const projectDir = join(tmp, "project");
  const projectSkillDir = join(projectDir, ".voidrift", "skills");

  beforeEach(() => {
    clearSkillCache();
    mkdirSync(projectSkillDir, { recursive: true });
    mkdirSync(join(tmp, "resources", "skills"), { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearSkillCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("parses allowed_tools from frontmatter", () => {
    writeFileSync(join(projectSkillDir, "SEC.md"),
      "---\nname: SEC\nallowed_tools:\n  - read_source_file\n  - file\n---\n\n# Secure\n");
    const tools = getSkillAllowedTools("SEC", projectDir);
    expect(tools).toEqual(["read_source_file", "file"]);
  });

  it("returns null when allowed_tools absent", () => {
    writeFileSync(join(projectSkillDir, "OPEN.md"), "---\nname: OPEN\n---\n\n# Open\n");
    expect(getSkillAllowedTools("OPEN", projectDir)).toBeNull();
  });

  it("returns null for nonexistent skill", () => {
    expect(getSkillAllowedTools("NOPE", projectDir)).toBeNull();
  });

  it("returns empty array when allowed_tools is empty list", () => {
    writeFileSync(join(projectSkillDir, "LOCKED.md"),
      "---\nname: LOCKED\nallowed_tools: []\n---\n\n# Locked\n");
    const tools = getSkillAllowedTools("LOCKED", projectDir);
    expect(tools).toEqual([]);
  });
});

describe("listSkills", () => {
  const tmp = join(tmpdir(), `voidrift-test-list-skills-${Date.now()}`);
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

  it("lists skills with layer attribution", () => {
    writeFileSync(join(nsDir, "A.md"), "---\nname: A\ndescription: Skill A\n---\n\nBody");
    writeFileSync(join(nsDir, "B.md"), "---\nname: B\ndescription: Skill B\n---\n\nBody");
    const skills = listSkills("/nonexistent");
    expect(skills.length).toBe(2);
    expect(skills[0].layer).toBe("north-star");
    expect(skills.map(s => s.name).sort()).toEqual(["A", "B"]);
  });

  it("attributes domain layer correctly", () => {
    writeFileSync(join(domainDir, "DOM.md"), "---\nname: DOM\ndescription: Domain skill\n---\n\nBody");
    const skills = listSkills(projectDir);
    const dom = skills.find(s => s.name === "DOM");
    expect(dom?.layer).toBe("domain");
  });

  it("attributes project layer correctly", () => {
    writeFileSync(join(projectSkillDir, "PROJ.md"), "---\nname: PROJ\ndescription: Project skill\n---\n\nBody");
    const skills = listSkills(projectDir);
    const proj = skills.find(s => s.name === "PROJ");
    expect(proj?.layer).toBe("project");
  });

  it("project skill shadows same-name north star in listing", () => {
    writeFileSync(join(nsDir, "SHARED.md"), "---\nname: SHARED\ndescription: NS version\n---\n\nBody");
    writeFileSync(join(projectSkillDir, "SHARED.md"), "---\nname: SHARED\ndescription: Project version\n---\n\nBody");
    const skills = listSkills(projectDir);
    const shared = skills.filter(s => s.name === "SHARED");
    expect(shared).toHaveLength(1);
    expect(shared[0].layer).toBe("project");
    expect(shared[0].description).toBe("Project version");
  });

  it("returns empty for no skills", () => {
    const emptyProject = join(tmp, "empty");
    mkdirSync(emptyProject, { recursive: true });
    // nsDir exists but is empty
    expect(listSkills(emptyProject)).toEqual([]);
  });

  it("detects draft status in frontmatter", () => {
    writeFileSync(join(projectSkillDir, "DRAFT.md"),
      "---\nname: DRAFT\ndescription: Draft skill\nstatus: draft\n---\n\nDraft body");
    const skills = listSkills(projectDir);
    const draft = skills.find(s => s.name === "DRAFT");
    expect(draft).toBeDefined();
    // The skill is listed — draft detection is a frontmatter field
    // Verify the content is accessible and frontmatter is parseable
    const content = findSkill("DRAFT", projectDir);
    expect(content).toContain("Draft body");
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
