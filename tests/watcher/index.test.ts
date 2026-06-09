import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkspaceWatcher } from "../../src/watcher/index.js";
import { EventBus } from "../../src/events/bus.js";
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-watcher-test-" + Date.now());

afterEach(async () => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("WorkspaceWatcher", () => {
  it("starts with idle status", () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    expect(watcher.status).toBe("idle");
  });

  it("resolves start() when ready and reports ready status", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    await watcher.start();
    expect(watcher.status).toBe("ready");
    await watcher.stop();
  });

  it("emits FILE_CREATED on new file", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    const listener = vi.fn();
    bus.subscribe("FILE_CREATED", listener);

    await watcher.start();
    writeFileSync(join(TMP, "hello.ts"), "export const x = 1;");

    await new Promise((r) => setTimeout(r, 300));
    await watcher.stop();

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].payload.path).toBe("hello.ts");
  });

  it("emits FILE_MODIFIED on file change", async () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, "existing.ts"), "v1");

    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    const listener = vi.fn();
    bus.subscribe("FILE_MODIFIED", listener);

    await watcher.start();
    writeFileSync(join(TMP, "existing.ts"), "v2");

    await new Promise((r) => setTimeout(r, 300));
    await watcher.stop();

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].payload.path).toBe("existing.ts");
  });

  it("emits FILE_DELETED on unlink", async () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, "doomed.ts"), "bye");

    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    const listener = vi.fn();
    bus.subscribe("FILE_DELETED", listener);

    await watcher.start();
    unlinkSync(join(TMP, "doomed.ts"));

    await new Promise((r) => setTimeout(r, 300));
    await watcher.stop();

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].payload.path).toBe("doomed.ts");
  });

  it("reports closed status after stop", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    await watcher.start();
    await watcher.stop();
    expect(watcher.status).toBe("closed");
  });

  it("ignores dotfiles and node_modules", async () => {
    mkdirSync(join(TMP, ".hidden"), { recursive: true });
    mkdirSync(join(TMP, "node_modules", "pkg"), { recursive: true });
    mkdirSync(TMP, { recursive: true });

    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(TMP, bus);
    const listener = vi.fn();
    bus.subscribe("FILE_CREATED", listener);

    await watcher.start();
    writeFileSync(join(TMP, ".hidden", "secret"), "x");
    writeFileSync(join(TMP, "node_modules", "pkg", "index.js"), "x");

    await new Promise((r) => setTimeout(r, 300));
    await watcher.stop();

    expect(listener).not.toHaveBeenCalled();
  });
});
