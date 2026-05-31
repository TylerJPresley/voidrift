import { describe, it, expect } from "vitest";
import { CoreRegistry } from "../../src/registry/core.js";

describe("CoreRegistry", () => {
  it("registers and invokes capabilities", async () => {
    const reg = new CoreRegistry();
    reg.registerCapability({
      name: "test-cap",
      trigger: "manual",
      execute: async (args) => `result: ${args.x}`,
    });

    const result = await reg.invokeCapability("test-cap", { x: 42 });
    expect(result).toBe("result: 42");
  });

  it("throws on duplicate capability registration", () => {
    const reg = new CoreRegistry();
    const hook = { name: "dup", trigger: "x", execute: async () => {} };
    reg.registerCapability(hook);
    expect(() => reg.registerCapability(hook)).toThrow(/already registered/);
  });

  it("throws when invoking unregistered capability", async () => {
    const reg = new CoreRegistry();
    await expect(reg.invokeCapability("nope", {})).rejects.toThrow(/not registered/);
  });

  it("registers and retrieves slash commands", () => {
    const reg = new CoreRegistry();
    reg.registerSlashCommand({
      name: "stats",
      description: "Show session stats",
      execute: async () => {},
    });

    expect(reg.getSlashCommand("stats")).toBeDefined();
    expect(reg.getSlashCommand("nope")).toBeUndefined();
    expect(reg.listSlashCommands()).toEqual(["stats"]);
  });

  it("registers and retrieves modes", () => {
    const reg = new CoreRegistry();
    reg.registerMode({
      name: "plan",
      allowedTools: ["read_file", "glob_files"],
      permissionGate: false,
    });

    const mode = reg.getMode("plan");
    expect(mode?.allowedTools).toContain("read_file");
    expect(reg.listModes()).toEqual(["plan"]);
  });

  it("throws on duplicate slash command", () => {
    const reg = new CoreRegistry();
    const cmd = { name: "x", description: "", execute: async () => {} };
    reg.registerSlashCommand(cmd);
    expect(() => reg.registerSlashCommand(cmd)).toThrow();
  });
});
