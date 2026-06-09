import { describe, it, expect, afterEach } from "vitest";
import { AuditLogger } from "../../src/logging/audit.js";
import { EventBus } from "../../src/events/bus.js";
import { readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-audit-test-" + Date.now());
const GLOBAL_LOG_DIR = join(TMP, "global-logs");

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function makeLogger(sessionId = "test-session") {
  return new AuditLogger({ workspaceRoot: TMP, sessionId, globalLogDir: GLOBAL_LOG_DIR });
}

describe("AuditLogger", () => {
  it("creates local log directory and writes entries", () => {
    const logger = makeLogger();
    logger.local("info", "test", "hello world");

    expect(existsSync(logger.localLogPath)).toBe(true);
    const entry = JSON.parse(readFileSync(logger.localLogPath, "utf-8").trim());
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hello world");
    expect(entry.timestamp).toBeDefined();
  });

  it("writes to global error log", () => {
    const logger = makeLogger();
    logger.global("error", "adapter", "connection timeout");

    expect(existsSync(logger.globalLogPath)).toBe(true);
    const entry = JSON.parse(readFileSync(logger.globalLogPath, "utf-8").trim());
    expect(entry.level).toBe("error");
    expect(entry.source).toBe("adapter");
    expect(entry.message).toBe("connection timeout");
  });

  it("appends multiple entries", () => {
    const logger = makeLogger("multi");
    logger.local("info", "a", "first");
    logger.local("warn", "b", "second");

    const lines = readFileSync(logger.localLogPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("includes data field when provided", () => {
    const logger = makeLogger("data-test");
    logger.local("info", "tool", "executed", { tool: "read_file", elapsed: 42 });

    const entry = JSON.parse(readFileSync(logger.localLogPath, "utf-8").trim());
    expect(entry.data).toEqual({ tool: "read_file", elapsed: 42 });
  });

  it("auto-logs USER_INPUT events when attached to bus", async () => {
    const bus = new EventBus();
    const logger = makeLogger("bus-test");
    logger.attach(bus);

    bus.publish("USER_INPUT", { text: "fix the bug" });
    await new Promise((r) => setTimeout(r, 20));

    const entry = JSON.parse(readFileSync(logger.localLogPath, "utf-8").trim());
    expect(entry.source).toBe("user");
    expect(entry.message).toBe("input");
    expect(entry.data.text).toBe("fix the bug");
  });

  it("auto-logs ERROR_OCCURRED to both local and global", async () => {
    const bus = new EventBus();
    const logger = makeLogger("error-test");
    logger.attach(bus);

    bus.publish("ERROR_OCCURRED", { message: "API timeout", source: "adapter" });
    await new Promise((r) => setTimeout(r, 20));

    const localEntry = JSON.parse(readFileSync(logger.localLogPath, "utf-8").trim());
    expect(localEntry.level).toBe("error");
    expect(localEntry.message).toBe("API timeout");

    const globalEntry = JSON.parse(readFileSync(logger.globalLogPath, "utf-8").trim());
    expect(globalEntry.level).toBe("error");
    expect(globalEntry.source).toBe("adapter");
  });

  it("auto-logs TURN_COMPLETE events", async () => {
    const bus = new EventBus();
    const logger = makeLogger("turn-test");
    logger.attach(bus);

    bus.publish("TURN_COMPLETE", { turnId: "t-123" });
    await new Promise((r) => setTimeout(r, 20));

    const entry = JSON.parse(readFileSync(logger.localLogPath, "utf-8").trim());
    expect(entry.message).toBe("turn_complete");
    expect(entry.data.turnId).toBe("t-123");
  });

  it("detach stops auto-logging", async () => {
    const bus = new EventBus();
    const logger = makeLogger("detach-test");
    const detach = logger.attach(bus);

    detach();
    bus.publish("USER_INPUT", { text: "should not log" });
    await new Promise((r) => setTimeout(r, 20));

    expect(existsSync(logger.localLogPath)).toBe(false);
  });
});
