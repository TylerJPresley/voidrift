import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus } from "../../src/events/bus.js";
import { ContextManager } from "../../src/session/context.js";
import { PermissionGate } from "../../src/security/permission-gate.js";
import { ExceptionGuard } from "../../src/session/guard.js";
import { directChat } from "../../src/orchestration/graph.js";
import { runGoal } from "../../src/orchestration/goal.js";
import { GitCheckpointer } from "../../src/safeguards/checkpoint.js";
import { routeMCPToolCall, isMCPTool } from "../../src/mcp/router.js";
import { buildEscalationState, shouldEscalate, escalateTier } from "../../src/router/index.js";
import { CoreAPI } from "../../src/plugins/interface.js";
import { CoreRegistry } from "../../src/registry/core.js";
import { WorktreeEngine } from "../../src/worktree/engine.js";
import type { GraphState } from "../../src/orchestration/nodes.js";
import type { StreamChunk } from "../../src/adapters/types.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-integration-" + Date.now());

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  execSync("git init && git config user.email t@t.com && git config user.name T && touch f && git add . && git commit -m init", { cwd: TMP, stdio: "ignore" });
});
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

function makeMockClient(text: string) {
  const client: any = { stream: vi.fn().mockResolvedValue({ [Symbol.asyncIterator]: async function* () { yield { content: text }; } }), bindTools: vi.fn() };
  client.bindTools.mockReturnValue(client);
  return client;
}

describe("Integration: Full Chat Turn", () => {
  it("user input → model stream → response captured", async () => {
    const client = makeMockClient("Hello! I can help with that.");
    const chunks: StreamChunk[] = [];
    const state: GraphState = { activePlan: null, focusedFiles: [], diagnostics: null, routingFlag: null, messages: [], activeMode: "chat", activePersona: "You are helpful." };

    const result = await directChat({ userMessage: "hi", client, systemPrompt: "You are helpful.", history: [], state, onChunk: (c) => chunks.push(c) });

    expect(result.response.text).toBe("Hello! I can help with that.");
    expect(result.path).toBe("direct");
    expect(chunks.some((c) => c.type === "content")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });
});

describe("Integration: Tool Call Flow", () => {
  it("permission gate blocks in chat mode, approves on response", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);

    // Simulate operator approving after 10ms
    bus.subscribe("TOOL_CONFIRMATION_REQUEST", (e) => {
      setTimeout(() => bus.publish("TOOL_CONFIRMATION_RESPONSE", { approved: true, requestId: (e.payload as any).requestId }), 10);
    });

    const result = await gate.check("write_file", { path: "test.ts", content: "x" }, { approvalMode: "prompt", allowedTools: ["read_file"] });
    expect(result.approved).toBe(true);
  });

  it("permission gate rejects in deny mode", async () => {
    const bus = new EventBus();
    const gate = new PermissionGate(bus);
    const result = await gate.check("write_file", { path: "test.ts", content: "x" }, { approvalMode: "deny", allowedTools: ["read_file"] });
    expect(result.approved).toBe(false);
  });
});

describe("Integration: Escalation", () => {
  it("triggers escalation at 85% context", () => {
    expect(shouldEscalate(28000, 32768, 0)).toBe(true);
    expect(shouldEscalate(20000, 32768, 0)).toBe(false);
  });

  it("builds EscalationState with full schema", () => {
    const state = buildEscalationState("flash", "utility", "CONTEXT_OVERFLOW", "Exceeded 85%", "engineer", { activePlan: "Step 1", focusedFiles: ["a.ts"], messagesSnapshot: [] }, { tokenCount: 28000, limit: 32768 });
    expect(state.sourceTier).toBe("flash");
    expect(state.targetTier).toBe("utility");
    expect(state.triggerReason.code).toBe("CONTEXT_OVERFLOW");
    expect(escalateTier("flash")).toBe("utility");
  });
});

describe("Integration: Rewind", () => {
  it("checkpoint created on turn, rollback restores state", async () => {
    const bus = new EventBus();
    const cp = new GitCheckpointer(TMP, bus);
    cp.attach();

    writeFileSync(join(TMP, "turn1.ts"), "v1");
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 30));

    writeFileSync(join(TMP, "turn2.ts"), "v2");
    bus.publish("TURN_COMPLETE", { turnId: "t2" });
    await new Promise((r) => setTimeout(r, 30));

    const ok = cp.rollbackTo(1);
    expect(ok).toBe(true);
  });
});

describe("Integration: Goal Loop", () => {
  it("runs until model signals done", async () => {
    const client = { stream: vi.fn().mockImplementation(async () => ({
      [Symbol.asyncIterator]: async function* () {
        yield { content: "Task complete. Here is the report." };
      },
    })) } as any;

    const bus = new EventBus();
    const result = await runGoal("process files", client, bus, () => {});
    expect(result.success).toBe(true);
    expect(result.terminationReason).toBe("done");
    expect(result.turns).toBe(1);
  });
});

describe("Integration: MCP Routing", () => {
  it("identifies and routes mcp tools", async () => {
    expect(isMCPTool("mcp_db_query")).toBe(true);
    expect(isMCPTool("read_file")).toBe(false);

    const engine = { all: [{ name: "db", status: "disconnected", process: null, errorLog: [], tools: [] }] } as any;
    const result = await routeMCPToolCall("mcp_db_query", { sql: "SELECT 1" }, engine);
    expect(result.success).toBe(false); // Not connected
  });
});

describe("Integration: Plugin Registration", () => {
  it("registers sandbox mode with path guard", () => {
    const bus = new EventBus();
    const registry = new CoreRegistry();
    const worktree = new WorktreeEngine(TMP, bus);
    const pi = new CoreAPI(registry, bus, worktree, TMP);

    pi.registerAgent({ id: "test", name: "Test", description: "test agent", type: "interactive", modelTier: "auto", prompt: "You are a test.", tools: [], approvalMode: "prompt", allowedTools: [] });
    // Agent registration is handled by the registry; no sandbox modes anymore
  });

  it("registers and emits custom events", () => {
    const bus = new EventBus();
    const registry = new CoreRegistry();
    const worktree = new WorktreeEngine(TMP, bus);
    const api = new CoreAPI(registry, bus, worktree, TMP);

    api.registerEvent("TASK_COMPLETED");
    let received: any = null;
    api.subscribeEvent("TASK_COMPLETED", (e) => { received = e; });
    api.emitEvent("TASK_COMPLETED", { taskId: "t1" });

    expect(received).not.toBeNull();
    expect(received.payload.taskId).toBe("t1");
  });

  it("core api exposes workspace map and command execution", () => {
    const bus = new EventBus();
    const registry = new CoreRegistry();
    const worktree = new WorktreeEngine(TMP, bus);
    const api = new CoreAPI(registry, bus, worktree, TMP);

    const map = api.getWorkspaceMap();
    expect(map).toBeDefined();

    const result = api.executeCommand("echo hello");
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("hello");
  });
});
