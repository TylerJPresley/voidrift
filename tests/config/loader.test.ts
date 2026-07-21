import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigSchema } from "../../src/config/loader.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-config-test-" + Date.now());
const GLOBAL_PATH = join(TMP, "global", "config.json");
const WORKSPACE = join(TMP, "workspace");

const VALID_CONFIG = {
  modelSelected: "local-qwen", modelUtility: "claude-sonnet", modelEscalation: "claude-opus",
  models: {
    "local-qwen": { protocol: "openai", model: "qwen2.5-coder-7b", baseUrl: "http://localhost:11434/v1", contextLimit: 32768 },
    "claude-sonnet": { protocol: "anthropic", model: "claude-3-5-sonnet-latest", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", contextLimit: 200000, temperature: 0 },
    "claude-opus": { protocol: "anthropic", model: "claude-3-opus-latest", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", contextLimit: 200000 },
  },
};

beforeEach(() => {
  mkdirSync(join(TMP, "global"), { recursive: true });
  mkdirSync(join(WORKSPACE, ".voidrift"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Config Loader", () => {
  it("loads a valid global config", () => {
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));
    const config = loadConfig({ globalConfigPath: GLOBAL_PATH });
    expect(config.modelSelected).toBe("local-qwen");
    expect(config.models["local-qwen"].protocol).toBe("openai");
  });

  it("creates default config on first run when global doesn't exist", () => {
    const freshPath = join(TMP, "fresh", "config.json");
    expect(existsSync(freshPath)).toBe(false);
    const config = loadConfig({ globalConfigPath: freshPath });
    expect(existsSync(freshPath)).toBe(true);
    expect(config.modelSelected).toBe("default-local");
  });

  it("merges local workspace config over global", () => {
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));
    writeFileSync(
      join(WORKSPACE, ".voidrift", "config.json"),
      JSON.stringify({ modelSelected: "claude-sonnet" })
    );
    const config = loadConfig({ globalConfigPath: GLOBAL_PATH, workspaceRoot: WORKSPACE });
    expect(config.modelSelected).toBe("claude-sonnet"); // overridden
    expect(config.modelUtility).toBe("claude-sonnet"); // preserved from global
  });

  it("deep merges model overrides", () => {
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));
    writeFileSync(
      join(WORKSPACE, ".voidrift", "config.json"),
      JSON.stringify({ models: { "local-qwen": { temperature: 0.8 } } })
    );
    const config = loadConfig({ globalConfigPath: GLOBAL_PATH, workspaceRoot: WORKSPACE });
    expect(config.models["local-qwen"].temperature).toBe(0.8);
    expect(config.models["local-qwen"].baseUrl).toBe("http://localhost:11434/v1"); // preserved
  });

  it("throws on invalid JSON", () => {
    writeFileSync(GLOBAL_PATH, "not json {{{");
    expect(() => loadConfig({ globalConfigPath: GLOBAL_PATH })).toThrow(/Failed to parse JSON/);
  });

  it("throws when tier references nonexistent model", () => {
    const bad = { ...VALID_CONFIG, modelSelected: "nonexistent", modelUtility: "claude-sonnet", modelEscalation: "claude-opus" };
    writeFileSync(GLOBAL_PATH, JSON.stringify(bad));
    expect(() => loadConfig({ globalConfigPath: GLOBAL_PATH })).toThrow(/Model fields must reference/);
  });

  it("throws on invalid protocol enum", () => {
    const bad = { modelSelected: "x", modelUtility: "x", modelEscalation: "x", models: { x: { protocol: "invalid", model: "m", baseUrl: "http://x", contextLimit: 1000 } } };
    writeFileSync(GLOBAL_PATH, JSON.stringify(bad));
    expect(() => loadConfig({ globalConfigPath: GLOBAL_PATH })).toThrow(/Invalid VoidRift config/);
  });

  it("warns but doesn't throw when apiKeyEnv is unset", () => {
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));
    delete process.env.ANTHROPIC_API_KEY;
    // Should not throw
    const config = loadConfig({ globalConfigPath: GLOBAL_PATH });
    expect(config.models["claude-sonnet"].apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("ignores local config when workspace has no .voidrift/config.json", () => {
    writeFileSync(GLOBAL_PATH, JSON.stringify(VALID_CONFIG));
    const emptyWorkspace = join(TMP, "empty-ws");
    mkdirSync(emptyWorkspace, { recursive: true });
    const config = loadConfig({ globalConfigPath: GLOBAL_PATH, workspaceRoot: emptyWorkspace });
    expect(config.modelSelected).toBe("local-qwen");
  });
});
