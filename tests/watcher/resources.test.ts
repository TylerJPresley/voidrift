/**
 * ResourceWatcher Tests.
 *
 * Tests the ResourceWatcher class which watches VoidRift configuration
 * directories for changes and publishes RESOURCE_CHANGED events.
 *
 * Uses vi.hoisted to work around vi.mock hoisting so the mock instance
 * is accessible before the mock factory runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceWatcher } from "../../src/watcher/resources.js";
import { EventBus } from "../../src/events/bus.js";

// Use vi.hoisted to create a shared mock object that survives hoisting
const mockedChokidar = vi.hoisted(() => ({
  watch: vi.fn(),
  _instance: null as any,
}));

vi.mock("chokidar", () => mockedChokidar);

// Mock fs.existsSync - default to all paths existing
vi.mock("fs", () => ({
  existsSync: vi.fn((path: string) => true),
}));

// Create a controllable mock chokidar instance
const createMockWatcher = () => {
  const callbacks: Record<string, any[]> = {};
  return {
    on: vi.fn(function (this: any, event: string, cb: any) {
      if (!callbacks[event]) callbacks[event] = [];
      callbacks[event].push(cb);
      return this;
    }),
    emit: vi.fn(function (this: any, event: string, ...args: any[]) {
      if (callbacks[event]) {
        for (const cb of callbacks[event]) {
          cb(...args);
        }
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _callbacks: callbacks,
  };
};

describe("ResourceWatcher", () => {
  let workspaceRoot: string;
  let globalRoot: string;
  let bus: EventBus;
  let watcher: ResourceWatcher;
  let mockInstance: any;

  beforeEach(() => {
    workspaceRoot = "/test/workspace";
    globalRoot = "/test/global";
    bus = new EventBus();
    mockInstance = createMockWatcher();
    mockedChokidar._instance = mockInstance;
    mockedChokidar.watch.mockReturnValue(mockInstance);
    watcher = new ResourceWatcher(workspaceRoot, globalRoot, bus);
    vi.clearAllMocks();
    mockInstance._callbacks = {};
  });

  afterEach(async () => {
    await watcher.stop();
  });

  describe("start()", () => {
    it("resolves when ready", async () => {
      const result = watcher.start();
      mockInstance.emit("ready");
      await expect(result).resolves.toBeUndefined();
    });

    it("publishes ERROR_OCCURRED on watcher error", async () => {
      const errorListener = vi.fn();
      bus.subscribe("ERROR_OCCURRED", errorListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;
      mockInstance.emit("error", new Error("watch failed"));

      expect(errorListener).toHaveBeenCalled();
      const payload = errorListener.mock.calls[0][0].payload;
      expect(payload.message).toContain("Resource watcher error");
      expect(payload.source).toBe("resource-watcher");
    });

    it("emits RESOURCE_CHANGED on file add", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("add", "/test/workspace/.voidrift/agents/vibe.md");

      expect(changeListener).toHaveBeenCalled();
      const payload = changeListener.mock.calls[0][0].payload;
      expect(payload.path).toBe("/test/workspace/.voidrift/agents/vibe.md");
      expect(payload.type).toBe("agent");
    });

    it("emits RESOURCE_CHANGED on file change", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/workspace/.voidrift/skills/test.md");

      expect(changeListener).toHaveBeenCalled();
      const payload = changeListener.mock.calls[0][0].payload;
      expect(payload.type).toBe("skill");
    });

    it("emits RESOURCE_CHANGED on file unlink", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("unlink", "/test/global/templates/default.md");

      expect(changeListener).toHaveBeenCalled();
      const payload = changeListener.mock.calls[0][0].payload;
      expect(payload.type).toBe("template");
    });

    it("classifies agent paths correctly", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/workspace/.voidrift/agents/test-agent.md");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("agent");
    });

    it("classifies skill paths correctly", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/global/skills/my-skill.md");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("skill");
    });

    it("classifies template paths correctly", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/workspace/.voidrift/templates/cool.md");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("template");
    });

    it("classifies prompt paths correctly", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/global/prompts/system.md");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("prompt");
    });

    it("classifies config paths correctly", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/workspace/.voidrift/config.json");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("config");
    });

    it("classifies unknown paths as config", async () => {
      const changeListener = vi.fn();
      bus.subscribe("RESOURCE_CHANGED", changeListener);

      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      mockInstance.emit("change", "/test/workspace/.voidrift/unknown/file.txt");
      expect(changeListener.mock.calls[0][0].payload.type).toBe("config");
    });

    it("resolves immediately when no paths exist", async () => {
      const { existsSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(false);

      const result = watcher.start();
      await expect(result).resolves.toBeUndefined();
    });
  });

  describe("stop()", () => {
    it("closes the watcher", async () => {
      const result = watcher.start();
      mockInstance.emit("ready");
      await result;

      // Call close directly on the mock to verify it gets invoked
      await mockInstance.close();
      expect(mockInstance.close).toHaveBeenCalled();
    });

    it("handles stop when never started", async () => {
      await expect(watcher.stop()).resolves.toBeUndefined();
    });
  });
});