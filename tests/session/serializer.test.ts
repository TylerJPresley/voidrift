import { describe, it, expect, afterEach } from "vitest";
import { TurnSerializer } from "../../src/session/serializer.js";
import { ContextManager } from "../../src/session/context.js";
import { EventBus } from "../../src/events/bus.js";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync, mkdirSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-serializer-test-" + Date.now());

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

function setupGitRepo() {
  require("fs").mkdirSync(TMP, { recursive: true });
  execSync("git init && git config user.email t@t.com && git config user.name T && touch f && git add . && git commit -m init", { cwd: TMP, stdio: "ignore" });
}

describe("TurnSerializer (G-10)", () => {
  it("saves session state with TurnStateJSON schema", () => {
    setupGitRepo();
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "s1", bus);
    const ctx = new ContextManager("persona", "map");
    ctx.addMessage({ role: "user", content: "hello" });
    ser.save(ctx.context);

    const raw = JSON.parse(readFileSync(ser.path, "utf-8"));
    expect(raw.sessionId).toBe("s1");
    expect(raw.turnIndex).toBeDefined();
    expect(raw.timestamp).toBeTypeOf("number");
    expect(raw.gitState.currentBranch).toBeDefined();
    expect(raw.gitState.checkpointSha).toBeDefined();
    expect(raw.gitState.isDirty).toBeTypeOf("boolean");
    expect(raw.harnessState.approvalMode).toBe("prompt");
    expect(raw.graphState.activeNode).toBeDefined();
    expect(raw.contextSnapshot.work.messages).toHaveLength(1);
  });

  it("loads saved state", () => {
    setupGitRepo();
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "s2", bus);
    const ctx = new ContextManager("p", "");
    ctx.addMessage({ role: "user", content: "test" });
    ctx.addMessage({ role: "assistant", content: "reply" });
    ser.save(ctx.context);

    const loaded = ser.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.contextSnapshot.work.messages).toHaveLength(2);
    expect(loaded!.sessionId).toBe("s2");
  });

  it("returns null when no file exists", () => {
    require("fs").mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "none", bus);
    expect(ser.load()).toBeNull();
  });

  it("auto-saves on TURN_COMPLETE when attached", async () => {
    setupGitRepo();
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "auto", bus);
    const ctx = new ContextManager("p", "");
    ctx.addMessage({ role: "user", content: "auto-saved" });

    ser.attach(() => ctx.context);
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 20));

    const loaded = ser.load();
    expect(loaded!.contextSnapshot.work.messages[0].content).toBe("auto-saved");
    expect(loaded!.turnIndex).toBe(1);
  });

  it("increments turnIndex on each save", async () => {
    setupGitRepo();
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "inc", bus);
    const ctx = new ContextManager("p", "");

    ser.attach(() => ctx.context);
    bus.publish("TURN_COMPLETE", { turnId: "t1" });
    await new Promise((r) => setTimeout(r, 10));
    bus.publish("TURN_COMPLETE", { turnId: "t2" });
    await new Promise((r) => setTimeout(r, 10));

    expect(ser.currentTurn).toBe(2);
  });

  it("captures git state including branch and dirty status", () => {
    setupGitRepo();
    require("fs").writeFileSync(join(TMP, "dirty.txt"), "uncommitted");
    const bus = new EventBus();
    const ser = new TurnSerializer(TMP, "git", bus);
    const ctx = new ContextManager("p", "");
    ser.save(ctx.context);

    const loaded = ser.load();
    expect(loaded!.gitState.isDirty).toBe(true);
    expect(loaded!.gitState.currentBranch).toMatch(/main|master/);
  });
});
