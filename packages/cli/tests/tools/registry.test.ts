import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.ts";

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const reg = new ToolRegistry();
    reg.register({ name: "test", description: "A test tool", parameters: { x: { type: "string", description: "input" } }, confirmPolicy: "auto", execute: async () => "ok" });
    expect(reg.get("test")).toBeDefined();
    expect(reg.get("test")!.name).toBe("test");
  });

  it("executes a registered tool", async () => {
    const reg = new ToolRegistry();
    reg.register({ name: "echo", description: "Echo", parameters: { msg: { type: "string", description: "message" } }, confirmPolicy: "auto", execute: async (args) => `echo: ${args.msg}` });
    const result = await reg.execute("echo", { msg: "hello" });
    expect(result).toBe("echo: hello");
  });

  it("returns error for unknown tool", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("nope", {});
    expect(result).toContain("unknown tool");
  });

  it("catches tool execution errors", async () => {
    const reg = new ToolRegistry();
    reg.register({ name: "fail", description: "Fails", parameters: {}, confirmPolicy: "auto", execute: async () => { throw new Error("boom"); } });
    const result = await reg.execute("fail", {});
    expect(result).toContain("boom");
  });

  it("converts to OpenAI tool format", () => {
    const reg = new ToolRegistry();
    reg.register({ name: "read", description: "Read file", parameters: { path: { type: "string", description: "file path" } }, confirmPolicy: "auto", execute: async () => "" });
    const tools = reg.toOpenAITools();
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("read");
    expect(tools[0].function.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string", description: "file path" } },
      required: ["path"],
    });
  });

  it("needsConfirmation returns true for confirm policy", () => {
    const reg = new ToolRegistry();
    reg.register({ name: "bash", description: "", parameters: {}, confirmPolicy: "confirm", execute: async () => "" });
    reg.register({ name: "read", description: "", parameters: {}, confirmPolicy: "auto", execute: async () => "" });
    expect(reg.needsConfirmation("bash")).toBe(true);
    expect(reg.needsConfirmation("read")).toBe(false);
  });

  it("approveAlways skips future confirmations", () => {
    const reg = new ToolRegistry();
    reg.register({ name: "bash", description: "", parameters: {}, confirmPolicy: "confirm", execute: async () => "" });
    expect(reg.needsConfirmation("bash")).toBe(true);
    reg.approveAlways("bash");
    expect(reg.needsConfirmation("bash")).toBe(false);
  });
});
