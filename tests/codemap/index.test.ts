import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateCodeMap, getCodeMapEntries } from "../../src/codemap/index.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-codemap-test-" + Date.now());

beforeEach(() => {
  mkdirSync(join(TMP, "src", "utils"), { recursive: true });
  mkdirSync(join(TMP, "docs"), { recursive: true });
  mkdirSync(join(TMP, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(TMP, ".git"), { recursive: true });
  writeFileSync(join(TMP, "src", "index.ts"), `
export class AppContainer {
  constructor() {}
}

export function bootstrap(): void {
  // body
}

export const VERSION = "1.0";
`);
  writeFileSync(join(TMP, "src", "utils", "helpers.ts"), `
export function formatDate(d: Date): string {
  return d.toISOString();
}

export interface Config {
  name: string;
}

type Internal = string;
`);
  writeFileSync(join(TMP, "package.json"), JSON.stringify({ name: "test", version: "1.0", scripts: { build: "tsc" } }));
  writeFileSync(join(TMP, "docs", "architecture.md"), `# Architecture\n\n## Subsystem 1\n\nContent here.\n\n## Subsystem 2\n\n### Nested Section\n\nMore content.\n`);
  writeFileSync(join(TMP, "config.yaml"), `database:\n  host: localhost\nserver:\n  port: 3000\nlogging:\n  level: info\n`);
  writeFileSync(join(TMP, "node_modules", "pkg", "index.js"), "module.exports = {}");
  writeFileSync(join(TMP, ".git", "config"), "");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Code-Map Generator", () => {
  it("generates a tree string with directory structure", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("📁 src/");
    expect(map).toContain("src/index.ts");
    expect(map).toContain("package.json");
  });

  it("excludes node_modules and .git", () => {
    const map = generateCodeMap(TMP);
    expect(map).not.toContain("node_modules");
    expect(map).not.toContain(".git");
  });

  it("extracts exported class symbols", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("class AppContainer");
  });

  it("extracts exported function symbols", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("function bootstrap");
    expect(map).toContain("function formatDate");
  });

  it("extracts exported const symbols", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("const VERSION");
  });

  it("extracts interface symbols", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("interface Config");
  });

  it("does not extract non-exported indented symbols", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("type Internal");
  });

  it("getCodeMapEntries returns structured entries with symbols", () => {
    const entries = getCodeMapEntries(TMP);
    const indexEntry = entries.find((e) => e.path === "src/index.ts");
    expect(indexEntry).toBeDefined();
    expect(indexEntry!.symbols).toContain("class AppContainer");
    expect(indexEntry!.symbols).toContain("function bootstrap");
  });

  it("extracts markdown headings", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("📝");
    expect(map).toContain("# Architecture");
    expect(map).toContain("## Subsystem 1");
    expect(map).toContain("## Subsystem 2");
    expect(map).toContain("### Nested Section");
  });

  it("extracts markdown line count", () => {
    const entries = getCodeMapEntries(TMP);
    const doc = entries.find((e) => e.path === "docs/architecture.md");
    expect(doc).toBeDefined();
    expect(doc!.lines).toBeGreaterThan(0);
    expect(doc!.symbols).toContain("# Architecture");
  });

  it("extracts JSON top-level keys", () => {
    const entries = getCodeMapEntries(TMP);
    const pkg = entries.find((e) => e.path === "package.json");
    expect(pkg).toBeDefined();
    expect(pkg!.symbols).toContain("name");
    expect(pkg!.symbols).toContain("version");
    expect(pkg!.symbols).toContain("scripts");
  });

  it("extracts YAML top-level keys", () => {
    const entries = getCodeMapEntries(TMP);
    const cfg = entries.find((e) => e.path === "config.yaml");
    expect(cfg).toBeDefined();
    expect(cfg!.symbols).toContain("database");
    expect(cfg!.symbols).toContain("server");
    expect(cfg!.symbols).toContain("logging");
  });

  it("shows data file icon for config files", () => {
    const map = generateCodeMap(TMP);
    expect(map).toContain("⚙️");
  });

  it("handles empty directories", () => {
    const empty = join(tmpdir(), "voidrift-codemap-empty-" + Date.now());
    mkdirSync(empty, { recursive: true });
    const map = generateCodeMap(empty);
    expect(map).toBe("");
    rmSync(empty, { recursive: true, force: true });
  });
});
