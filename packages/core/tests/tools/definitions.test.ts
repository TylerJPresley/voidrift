import { describe, it, expect } from "vitest";
import { TOOL_SCHEMAS, getToolSchema } from "../../src/tools/definitions.js";

describe("Tool Definitions", () => {
  it("has exactly 12 tools", () => {
    expect(TOOL_SCHEMAS.length).toBe(12);
  });

  it("all gated tools are mutations or executions", () => {
    const gated = TOOL_SCHEMAS.filter((t) => t.safetyProfile === "gated");
    const gatedNames = gated.map((t) => t.name);
    expect(gatedNames).toContain("write_file");
    expect(gatedNames).toContain("edit_file");
    expect(gatedNames).toContain("execute_command");
    expect(gatedNames).toContain("spawn_subagent");
    expect(gatedNames).toContain("connect_mcp_server");
  });

  it("getToolSchema returns correct tool", () => {
    const tool = getToolSchema("edit_file");
    expect(tool?.parameters).toHaveLength(3);
    expect(tool?.safetyProfile).toBe("gated");
  });

  it("getToolSchema returns undefined for unknown", () => {
    expect(getToolSchema("nonexistent")).toBeUndefined();
  });
});
