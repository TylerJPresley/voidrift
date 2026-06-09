import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, globFiles, writeFile, editFile, executeCommand } from "../../src/tools/executors.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-executors-test-" + Date.now());

beforeEach(() => {
  mkdirSync(join(TMP, "src"), { recursive: true });
  writeFileSync(join(TMP, "src", "main.ts"), "const x = 1;\nconst y = 2;\nexport { x, y };");
  writeFileSync(join(TMP, "readme.md"), "# Hello");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("readFile", () => {
  it("reads existing file", () => {
    const result = readFile(TMP, "src/main.ts");
    expect(result.success).toBe(true);
    expect(result.output).toContain("const x = 1");
  });

  it("returns error for missing file", () => {
    const result = readFile(TMP, "nonexistent.ts");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("strips ANSI codes from file content", () => {
    writeFileSync(join(TMP, "colored.txt"), "\x1B[31mred\x1B[0m text");
    const result = readFile(TMP, "colored.txt");
    expect(result.output).toContain("red text");
  });
});

describe("globFiles", () => {
  it("finds files matching pattern", () => {
    const result = globFiles(TMP, "src/*.ts");
    expect(result.success).toBe(true);
    expect(result.output).toContain("src/main.ts");
  });

  it("returns empty for no matches", () => {
    const result = globFiles(TMP, "*.xyz");
    expect(result.success).toBe(true);
    expect(result.output).toBe("");
  });
});

describe("writeFile", () => {
  it("creates a new file", () => {
    const result = writeFile(TMP, "new/file.ts", "export const z = 3;");
    expect(result.success).toBe(true);
    expect(existsSync(join(TMP, "new", "file.ts"))).toBe(true);
    expect(readFileSync(join(TMP, "new", "file.ts"), "utf-8")).toBe("export const z = 3;");
  });

  it("overwrites existing file", () => {
    const result = writeFile(TMP, "readme.md", "# Updated");
    expect(result.success).toBe(true);
    expect(readFileSync(join(TMP, "readme.md"), "utf-8")).toBe("# Updated");
  });
});

describe("editFile", () => {
  it("performs surgical block replacement", () => {
    const result = editFile(TMP, "src/main.ts", "const y = 2;", "const y = 42;");
    expect(result.success).toBe(true);
    const content = readFileSync(join(TMP, "src", "main.ts"), "utf-8");
    expect(content).toContain("const y = 42;");
    expect(content).toContain("const x = 1;"); // untouched
  });

  it("fails when search block not found", () => {
    const result = editFile(TMP, "src/main.ts", "nonexistent block", "replacement");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Search block not found");
  });

  it("fails for missing file", () => {
    const result = editFile(TMP, "missing.ts", "x", "y");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("executeCommand", () => {
  it("runs a command and returns output", () => {
    const result = executeCommand(TMP, "echo hello");
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("hello");
  });

  it("captures stderr on failure", () => {
    const result = executeCommand(TMP, "ls /nonexistent_path_xyz 2>&1 || true");
    expect(result.success).toBe(true);
  });

  it("returns error on non-zero exit", () => {
    const result = executeCommand(TMP, "exit 1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Exit code");
  });

  it("times out long-running commands", () => {
    const result = executeCommand(TMP, "sleep 10", 100);
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("strips ANSI from command output", () => {
    const result = executeCommand(TMP, "printf '\\033[31mred\\033[0m'");
    expect(result.output).not.toContain("\x1B");
  });
});
