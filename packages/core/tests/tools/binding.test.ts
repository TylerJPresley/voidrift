import { describe, it, expect } from "vitest";
import { bindTools } from "../../src/tools/binding.js";
import { TOOL_SCHEMAS } from "../../src/tools/definitions.js";

describe("Tool Binding (Progressive Disclosure)", () => {
  it("plan mode returns only read-only tools", () => {
    const tools = bindTools("engineer", "plan");
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("edit_file");
    expect(names).not.toContain("execute_command");
    expect(names).toContain("read_file");
    expect(names).toContain("glob_files");
    expect(names).toContain("web_search");
  });

  it("architect in chat mode gets read-only tools", () => {
    const tools = bindTools("architect", "chat");
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("lsp_definition");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("execute_command");
  });

  it("engineer in chat mode gets all tools", () => {
    const tools = bindTools("engineer", "chat");
    expect(tools.length).toBe(TOOL_SCHEMAS.length);
  });

  it("engineer in vibe mode gets all tools", () => {
    const tools = bindTools("engineer", "vibe");
    expect(tools.length).toBe(TOOL_SCHEMAS.length);
  });

  it("auditor gets read_file, execute_command, and lsp tools only", () => {
    const tools = bindTools("auditor", "chat");
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("execute_command");
    expect(names).toContain("lsp_hover");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("glob_files");
  });

  it("null node in chat mode gets read-only tools", () => {
    const tools = bindTools(null, "chat");
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("write_file");
  });
});
