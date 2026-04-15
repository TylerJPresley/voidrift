import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLocalTools, filterTools, narrowSchemaActions, buildToolGuidelines } from "../../src/tools/builder.js";
import { DOMAIN_TOOLS } from "../../src/tools/registry.js";
import { clearConfigCache } from "../../src/config.js";

describe("filterTools", () => {
  it("null returns all", () => {
    expect(filterTools(DOMAIN_TOOLS, null)).toHaveLength(10);
  });

  it("filters to allowed set", () => {
    const result = filterTools(DOMAIN_TOOLS, new Set(["file", "shell"]));
    const names = result.map(t => t.function.name);
    expect(names).toEqual(["file", "shell"]);
  });

  it("empty set returns empty", () => {
    expect(filterTools(DOMAIN_TOOLS, new Set())).toHaveLength(0);
  });
});

describe("narrowSchemaActions", () => {
  it("restricts action enum", () => {
    const file = DOMAIN_TOOLS.find(t => t.function.name === "file")!;
    const narrowed = narrowSchemaActions(file, ["read", "list"]);
    const actions = (narrowed.function.parameters.properties.action as Record<string, unknown>).enum as string[];
    expect(actions).toEqual(["read", "list"]);
  });

  it("does not mutate original", () => {
    const file = DOMAIN_TOOLS.find(t => t.function.name === "file")!;
    const originalActions = (file.function.parameters.properties.action as Record<string, unknown>).enum as string[];
    narrowSchemaActions(file, ["read"]);
    expect(originalActions).toHaveLength(5);
  });
});

describe("buildToolGuidelines", () => {
  it("assembles guidelines from tools", () => {
    const result = buildToolGuidelines(DOMAIN_TOOLS);
    expect(result).toContain("## Tool Guidelines");
    expect(result).toContain("file: Read files before writing");
  });

  it("returns empty for tools without guidelines", () => {
    const noGuidelines = [{ type: "function" as const, function: { name: "x", description: "", parameters: { type: "object" as const, properties: {} } } }];
    expect(buildToolGuidelines(noGuidelines)).toBe("");
  });
});

describe("buildLocalTools", () => {
  const tmp = join(tmpdir(), `voidrift-test-builder-${Date.now()}`);

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(tmp, { recursive: true });
    process.env.VOIDRIFT_HOME = join(tmp, "home");
    mkdirSync(join(tmp, "home"), { recursive: true });
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("gather returns file + analyze", () => {
    const [tools] = buildLocalTools("gather", tmp);
    const names = new Set(tools.map(t => t.function.name));
    expect(names).toEqual(new Set(["file", "analyze"]));
  });

  it("gather file has only read + list actions", () => {
    const [tools] = buildLocalTools("gather", tmp);
    const file = tools.find(t => t.function.name === "file")!;
    const actions = (file.function.parameters.properties.action as Record<string, unknown>).enum as string[];
    expect(actions).toEqual(["read", "list"]);
  });

  it("develop returns file + shell", () => {
    const [tools] = buildLocalTools("develop", tmp);
    const names = new Set(tools.map(t => t.function.name));
    expect(names).toEqual(new Set(["file", "shell"]));
  });

  it("chat returns all 8 chat tools", () => {
    const [tools] = buildLocalTools("chat", tmp);
    const names = new Set(tools.map(t => t.function.name));
    expect(names).toEqual(new Set(["file", "http", "shell", "skill", "memory", "session", "analyze", "ask"]));
  });

  it("verify-plan returns file only", () => {
    const [tools] = buildLocalTools("verify-plan", tmp);
    const names = new Set(tools.map(t => t.function.name));
    expect(names).toEqual(new Set(["file"]));
  });

  it("verify-execute returns 5 tools", () => {
    const [tools] = buildLocalTools("verify-execute", tmp);
    const names = new Set(tools.map(t => t.function.name));
    expect(names).toEqual(new Set(["file", "http", "shell", "browser", "process"]));
  });

  it("null cmd returns all 10 tools", () => {
    const [tools] = buildLocalTools(null, tmp);
    expect(tools).toHaveLength(10);
  });

  it("all tools have handlers", () => {
    const [tools, handlers] = buildLocalTools("chat", tmp);
    for (const t of tools) {
      expect(handlers[t.function.name]).toBeDefined();
      expect(typeof handlers[t.function.name]).toBe("function");
    }
  });
});
