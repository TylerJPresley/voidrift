import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { clearConfigCache } from "../src/config.js";
import { resolveModel, listAliases } from "../src/models.js";

describe("resolveModel", () => {
  const tmp = join(tmpdir(), `voidrift-test-models-${Date.now()}`);
  const modelsPath = join(tmp, "models.yml");
  const configDir = join(tmp, "config");

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(configDir, { recursive: true });
    // Point config to our test models file
    writeFileSync(join(configDir, "config.yml"), `models_file: ${modelsPath}\n`);
    process.env.VOIDRIFT_HOME = configDir;
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves a valid model with all fields", () => {
    writeFileSync(modelsPath, `
defaults:
  max_tokens: 16384
models:
  qwen35:
    base_url: http://localhost:8000/v1
    api_key: test-key
    model_id: Qwen/Qwen3.5
    concurrency: 4
`);
    const mi = resolveModel("qwen35");
    expect(mi.config.alias).toBe("qwen35");
    expect(mi.config.baseUrl).toBe("http://localhost:8000/v1");
    expect(mi.config.apiKey).toBe("test-key");
    expect(mi.config.modelId).toBe("Qwen/Qwen3.5");
    expect(mi.config.concurrency).toBe(4);
    expect(mi.config.protocol).toBe("openai");
  });

  it("applies defaults for missing optional fields", () => {
    writeFileSync(modelsPath, `
models:
  minimal:
    base_url: http://localhost:8000/v1
    api_key: k
    model_id: m
`);
    const mi = resolveModel("minimal");
    expect(mi.config.maxTokens).toBe(16384);
    expect(mi.config.maxReadLines).toBe(2000);
    expect(mi.config.concurrency).toBe(1);
  });

  it("throws on unknown alias", () => {
    writeFileSync(modelsPath, `models:\n  a:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    expect(() => resolveModel("nonexistent")).toThrow("Unknown model: nonexistent");
  });

  it("throws on missing required field (REQ-MC-5)", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    model_id: m\n`);
    expect(() => resolveModel("bad")).toThrow("missing required field 'api_key'");
  });

  it("throws on invalid protocol (REQ-MC-5)", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    api_key: k\n    model_id: m\n    protocol: grpc\n`);
    expect(() => resolveModel("bad")).toThrow("invalid protocol 'grpc'");
  });

  it("resolves anthropic protocol", () => {
    writeFileSync(modelsPath, `models:\n  claude:\n    base_url: https://api.anthropic.com\n    api_key: k\n    model_id: claude-opus\n    protocol: anthropic\n`);
    const mi = resolveModel("claude");
    expect(mi.config.protocol).toBe("anthropic");
  });

  it("resolves fallback field", () => {
    writeFileSync(modelsPath, `models:\n  main:\n    base_url: x\n    api_key: k\n    model_id: m\n    fallback: backup\n  backup:\n    base_url: y\n    api_key: k\n    model_id: n\n`);
    const mi = resolveModel("main");
    expect(mi.config.fallback).toBe("backup");
  });
});

describe("listAliases", () => {
  const tmp = join(tmpdir(), `voidrift-test-list-${Date.now()}`);
  const modelsPath = join(tmp, "models.yml");
  const configDir = join(tmp, "config");

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yml"), `models_file: ${modelsPath}\n`);
    process.env.VOIDRIFT_HOME = configDir;
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns sorted aliases", () => {
    writeFileSync(modelsPath, `models:\n  zeta:\n    base_url: x\n    api_key: k\n    model_id: m\n  alpha:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    expect(listAliases()).toEqual(["alpha", "zeta"]);
  });
});
