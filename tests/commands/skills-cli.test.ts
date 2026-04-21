/**
 * Tests for REQ-UTIL-7: voidrift skills CLI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skillsSource = readFileSync(join(__dirname, "../../src/commands/skills-cli.ts"), "utf-8");
const indexSource = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

// ---------------------------------------------------------------------------
// list: groups by layer, marks pending (AC3)
// ---------------------------------------------------------------------------

describe("skills list (REQ-UTIL-7 AC3)", () => {
  it("calls listSkills()", () => {
    expect(skillsSource).toContain("listSkills()");
  });

  it("groups output by layer", () => {
    expect(skillsSource).toContain("grouped[s.layer]");
  });

  it("marks pending skills", () => {
    expect(skillsSource).toContain("(pending)");
  });
});

// ---------------------------------------------------------------------------
// search: queries repos, shows source (AC1)
// ---------------------------------------------------------------------------

describe("skills search (REQ-UTIL-7 AC1)", () => {
  it("reads repos from config", () => {
    expect(skillsSource).toContain("loadConfig().skills?.repos");
  });

  it("fetches manifests via curl", () => {
    expect(skillsSource).toContain("curl -sf");
  });

  it("filters by query case-insensitively", () => {
    expect(skillsSource).toContain("query.toLowerCase()");
  });

  it("shows source URL attribution", () => {
    expect(skillsSource).toContain("console.log(`\\n  ${url}`)");
  });

  it("requires query argument", () => {
    expect(skillsSource).toContain("Usage: voidrift skills search <query>");
  });
});

// ---------------------------------------------------------------------------
// install: writes as pending (AC2)
// ---------------------------------------------------------------------------

describe("skills install (REQ-UTIL-7 AC2)", () => {
  it("writes to pending directory", () => {
    expect(skillsSource).toContain("pendingDir()");
    expect(skillsSource).toContain("writeFileSync(path,");
  });

  it("creates pending dir if needed", () => {
    expect(skillsSource).toContain("mkdirSync(pd, { recursive: true })");
  });

  it("does not auto-activate", () => {
    expect(skillsSource).toContain("installed as pending");
  });
});

// ---------------------------------------------------------------------------
// approve: promotes pending to active
// ---------------------------------------------------------------------------

describe("skills approve (REQ-UTIL-7)", () => {
  it("moves from pending to project skills dir", () => {
    expect(skillsSource).toContain("renameSync(src, join(dest,");
  });

  it("reports approval", () => {
    expect(skillsSource).toContain("approved and active");
  });
});

// ---------------------------------------------------------------------------
// remove: deletes domain skill
// ---------------------------------------------------------------------------

describe("skills remove (REQ-UTIL-7)", () => {
  it("checks project and domain directories", () => {
    expect(skillsSource).toContain("projectSkillsDir()");
    expect(skillsSource).toContain("domainSkillsDir()");
  });

  it("removes with unlinkSync", () => {
    expect(skillsSource).toContain("unlinkSync(path)");
  });
});

// ---------------------------------------------------------------------------
// review: shows pending
// ---------------------------------------------------------------------------

describe("skills review (REQ-UTIL-7)", () => {
  it("reads pending directory", () => {
    expect(skillsSource).toContain("pendingDir()");
  });

  it("shows pending skills with descriptions", () => {
    expect(skillsSource).toContain("Pending skills:");
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

describe("skills wired in index.ts (REQ-UTIL-7)", () => {
  it("handles skills command", () => {
    expect(indexSource).toContain('command === "skills"');
    expect(indexSource).toContain("./commands/skills-cli.js");
  });

  it("passes subcommand and arg", () => {
    expect(indexSource).toContain("runSkills(args[1], args[2])");
  });

  it("appears in help text", () => {
    expect(indexSource).toContain("skills [list|search|install|approve|remove|review]");
  });
});
