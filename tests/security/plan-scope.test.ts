import { describe, it, expect } from "vitest";
import { PermissionGate } from "../../src/security/permission-gate.js";
import { EventBus } from "../../src/events/bus.js";

describe("PermissionGate plan scope", () => {
  function createGate() {
    const bus = new EventBus();
    const gate = new PermissionGate(bus, "/fake/workspace");
    return { gate, bus };
  }

  const chatAgent = { approvalMode: "prompt" as const, allowedTools: ["read_file", "glob_files"] };

  it("auto-approves write_file within plan scope", async () => {
    const { gate } = createGate();
    const scope = { write: ["src/auth/**"], execute: ["bun run test"] };
    const result = await gate.check("write_file", { path: "src/auth/token.ts" }, chatAgent, scope);
    expect(result.approved).toBe(true);
  });

  it("auto-approves edit_file within plan scope", async () => {
    const { gate } = createGate();
    const scope = { write: ["src/auth/**"] };
    const result = await gate.check("edit_file", { path: "src/auth/session.ts", search: "old", replace: "new" }, chatAgent, scope);
    expect(result.approved).toBe(true);
  });

  it("auto-approves execute_command within plan scope", async () => {
    const { gate } = createGate();
    const scope = { execute: ["bun run test"] };
    const result = await gate.check("execute_command", { command: "bun run test" }, chatAgent, scope);
    expect(result.approved).toBe(true);
  });

  it("auto-approves execute_command matching glob pattern", async () => {
    const { gate } = createGate();
    const scope = { execute: ["bun run *"] };
    const result = await gate.check("execute_command", { command: "bun run lint" }, chatAgent, scope);
    expect(result.approved).toBe(true);
  });

  it("does NOT auto-approve write_file outside plan scope", async () => {
    const { gate, bus } = createGate();
    const scope = { write: ["src/auth/**"] };
    // This will trigger a confirmation request — respond immediately
    setTimeout(() => {
      bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false, requestId: undefined } as any);
    }, 10);
    const result = await gate.check("write_file", { path: "src/main.ts" }, chatAgent, scope);
    expect(result.approved).toBe(false);
  });

  it("does NOT auto-approve execute_command outside plan scope", async () => {
    const { gate, bus } = createGate();
    const scope = { execute: ["bun run test"] };
    setTimeout(() => {
      bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false } as any);
    }, 10);
    const result = await gate.check("execute_command", { command: "rm -rf /" }, chatAgent, scope);
    expect(result.approved).toBe(false);
  });

  it("falls back to normal behavior when no scope provided", async () => {
    const { gate, bus } = createGate();
    // No scope — write_file in chat mode should trigger prompt
    setTimeout(() => {
      bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true } as any);
    }, 10);
    const result = await gate.check("write_file", { path: "src/auth/token.ts" }, chatAgent);
    expect(result.approved).toBe(true); // approved via response
  });

  it("still auto-approves allowedTools regardless of scope", async () => {
    const { gate } = createGate();
    const result = await gate.check("read_file", { path: "anything.ts" }, chatAgent);
    expect(result.approved).toBe(true);
  });

  it("handles nested glob patterns", async () => {
    const { gate } = createGate();
    const scope = { write: ["src/**/*.ts"] };
    const result = await gate.check("write_file", { path: "src/deep/nested/file.ts" }, chatAgent, scope);
    expect(result.approved).toBe(true);
  });

  it("rejects when path doesn't match glob", async () => {
    const { gate, bus } = createGate();
    const scope = { write: ["src/**/*.ts"] };
    setTimeout(() => {
      bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false } as any);
    }, 10);
    const result = await gate.check("write_file", { path: "src/file.js" }, chatAgent, scope);
    expect(result.approved).toBe(false);
  });
});
