import { describe, it, expect } from "vitest";
import { PermissionGate } from "../../src/security/permission-gate.js";
import { EventBus } from "../../src/events/bus.js";

const chatAgent = { approvalMode: "prompt" as const, allowedTools: ["read_file", "glob_files"] };
const planAgent = { approvalMode: "deny" as const, allowedTools: ["read_file", "glob_files"] };
const vibeAgent = { approvalMode: "autonomous" as const, allowedTools: [] };

describe("PermissionGate", () => {
  it("auto-approves tools in allowedTools regardless of approvalMode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    expect((await gate.check("read_file", { path: "x.ts" }, chatAgent)).approved).toBe(true);
    expect((await gate.check("read_file", { path: "x.ts" }, planAgent)).approved).toBe(true);
  });

  it("auto-approves everything in autonomous mode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("write_file", { path: "x.ts", content: "" }, vibeAgent);
    expect(result.approved).toBe(true);
  });

  it("rejects tools not in allowedTools when approvalMode is deny", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("write_file", { path: "x.ts", content: "" }, planAgent);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("blocked");
  });

  it("publishes TOOL_CONFIRMATION_REQUEST when tool not in allowedTools (prompt mode)", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      expect(event.payload.tool).toBe("write_file");
      expect((event.payload as any).requestId).toBeDefined();
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true, requestId: (event.payload as any).requestId }), 5);
    });

    const result = await gate.check("write_file", { path: "x.ts", content: "hi" }, chatAgent);
    expect(result.approved).toBe(true);
  });

  it("returns rejection message when operator denies", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false, requestId: (event.payload as any).requestId }), 5);
    });

    const result = await gate.check("execute_command", { command: "rm -rf /" }, chatAgent);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("rejected by user permission gate");
  });

  it("supports legacy response without requestId (resolves oldest)", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", () => {
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true }), 5);
    });

    const result = await gate.check("edit_file", { path: "x", search: "a", replace: "b" }, chatAgent);
    expect(result.approved).toBe(true);
  });

  it("handles multiple concurrent pending requests", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const requestIds: string[] = [];

    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (event) => {
      requestIds.push((event.payload as any).requestId);
      if (requestIds.length === 2) {
        setTimeout(() => {
          bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true, requestId: requestIds[0] });
          bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: false, requestId: requestIds[1] });
        }, 5);
      }
    });

    const [r1, r2] = await Promise.all([
      gate.check("write_file", { path: "a.ts", content: "" }, chatAgent),
      gate.check("write_file", { path: "b.ts", content: "" }, chatAgent),
    ]);

    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(false);
  });
});
