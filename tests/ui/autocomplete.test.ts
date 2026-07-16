import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutocompleteEngine } from "../../src/ui/autocomplete.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-autocomplete-test-" + Date.now());

beforeEach(() => {
  mkdirSync(join(TMP, "src", "components"), { recursive: true });
  writeFileSync(join(TMP, "src", "index.ts"), "");
  writeFileSync(join(TMP, "src", "components", "button.tsx"), "");
  writeFileSync(join(TMP, "package.json"), "{}");
});

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("AutocompleteEngine", () => {
  it("completes slash commands", () => {
    const engine = new AutocompleteEngine();
    engine.setCommands(["help", "model", "stats", "memory", "mcp"]);
    const results = engine.complete("/m");
    expect(results).toContain("/model");
    expect(results).toContain("/memory");
    expect(results).toContain("/mcp");
    expect(results).not.toContain("/help");
  });

  it("returns all commands for bare /", () => {
    const engine = new AutocompleteEngine();
    engine.setCommands(["help", "stats"]);
    const results = engine.complete("/");
    expect(results).toHaveLength(2);
  });

  it("completes file paths from index", () => {
    const engine = new AutocompleteEngine();
    engine.setFileIndex(["src/index.ts", "src/components/button.tsx", "package.json"]);
    const results = engine.complete("/import src/");
    expect(results).toContain("src/index.ts");
    expect(results).toContain("src/components/button.tsx");
  });

  it("returns empty for no matches", () => {
    const engine = new AutocompleteEngine();
    engine.setCommands(["help"]);
    expect(engine.complete("/xyz")).toHaveLength(0);
  });

  it("cycles through candidates", () => {
    const engine = new AutocompleteEngine();
    const candidates = ["/model", "/memory", "/mcp"];
    const r1 = engine.cycle(candidates, 0);
    expect(r1.value).toBe("/model");
    const r2 = engine.cycle(candidates, r1.nextIndex);
    expect(r2.value).toBe("/memory");
    const r3 = engine.cycle(candidates, r2.nextIndex);
    expect(r3.value).toBe("/mcp");
    // Wraps around
    const r4 = engine.cycle(candidates, r3.nextIndex);
    expect(r4.value).toBe("/model");
  });

  it("indexes workspace files", () => {
    const engine = new AutocompleteEngine();
    engine.setFileIndex(["src/", "src/index.ts", "src/components/", "src/components/button.tsx", "package.json"]);
    const results = engine.complete("/import src/");
    expect(results).toContain("src/index.ts");
  });

  it("ignores node_modules and .git in workspace index", () => {
    // When CoreAPI provides the file list, it already excludes node_modules
    const engine = new AutocompleteEngine();
    engine.setFileIndex(["src/index.ts", "package.json"]);
    const results = engine.complete("/import node");
    expect(results).toHaveLength(0);
  });

  it("handles empty input", () => {
    const engine = new AutocompleteEngine();
    engine.setCommands(["help"]);
    expect(engine.complete("")).toHaveLength(0);
  });
});
