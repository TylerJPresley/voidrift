import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillManager } from "../../src/skills/manager.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-skills-test-" + Date.now());
const SKILLS_DIR = join(TMP, "skills");

const NEXTJS_SKILL = `---
name: NextJS App Router Guidelines
description: RSC and App Routing standards
triggers:
  extensions: [".tsx", ".jsx"]
  files: ["next.config.js"]
  keywords: ["nextjs", "server component", "layout"]
---
Use Server Components by default. Only add "use client" when needed.
Always use the App Router pattern.`;

const PRISMA_SKILL = `---
name: Prisma Best Practices
description: Database schema guidelines
triggers:
  extensions: [".prisma"]
  files: ["schema.prisma"]
  keywords: ["prisma", "database", "migration"]
---
Always use explicit relations. Index foreign keys.`;

beforeEach(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });
  writeFileSync(join(SKILLS_DIR, "nextjs.md"), NEXTJS_SKILL);
  writeFileSync(join(SKILLS_DIR, "prisma.md"), PRISMA_SKILL);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("SkillManager", () => {
  it("indexes skill files from directory", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    expect(mgr.indexed).toHaveLength(2);
    expect(mgr.indexed[0].name).toBe("NextJS App Router Guidelines");
  });

  it("ignores non-existent directories", () => {
    const mgr = new SkillManager();
    mgr.index(["/nonexistent/path"]);
    expect(mgr.indexed).toHaveLength(0);
  });

  it("resolves skills by file extension anchor", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: ["src/page.tsx"], userInput: "fix the layout", activePlan: null });
    expect(matched).toHaveLength(1);
    expect(matched[0]).toContain("Server Components");
  });

  it("resolves skills by filename anchor", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: ["schema.prisma"], userInput: "add a field", activePlan: null });
    expect(matched).toHaveLength(1);
    expect(matched[0]).toContain("explicit relations");
  });

  it("resolves skills by keyword in user input", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: ["src/utils.ts"], userInput: "help with prisma migration", activePlan: null });
    expect(matched).toHaveLength(1);
    expect(matched[0]).toContain("Index foreign keys");
  });

  it("resolves skills by keyword in active plan", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: [], userInput: "", activePlan: "Step 1: set up nextjs app router" });
    expect(matched).toHaveLength(1);
    expect(matched[0]).toContain("App Router");
  });

  it("returns multiple skills when multiple match", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: ["page.tsx", "schema.prisma"], userInput: "", activePlan: null });
    expect(matched).toHaveLength(2);
  });

  it("returns empty when nothing matches", () => {
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    const matched = mgr.resolve({ focusedFiles: ["main.go"], userInput: "write a go server", activePlan: null });
    expect(matched).toHaveLength(0);
  });

  it("handles malformed skill files gracefully", () => {
    writeFileSync(join(SKILLS_DIR, "bad.md"), "no frontmatter here");
    const mgr = new SkillManager();
    mgr.index([SKILLS_DIR]);
    expect(mgr.indexed).toHaveLength(2); // only the valid ones
  });
});
