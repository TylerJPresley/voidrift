import { describe, it, expect } from "vitest";
import { DOMAIN_TOOLS } from "../../src/tools/registry.js";

describe("DOMAIN_TOOLS", () => {
  it("contains exactly 10 tools", () => {
    expect(DOMAIN_TOOLS).toHaveLength(10);
  });

  it("has the correct tool names", () => {
    const names = new Set(DOMAIN_TOOLS.map(t => t.function.name));
    expect(names).toEqual(new Set(["file", "http", "shell", "browser", "process", "skill", "memory", "session", "analyze", "ask"]));
  });

  it("each schema has valid structure", () => {
    for (const tool of DOMAIN_TOOLS) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("concurrent_safe flags are correct", () => {
    const safe = DOMAIN_TOOLS.filter(t => t.concurrent_safe).map(t => t.function.name).sort();
    expect(safe).toEqual(["analyze", "memory", "session", "skill"]);
  });
});
