import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitCheckpointer } from "../../src/safeguards/checkpoint.js";
import { computeDiff, computeEditDiff, getWorkspaceDiff } from "../../src/safeguards/diff.js";
import { routeMCPToolCall, isMCPTool } from "../../src/mcp/router.js";
import { TaskScheduler, parseDelay } from "../../src/orchestration/scheduler.js";
import { EventBus } from "../../src/events/bus.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-backend-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  execSync("git init && git config user.email t@t.com && git config user.name T && touch f.txt && git add . && git commit -m init", { cwd: TMP, stdio: "ignore" });
});

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("GitCheckpointer", () => {
  it("creates checkpoint when workspace is dirty", () => {
    const bus = new EventBus();
    const cp = new GitCheckpointer(TMP, bus);
    writeFileSync(join(TMP, "new.ts"), "export const x = 1;");
    const sha = cp.checkpoint();
    expect(sha).not.toBeNull();
  });

  it("returns null when workspace is clean", () => {
    const bus = new EventBus();
    const cp = new GitCheckpointer(TMP, bus);
    expect(cp.checkpoint()).toBeNull();
  });

  it("rollbackTo reverts to a previous checkpoint", async () => {
    const bus = new EventBus();
    const cp = new GitCheckpointer(TMP, bus);
    cp.attach();

    writeFileSync(join(TMP, "a.ts"), "v1");
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 20));

    writeFileSync(join(TMP, "b.ts"), "v2");
    bus.publish("TURN_COMPLETE", { turnId: "t2" });
    await new Promise((r) => setTimeout(r, 20));

    const ok = cp.rollbackTo(1);
    expect(ok).toBe(true);
  });

  it("auto-checkpoints on TURN_COMPLETE", async () => {
    const bus = new EventBus();
    const cp = new GitCheckpointer(TMP, bus);
    cp.attach();
    writeFileSync(join(TMP, "auto.ts"), "auto");
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(cp.currentTurn).toBe(1);
  });
});

describe("computeDiff", () => {
  it("shows additions for new file", () => {
    const lines = computeDiff(TMP, "brand-new.ts", "line1\nline2");
    expect(lines.some((l) => l.startsWith("+"))).toBe(true);
  });

  it("shows changes for existing file", () => {
    writeFileSync(join(TMP, "existing.ts"), "old content");
    const lines = computeDiff(TMP, "existing.ts", "new content");
    expect(lines.some((l) => l.startsWith("-"))).toBe(true);
    expect(lines.some((l) => l.startsWith("+"))).toBe(true);
  });
});

describe("computeEditDiff", () => {
  it("shows search/replace diff", () => {
    writeFileSync(join(TMP, "edit.ts"), "const x = 1;\nconst y = 2;");
    const lines = computeEditDiff(TMP, "edit.ts", "const y = 2;", "const y = 42;");
    expect(lines.some((l) => l.includes("-const y = 2;"))).toBe(true);
    expect(lines.some((l) => l.includes("+const y = 42;"))).toBe(true);
  });
});

describe("getWorkspaceDiff", () => {
  it("returns diff when workspace has changes", () => {
    writeFileSync(join(TMP, "f.txt"), "modified");
    const diff = getWorkspaceDiff(TMP);
    expect(diff).toContain("modified");
  });
});

describe("MCP Router", () => {
  it("isMCPTool identifies mcp_ prefixed tools", () => {
    expect(isMCPTool("mcp_db_query")).toBe(true);
    expect(isMCPTool("read_file")).toBe(false);
  });

  it("parses server and tool name from mcp_ format", async () => {
    const engine = { all: [{ name: "db", status: "disconnected", process: null, errorLog: [], tools: [] }] } as any;
    const result = await routeMCPToolCall("mcp_db_query", { sql: "SELECT 1" }, engine);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not connected");
  });

  it("returns error for invalid tool name format", async () => {
    const engine = { all: [] } as any;
    const result = await routeMCPToolCall("invalid_name", {}, engine);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid MCP tool name");
  });

  it("returns error for unknown server", async () => {
    const engine = { all: [] } as any;
    const result = await routeMCPToolCall("mcp_unknown_tool", {}, engine);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });
});

describe("TaskScheduler", () => {
  it("schedules a delay task and fires it", async () => {
    const bus = new EventBus();
    const fired: string[] = [];
    const sched = new TaskScheduler(bus, (instr) => fired.push(instr));
    sched.scheduleDelay(50, "run tests");
    expect(sched.active).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toContain("run tests");
  });

  it("cancels a scheduled task", () => {
    const bus = new EventBus();
    const sched = new TaskScheduler(bus, () => {});
    const task = sched.scheduleDelay(10000, "never");
    sched.cancel(task.id);
    expect(sched.active).toHaveLength(0);
  });

  it("cancelAll stops everything", () => {
    const bus = new EventBus();
    const sched = new TaskScheduler(bus, () => {});
    sched.scheduleDelay(10000, "a");
    sched.scheduleDelay(10000, "b");
    sched.cancelAll();
    expect(sched.active).toHaveLength(0);
  });
});

describe("parseDelay", () => {
  it("parses seconds", () => { expect(parseDelay("30s")).toBe(30000); });
  it("parses minutes", () => { expect(parseDelay("15m")).toBe(900000); });
  it("parses hours", () => { expect(parseDelay("2h")).toBe(7200000); });
});
