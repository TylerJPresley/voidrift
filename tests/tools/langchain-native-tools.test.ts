/**
 * Anthropic Native Tools Tests.
 *
 * Tests the getAnthropicNativeTools function which replaces generic
 * tools (edit_file, write_file, read_file, execute_command) with
 * Anthropic's purpose-built textEditor and bash tools.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAnthropicNativeTools } from "../../src/tools/langchain-tools.js";
import * as executors from "../../src/tools/executors.js";

// Mock executors
vi.mock("../../src/tools/executors.js", () => ({
  readFile: vi.fn(),
  editFile: vi.fn(),
  writeFile: vi.fn(),
  executeCommand: vi.fn(),
}));

// Mock fs and path
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("path", () => ({
  join: vi.fn((...args: string[]) => args.join("/")),
}));

// The real LangChain Anthropic tools are called like:
//   tools.textEditor_20250728({ execute: async (args) => { ... } })
// They return an object with a .call(input) method that invokes the execute function.
vi.mock("@langchain/anthropic", () => ({
  tools: {
    textEditor_20250728: (config: any) => ({
      name: "textEditor_20250728",
      call: async (input: any) => {
        return config.execute(input.args);
      },
    }),
    bash_20250124: (config: any) => ({
      name: "bash_20250124",
      call: async (input: any) => {
        return config.execute(input.args);
      },
    }),
  },
}));

describe("getAnthropicNativeTools", () => {
  const workspaceRoot = "/test/workspace";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("textEditor replacement", () => {
    it("returns textEditor when edit_file is requested", async () => {
      const tools = await getAnthropicNativeTools(["edit_file"], workspaceRoot);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("textEditor_20250728");
    });

    it("returns textEditor when write_file is requested", async () => {
      const tools = await getAnthropicNativeTools(["write_file"], workspaceRoot);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("textEditor_20250728");
    });

    it("returns textEditor when read_file is requested", async () => {
      const tools = await getAnthropicNativeTools(["read_file"], workspaceRoot);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("textEditor_20250728");
    });

    it("returns textEditor when all file tools are requested", async () => {
      const tools = await getAnthropicNativeTools(
        ["edit_file", "write_file", "read_file"],
        workspaceRoot
      );
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("textEditor_20250728");
    });

    it("textEditor execute calls readFile for view command", async () => {
      const { readFile } = await import("../../src/tools/executors.js");
      (readFile as any).mockReturnValue({ success: true, output: "line1\nline2" });

      const tools = await getAnthropicNativeTools(["read_file"], workspaceRoot);
      const textEditor = tools[0];
      const result = await textEditor.call({ args: { path: "test.ts", command: "view", view_range: [0, 1000] } });

      expect(readFile).toHaveBeenCalledWith(workspaceRoot, "test.ts", 0, 1000);
      expect(result).toBe("line1\nline2");
    });

    it("textEditor execute calls editFile for str_replace command", async () => {
      const { editFile } = await import("../../src/tools/executors.js");
      (editFile as any).mockReturnValue({ success: true, output: "updated" });

      const tools = await getAnthropicNativeTools(["edit_file"], workspaceRoot);
      const textEditor = tools[0];
      const result = await textEditor.call({ args: { path: "test.ts", command: "str_replace", old_str: "old", new_str: "new" } });

      expect(editFile).toHaveBeenCalledWith(workspaceRoot, "test.ts", "old", "new");
      expect(result).toBe("updated");
    });

    it("textEditor execute calls writeFile for create command", async () => {
      const { writeFile } = await import("../../src/tools/executors.js");
      (writeFile as any).mockReturnValue({ success: true, output: "created" });

      const tools = await getAnthropicNativeTools(["write_file"], workspaceRoot);
      const textEditor = tools[0];
      const result = await textEditor.call({ args: { path: "new.ts", command: "create", file_text: "content" } });

      expect(writeFile).toHaveBeenCalledWith(workspaceRoot, "new.ts", "content");
      expect(result).toBe("created");
    });

    it("textEditor execute calls insert with splice for insert command", async () => {
      // readFileSync is imported from 'fs' inside langchain-tools.ts
      const { readFileSync } = await import("fs");
      (readFileSync as any).mockReturnValue("line1\nline2\nline3");
      const { writeFile } = await import("../../src/tools/executors.js");
      (writeFile as any).mockReturnValue({ success: true, output: "inserted" });

      const tools = await getAnthropicNativeTools(["edit_file"], workspaceRoot);
      const textEditor = tools[0];
      const result = await textEditor.call({ args: { path: "test.ts", command: "insert", insert_line: 1, new_str: "new line" } });

      expect(writeFile).toHaveBeenCalledWith(workspaceRoot, "test.ts", expect.any(String));
      expect(result).toBe("inserted");
    });

    it("textEditor execute returns error for unknown command", async () => {
      const tools = await getAnthropicNativeTools(["edit_file"], workspaceRoot);
      const textEditor = tools[0];
      const result = await textEditor.call({ args: { path: "test.ts", command: "unknown" } });

      expect(result).toBe("Unknown command: unknown");
    });
  });

  describe("bash replacement", () => {
    it("returns bash when execute_command is requested", async () => {
      const tools = await getAnthropicNativeTools(["execute_command"], workspaceRoot);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("bash_20250124");
    });

    it("bash execute returns restart message", async () => {
      const tools = await getAnthropicNativeTools(["execute_command"], workspaceRoot);
      const bash = tools[0];
      const result = await bash.call({ args: { restart: true } });

      expect(result).toBe("Bash session restarted.");
    });

    it("bash execute calls executeCommand for normal commands", async () => {
      const { executeCommand } = await import("../../src/tools/executors.js");
      (executeCommand as any).mockReturnValue({ success: true, output: "hello" });

      const tools = await getAnthropicNativeTools(["execute_command"], workspaceRoot);
      const bash = tools[0];
      const result = await bash.call({ args: { command: "echo hello" } });

      expect(executeCommand).toHaveBeenCalledWith(workspaceRoot, "echo hello", 30000);
      expect(result).toBe("hello");
    });
  });

  describe("mixed tools", () => {
    it("returns native tools plus remaining generic tools", async () => {
      const tools = await getAnthropicNativeTools(
        ["edit_file", "execute_command", "glob_files"],
        workspaceRoot
      );

      // textEditor + bash + glob_files (generic, not replaced)
      expect(tools.length).toBe(3);
      expect(tools[0].name).toBe("textEditor_20250728");
      expect(tools[1].name).toBe("bash_20250124");
      expect(tools[2].name).toBe("glob_files");
    });

    it("returns only generic tools when no native tools requested", async () => {
      const tools = await getAnthropicNativeTools(
        ["glob_files", "write_file"],
        workspaceRoot
      );

      // write_file triggers textEditor, so: textEditor + glob_files
      expect(tools.length).toBe(2);
      expect(tools[0].name).toBe("textEditor_20250728");
      expect(tools[1].name).toBe("glob_files");
    });

    it("returns empty array when no tools requested", async () => {
      const tools = await getAnthropicNativeTools([], workspaceRoot);
      expect(tools.length).toBe(0);
    });
  });

  describe("getLangchainTools", () => {
    it("filters tools by name", async () => {
      const { getLangchainTools } = await import("../../src/tools/langchain-tools.js");
      const tools = getLangchainTools(["read_file", "write_file"]);
      expect(tools.length).toBe(2);
      expect(tools[0].name).toBe("read_file");
      expect(tools[1].name).toBe("write_file");
    });

    it("returns empty when no tools match", async () => {
      const { getLangchainTools } = await import("../../src/tools/langchain-tools.js");
      const tools = getLangchainTools(["nonexistent"]);
      expect(tools.length).toBe(0);
    });
  });
});