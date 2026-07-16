/**
 * Coverage push — part 2.
 * Skills builtins, codemap extractors, config writer, security policy engine details.
 */
import { describe, it, expect, vi } from "vitest";

describe("skills/builtins", () => {
  it("registers all builtin skills", async () => {
    const { SkillManager } = await import("../src/skills/manager.js");
    const { registerBuiltinSkills } = await import("../src/skills/builtins.js");
    const mgr = new SkillManager();
    registerBuiltinSkills(mgr);
    mgr.index([]); // triggers builtins → indexed merge
    const indexed = mgr.indexedSkills;
    expect(indexed.length).toBeGreaterThanOrEqual(7);
    expect(indexed.some(s => s.name === "planning")).toBe(true);
    expect(indexed.some(s => s.name === "memory")).toBe(true);
    expect(indexed.some(s => s.name === "delegation")).toBe(true);
    expect(indexed.some(s => s.name === "workspace")).toBe(true);
    expect(indexed.some(s => s.name === "context-budget")).toBe(true);
    expect(indexed.some(s => s.name === "tasks")).toBe(true);
    expect(indexed.some(s => s.name === "model-escalation")).toBe(true);
  });

  it("builtin skills have keyword triggers", async () => {
    const { SkillManager } = await import("../src/skills/manager.js");
    const { registerBuiltinSkills } = await import("../src/skills/builtins.js");
    const mgr = new SkillManager();
    registerBuiltinSkills(mgr);
    mgr.index([]);
    const planning = mgr.indexedSkills.find(s => s.name === "planning")!;
    expect(planning.triggers.keywords).toContain("plan");
    const memory = mgr.indexedSkills.find(s => s.name === "memory")!;
    expect(memory.triggers.keywords).toContain("remember");
  });

  it("resolves planning skill on keyword match", async () => {
    const { SkillManager } = await import("../src/skills/manager.js");
    const { registerBuiltinSkills } = await import("../src/skills/builtins.js");
    const mgr = new SkillManager();
    registerBuiltinSkills(mgr);
    mgr.index([]);
    const resolved = mgr.resolveMatchingSkillContent({ focusedFiles: [], userInput: "let's plan the implementation", activePlan: null });
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0]).toContain("Planning");
  });
});

describe("codemap/extractors", () => {
  it("codeExtractor extracts TypeScript symbols", async () => {
    const { codeExtractor } = await import("../src/codemap/extractors.js");
    const content = `export function hello() {}\nexport class MyClass {}\nexport interface Config {}\nconst internal = 1;\nexport type Result = string;`;
    const result = codeExtractor.extract("test.ts", content);
    expect(result.symbols.map(s => s.name)).toContain("hello");
    expect(result.symbols.map(s => s.name)).toContain("MyClass");
    expect(result.symbols.map(s => s.name)).toContain("Config");
    expect(result.symbols.map(s => s.name)).toContain("Result");
    expect(result.lines).toBe(5);
  });

  it("markdownExtractor extracts headings", async () => {
    const { markdownExtractor } = await import("../src/codemap/extractors.js");
    const content = `# Title\n\nSome text.\n\n## Section A\n\n### Subsection\n\n## Section B`;
    const result = markdownExtractor.extract("test.md", content);
    expect(result.symbols.map(s => s.name)).toContain("Title");
    expect(result.symbols.map(s => s.name)).toContain("Section A");
    expect(result.symbols.map(s => s.name)).toContain("Subsection");
    expect(result.symbols.map(s => s.name)).toContain("Section B");
  });

  it("dataExtractor extracts JSON keys", async () => {
    const { dataExtractor } = await import("../src/codemap/extractors.js");
    const content = JSON.stringify({ name: "test", version: "1.0", scripts: {}, dependencies: {} });
    const result = dataExtractor.extract("package.json", content);
    expect(result.symbols.map(s => s.name)).toContain("name");
    expect(result.symbols.map(s => s.name)).toContain("version");
    expect(result.symbols.map(s => s.name)).toContain("scripts");
  });

  it("dataExtractor extracts YAML keys", async () => {
    const { dataExtractor } = await import("../src/codemap/extractors.js");
    const content = `name: test\nversion: 1.0\ndescription: A thing\nplugins:\n  - one`;
    const result = dataExtractor.extract("config.yaml", content);
    expect(result.symbols.map(s => s.name)).toContain("name");
    expect(result.symbols.map(s => s.name)).toContain("version");
    expect(result.symbols.map(s => s.name)).toContain("description");
  });
});

