import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSkillTemplates, findRelevantTemplates } from "../../src/skills/templates.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-templates-test-" + Date.now());

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("getSkillTemplates", () => {
  it("returns empty array when skill directory has no templates", () => {
    mkdirSync(TMP, { recursive: true });
    const skillPath = join(TMP, "no-templates.md");
    writeFileSync(skillPath, "---\nname: test\n---\ncontent");
    const templates = getSkillTemplates(skillPath);
    expect(templates).toEqual([]);
  });

  it("returns templates from skill directory", () => {
    const skillDir = join(TMP, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "skill.md");
    writeFileSync(skillPath, "---\nname: my-skill\n---\ncontent");

    const templatesDir = join(skillDir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(join(templatesDir, "component.tsx"), "export default function Component() {}");
    writeFileSync(join(templatesDir, "hook.ts"), "export function useHook() {}");

    const templates = getSkillTemplates(skillPath);
    expect(templates).toHaveLength(2);
    expect(templates[0].name).toBe("component.tsx");
    expect(templates[0].content).toBe("export default function Component() {}");
    expect(templates[1].name).toBe("hook.ts");
    expect(templates[1].content).toBe("export function useHook() {}");
  });

  it("filters dotfiles from templates", () => {
    const skillDir = join(TMP, "dotfile-skill");
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "skill.md");
    writeFileSync(skillPath, "---\nname: dotfile\n---\ncontent");

    const templatesDir = join(skillDir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(join(templatesDir, "normal.ts"), "normal");
    writeFileSync(join(templatesDir, ".hidden"), "hidden");

    const templates = getSkillTemplates(skillPath);
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("normal.ts");
  });

  it("returns empty when skill file is in non-existent directory", () => {
    const templates = getSkillTemplates("/nonexistent/path/skill.md");
    expect(templates).toEqual([]);
  });
});

describe("findRelevantTemplates", () => {
  it("returns empty when no skill dirs exist", () => {
    const templates = findRelevantTemplates(["/nonexistent/path"], ".ts");
    expect(templates).toEqual([]);
  });

  it("finds templates matching file extension", () => {
    const skillDir = join(TMP, "skill-dir");
    mkdirSync(skillDir, { recursive: true });

    const skill1Dir = join(skillDir, "react-skill");
    mkdirSync(skill1Dir, { recursive: true });
    const templatesDir1 = join(skill1Dir, "templates");
    mkdirSync(templatesDir1, { recursive: true });
    writeFileSync(join(templatesDir1, "button.tsx"), "export function Button() {}");
    writeFileSync(join(templatesDir1, "page.tsx"), "export default function Page() {}");
    writeFileSync(join(templatesDir1, "utils.ts"), "export const util = 1;");

    const skill2Dir = join(skillDir, "python-skill");
    mkdirSync(skill2Dir, { recursive: true });
    const templatesDir2 = join(skill2Dir, "templates");
    mkdirSync(templatesDir2, { recursive: true });
    writeFileSync(join(templatesDir2, "model.py"), "class Model: pass");

    const templates = findRelevantTemplates([skillDir], ".tsx");
    expect(templates).toHaveLength(2);
    expect(templates[0].skillName).toBe("react-skill");
    expect(templates[0].templateName).toBe("button.tsx");
    expect(templates[1].templateName).toBe("page.tsx");
  });

  it("finds templates matching extension substring", () => {
    const skillDir = join(TMP, "substring-skill");
    mkdirSync(skillDir, { recursive: true });

    const skillSubDir = join(skillDir, "ts-skill");
    mkdirSync(skillSubDir, { recursive: true });
    const templatesDir = join(skillSubDir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(join(templatesDir, "component.tsx"), "tsx content");
    writeFileSync(join(templatesDir, "module.ts"), "ts content");

    // Matching ".ts" should find both .ts and .tsx (since .tsx contains "ts")
    const templates = findRelevantTemplates([skillDir], ".ts");
    expect(templates).toHaveLength(2);
    expect(templates.map(t => t.templateName)).toContain("component.tsx");
    expect(templates.map(t => t.templateName)).toContain("module.ts");
  });

  it("returns templates matching filename", () => {
    const skillDir = join(TMP, "filename-skill");
    mkdirSync(skillDir, { recursive: true });

    const skillSubDir = join(skillDir, "config-skill");
    mkdirSync(skillSubDir, { recursive: true });
    const templatesDir = join(skillSubDir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(join(templatesDir, "tsconfig.json"), '{"compilerOptions": {}}');
    writeFileSync(join(templatesDir, "package.json"), '{"name": "test"}');

    const templates = findRelevantTemplates([skillDir], "tsconfig");
    expect(templates).toHaveLength(1);
    expect(templates[0].templateName).toBe("tsconfig.json");
  });

  it("skips skills without templates directory", () => {
    const skillDir = join(TMP, "no-templates-dir");
    mkdirSync(skillDir, { recursive: true });

    const skillSubDir = join(skillDir, "empty-skill");
    mkdirSync(skillSubDir, { recursive: true });
    // No templates/ directory

    const templates = findRelevantTemplates([skillDir], ".ts");
    expect(templates).toEqual([]);
  });

  it("returns content from matching templates", () => {
    const skillDir = join(TMP, "content-skill");
    mkdirSync(skillDir, { recursive: true });

    const skillSubDir = join(skillDir, "content-skill");
    mkdirSync(skillSubDir, { recursive: true });
    const templatesDir = join(skillSubDir, "templates");
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(join(templatesDir, "test.ts"), "export const TEST = 'value';");

    const templates = findRelevantTemplates([skillDir], ".ts");
    expect(templates[0].content).toBe("export const TEST = 'value';");
  });

  it("searches multiple skill directories", () => {
    const dir1 = join(TMP, "dir1");
    const dir2 = join(TMP, "dir2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    // Skill in dir1
    const skill1Dir = join(dir1, "skill-a");
    mkdirSync(skill1Dir, { recursive: true });
    const templatesDir1 = join(skill1Dir, "templates");
    mkdirSync(templatesDir1, { recursive: true });
    writeFileSync(join(templatesDir1, "a.ts"), "from skill-a");

    // Skill in dir2
    const skill2Dir = join(dir2, "skill-b");
    mkdirSync(skill2Dir, { recursive: true });
    const templatesDir2 = join(skill2Dir, "templates");
    mkdirSync(templatesDir2, { recursive: true });
    writeFileSync(join(templatesDir2, "b.ts"), "from skill-b");

    const templates = findRelevantTemplates([dir1, dir2], ".ts");
    expect(templates).toHaveLength(2);
    expect(templates.map(t => t.skillName)).toContain("skill-a");
    expect(templates.map(t => t.skillName)).toContain("skill-b");
  });
});