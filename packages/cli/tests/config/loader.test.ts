import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig } from "../../src/config/loader.ts";

const tmpDir = join(import.meta.dirname, "__tmp_config");

beforeEach(() => mkdirSync(join(tmpDir, ".voidrift"), { recursive: true }));
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("loadConfig", () => {
  it("loads model config from .voidrift/models.json", () => {
    writeFileSync(join(tmpDir, ".voidrift", "models.json"), JSON.stringify({
      default_model: "test-model",
      models: { "test-model": { model_id: "test-model", base_url: "http://localhost:8000/v1", api_key: "sk-test", protocol: "openai", max_tokens: 1024, max_context: 4096 } },
    }));
    const { model, modelName } = loadConfig(tmpDir);
    expect(modelName).toBe("test-model");
    expect(model.base_url).toBe("http://localhost:8000/v1");
    expect(model.protocol).toBe("openai");
  });

  it("resolves env vars in api_key", () => {
    process.env.TEST_KEY = "resolved-key";
    writeFileSync(join(tmpDir, ".voidrift", "models.json"), JSON.stringify({
      default_model: "m",
      models: { m: { model_id: "m", base_url: "http://x", api_key: "${TEST_KEY}", protocol: "openai", max_tokens: 1024, max_context: 4096 } },
    }));
    const { model } = loadConfig(tmpDir);
    expect(model.api_key).toBe("resolved-key");
    delete process.env.TEST_KEY;
  });

  it("uses default value when env var is missing", () => {
    delete process.env.MISSING_VAR;
    writeFileSync(join(tmpDir, ".voidrift", "models.json"), JSON.stringify({
      default_model: "m",
      models: { m: { model_id: "m", base_url: "http://x", api_key: "${MISSING_VAR:-fallback}", protocol: "openai", max_tokens: 1024, max_context: 4096 } },
    }));
    const { model } = loadConfig(tmpDir);
    expect(model.api_key).toBe("fallback");
  });

  it("throws when config file is missing", () => {
    // Mock homedir to a nonexistent path too
    const origHome = process.env.HOME;
    process.env.HOME = "/nonexistent_home";
    expect(() => loadConfig("/nonexistent")).toThrow("No config found");
    process.env.HOME = origHome;
  });

  it("throws when model name is not in config", () => {
    writeFileSync(join(tmpDir, ".voidrift", "models.json"), JSON.stringify({
      default_model: "missing",
      models: { other: { model_id: "other", base_url: "http://x", api_key: "", protocol: "openai", max_tokens: 1024, max_context: 4096 } },
    }));
    expect(() => loadConfig(tmpDir)).toThrow('Model "missing" not found');
  });
});