describe("config/writer — safeConfigWrite", () => {
  it("rejects mutation that breaks tier-model reference", async () => {
    const { safeConfigWrite } = await import("../src/config/writer.js");
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const dir = join(tmpdir(), `voidrift-writer-test-${Date.now()}`);
    (mkdirSync as any)(dir, { recursive: true });
    const path = join(dir, "config.json");
    const validConfig = { modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local", models: { local: { protocol: "openai", model: "test", baseUrl: "http://localhost", contextLimit: 32768 } } };
    (writeFileSync as any)(path, JSON.stringify(validConfig, null, 2));

    // Try to set a tier to a nonexistent model
    const result = safeConfigWrite(path, (cfg: any) => { cfg.modelTierFlash = "nonexistent"; });
    expect(result.success).toBe(false);
    expect(result.error).toContain("tier");

    // Config should be unchanged
    const content = JSON.parse((readFileSync as any)(path, "utf-8"));
    expect(content.modelTierFlash).toBe("local");

    // Cleanup
    const { rmSync } = await import("fs");
    (rmSync as any)(dir, { recursive: true, force: true });
  });
});

describe("security/policy-engine — shell classification", () => {
  it("classifies safe commands", async () => {
    const { classifyCommand } = await import("../src/security/policy-engine.js");
    expect(classifyCommand("git status")).toBe("safe");
    expect(classifyCommand("ls")).toBe("safe");
    expect(classifyCommand("pwd")).toBe("safe");
    expect(classifyCommand("node --version")).toBe("safe");
  });

  it("classifies dangerous commands", async () => {
    const { classifyCommand } = await import("../src/security/policy-engine.js");
    expect(classifyCommand("rm -rf /")).toBe("dangerous");
    expect(classifyCommand("sudo apt install")).toBe("dangerous");
    expect(classifyCommand("git push --force")).toBe("dangerous");
    expect(classifyCommand("git reset --hard")).toBe("dangerous");
  });

  it("classifies tool equivalents", async () => {
    const { classifyCommand } = await import("../src/security/policy-engine.js");
    expect(classifyCommand("cat file.txt")).toBe("has_equivalent");
    expect(classifyCommand("grep pattern file")).toBe("has_equivalent");
    expect(classifyCommand("find . -name '*.ts'")).toBe("has_equivalent");
    expect(classifyCommand("curl https://example.com")).toBe("has_equivalent");
  });

  it("classifies unknown commands", async () => {
    const { classifyCommand } = await import("../src/security/policy-engine.js");
    expect(classifyCommand("npm test")).toBe("unknown");
    expect(classifyCommand("bun run build")).toBe("unknown");
  });
});

describe("security/policy-engine — pattern matching", () => {
  it("matchGlob matches paths", async () => {
    const { matchGlob } = await import("../src/security/policy-engine.js");
    expect(matchGlob("src/utils/auth.ts", "src/**")).toBe(true);
    expect(matchGlob("src/utils/auth.ts", "src/utils/**")).toBe(true);
    expect(matchGlob("src/utils/auth.ts", "tests/**")).toBe(false);
    expect(matchGlob("package.json", "*.json")).toBe(true);
    expect(matchGlob("src/deep/file.ts", "src/**")).toBe(true);
  });

  it("inferPatterns generates correct patterns for file tools", async () => {
    const { inferPatterns } = await import("../src/security/policy-engine.js");
    const patterns = inferPatterns("write_file", { path: "src/utils/auth.ts" });
    expect(patterns).toContain("src/utils/auth.ts");
    expect(patterns).toContain("src/utils/**");
  });

  it("inferPatterns generates correct patterns for commands", async () => {
    const { inferPatterns } = await import("../src/security/policy-engine.js");
    const patterns = inferPatterns("execute_command", { command: "bun run test" });
    expect(patterns).toContain("bun run test");
    expect(patterns).toContain("bun *");
  });

  it("inferPatterns generates correct patterns for MCP", async () => {
    const { inferPatterns } = await import("../src/security/policy-engine.js");
    const patterns = inferPatterns("mcp_github_search", {});
    expect(patterns).toContain("mcp_github_search");
    expect(patterns).toContain("mcp_github_*");
  });
});
