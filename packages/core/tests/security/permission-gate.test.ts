import { describe, it, expect } from "vitest";
import { PermissionGate } from "../../src/security/permission-gate.js";
import { EventBus } from "../../src/events/bus.js";

describe("PermissionGate", () => {
  it("auto-approves read-only tools in any mode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    expect((await gate.check("read_file", { path: "x.ts" }, "chat")).approved).toBe(true);
    expect((await gate.check("read_file", { path: "x.ts" }, "plan")).approved).toBe(true);
    expect((await gate.check("read_file", { path: "x.ts" }, "vibe")).approved).toBe(true);
  });

  it("bypasses gate entirely in vibe mode for gated tools", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("write_file", { path: "x.ts", content: "" }, "vibe");
    expect(result.approved).toBe(true);
  });

  it("rejects gated tools outright in plan mode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("write_file", { path: "x.ts", content: "" }, "plan");
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("blocked in plan mode");
  });

  it("publishes TOOL_CONFIRMATION_REQUEST with requestId in chat mode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      expect(event.payload.tool).toBe("write_file");
      expect((event.payload as any).requestId).toBeDefined();
      // Respond with requestId
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true, requestId: (event.payload as any).requestId }), 5);
    });

    const result = await gate.check("write_file", { path: "x.ts", content: "hi" }, "chat");
    expect(result.approved).toBe(true);
  });

  it("returns rejection message when operator denies", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false, requestId: (event.payload as any).requestId }), 5);
    });

    const result = await gate.check("execute_command", { command: "rm -rf /" }, "chat");
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("rejected by user permission gate");
  });

  it("auto-approves unknown tools (not in schema)", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("unknown_tool", {}, "chat");
    expect(result.approved).toBe(true);
  });

  it("supports legacy response without requestId (resolves oldest)", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", () => {
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true }), 5);
    });

    const result = await gate.check("edit_file", { path: "x", search: "a", replace: "b" }, "chat");
    expect(result.approved).toBe(true);
  });

  it("handles multiple concurrent pending requests", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const requestIds: string[] = [];

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      requestIds.push((event.payload as any).requestId);
      // Approve after collecting both
      if (requestIds.length === 2) {
        setTimeout(() => {
          bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true, requestId: requestIds[0] });
          bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false, requestId: requestIds[1] });
        }, 5);
      }
    });

    const [r1, r2] = await Promise.all([
      gate.check("write_file", { path: "a.ts", content: "" }, "chat"),
      gate.check("write_file", { path: "b.ts", content: "" }, "chat"),
    ]);

    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(false);
  });
});
