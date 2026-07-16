import { describe, it, expect, afterEach } from "vitest";
import { bootstrap } from "../../src/bootstrap/container.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-container-test-" + Date.now());
const GLOBAL_PATH = join(TMP, "global", "config.json");
const WORKSPACE = join(TMP, "workspace");

const VALID_CONFIG = {
  modelTierFlash: "local", modelTierUtility: "local", modelTierDense: "local",
  models: {
    local: { protocol: "openai", model: "test-model", baseUrl: "http://localhost:11434/v1", contextLimit: 32768 },
  },
};

afterEach(async () => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Bootstrap Container", () => {
  it("bootstraps a full container with all components wired", async () => {
    mkdirSync(join(TMP, "global"), { recursive: true });
    mkdirSync(WORKSPACE, { recursive: true });
    execSync("git init", { cwd: WORKSPACE, stdio: "ignore" });
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));

    const container = await bootstrap({
      workspaceRoot: WORKSPACE,
      globalConfigPath: GLOBAL_PATH,
    });

    expect(container.bus).toBeDefined();
    expect(container.config.modelTierFlash).toBe("local");
    expect(container.registry).toBeDefined();
    expect(container.watcher.status).toBe("ready");
    expect(container.cleanup.clearedLocks).toBe(true);
    expect(existsSync(join(WORKSPACE, ".voidrift", "worktrees"))).toBe(true);

    await container.shutdown();
    expect(container.watcher.status).toBe("closed");
  });

  it("creates default config on first run", async () => {
    mkdirSync(WORKSPACE, { recursive: true });
    execSync("git init", { cwd: WORKSPACE, stdio: "ignore" });
    const freshGlobal = join(TMP, "fresh-global", "config.json");

    const container = await bootstrap({
      workspaceRoot: WORKSPACE,
      globalConfigPath: freshGlobal,
    });

    expect(existsSync(freshGlobal)).toBe(true);
    expect(container.config.modelTierFlash).toBe("default-local");
    await container.shutdown();
  });

  it("can skip watcher for headless/test scenarios", async () => {
    mkdirSync(join(TMP, "global"), { recursive: true });
    mkdirSync(WORKSPACE, { recursive: true });
    execSync("git init", { cwd: WORKSPACE, stdio: "ignore" });
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));

    const container = await bootstrap({
      workspaceRoot: WORKSPACE,
      globalConfigPath: GLOBAL_PATH,
      skipWatcher: true,
    });

    expect(container.watcher.status).toBe("idle");
    await container.shutdown();
  });

  it("event bus is functional after bootstrap", async () => {
    mkdirSync(join(TMP, "global"), { recursive: true });
    mkdirSync(WORKSPACE, { recursive: true });
    execSync("git init", { cwd: WORKSPACE, stdio: "ignore" });
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));

    const container = await bootstrap({
      workspaceRoot: WORKSPACE,
      globalConfigPath: GLOBAL_PATH,
      skipWatcher: true,
    });

    let received = false;
    container.bus.subscribe("USER_INPUT", () => { received = true; });
    container.bus.publish("USER_INPUT", { text: "hello" });
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBe(true);

    await container.shutdown();
  });

  it("registry is ready for plugin registration after bootstrap", async () => {
    mkdirSync(join(TMP, "global"), { recursive: true });
    mkdirSync(WORKSPACE, { recursive: true });
    execSync("git init", { cwd: WORKSPACE, stdio: "ignore" });
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));

    const container = await bootstrap({
      workspaceRoot: WORKSPACE,
      globalConfigPath: GLOBAL_PATH,
      skipWatcher: true,
    });

    container.registry.registerCapability({
      name: "test",
      trigger: "manual",
      execute: async () => "works",
    });
    const result = await container.registry.invokeCapability("test", {});
    expect(result).toBe("works");

    await container.shutdown();
  });
});
