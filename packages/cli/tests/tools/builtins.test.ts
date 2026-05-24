import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { bashTool, readTool, writeTool, editTool } from "../../src/tools/builtins.ts";

const tmpDir = join(import.meta.dirname, "__tmp_tools");

beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("bashTool", () => {
  it("executes a command and returns output", async () => {
    const result = await bashTool.execute({ command: "echo hello" });
    expect(result.trim()).toBe("hello");
  });

  it("returns error on failure", async () => {
    const result = await bashTool.execute({ command: "exit 1" });
    expect(result).toContain("Exit code 1");
  });
});

describe("readTool", () => {
  it("reads a file", async () => {
    const path = join(tmpDir, "test.txt");
    writeFileSync(path, "file content");
    const result = await readTool.execute({ path });
    expect(result).toBe("file content");
  });

  it("returns error for missing file", async () => {
    const result = await readTool.execute({ path: "/nonexistent/file.txt" });
    expect(result).toContain("not found");
  });
});

describe("writeTool", () => {
  it("writes a file and creates directories", async () => {
    const path = join(tmpDir, "sub", "dir", "out.txt");
    const result = await writeTool.execute({ path, content: "written" });
    expect(result).toContain("Wrote");
    expect(readFileSync(path, "utf-8")).toBe("written");
  });
});

describe("editTool", () => {
  it("replaces text in a file", async () => {
    const path = join(tmpDir, "edit.txt");
    writeFileSync(path, "hello world");
    const result = await editTool.execute({ path, old_text: "world", new_text: "voidrift" });
    expect(result).toContain("Edited");
    expect(readFileSync(path, "utf-8")).toBe("hello voidrift");
  });

  it("returns error when old_text not found", async () => {
    const path = join(tmpDir, "edit2.txt");
    writeFileSync(path, "hello");
    const result = await editTool.execute({ path, old_text: "missing", new_text: "x" });
    expect(result).toContain("not found");
  });
});
