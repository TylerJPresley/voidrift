import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearConfigCache } from "../src/config.js";
import { resolveModel, listAliases } from "../src/models.js";

describe("resolveModel", () => {
  const tmp = join(tmpdir(), `voidrift-test-models-${Date.now()}`);
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
    expect(mi.config.maxInputChars).toBe(0);
  });

  it("defaults section overrides built-in defaults", () => {
    writeFileSync(modelsPath, `
defaults:
  max_tokens: 8192
  concurrency: 2
models:
  test:
    base_url: http://localhost:8000/v1
    api_key: k
    model_id: m
`);
    const mi = resolveModel("test");
    expect(mi.config.maxTokens).toBe(8192);
    expect(mi.config.concurrency).toBe(2);
  });

  it("model entry overrides defaults section", () => {
    writeFileSync(modelsPath, `
defaults:
  max_tokens: 8192
  concurrency: 2
models:
  test:
    base_url: http://localhost:8000/v1
    api_key: k
    model_id: m
    max_tokens: 32768
    concurrency: 8
`);
    const mi = resolveModel("test");
    expect(mi.config.maxTokens).toBe(32768);
    expect(mi.config.concurrency).toBe(8);
  });

  it("throws on unknown alias", () => {
    writeFileSync(modelsPath, `models:\n  a:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    expect(() => resolveModel("nonexistent")).toThrow("Unknown model: nonexistent");
  });

  it("error message lists available models", () => {
    writeFileSync(modelsPath, `models:\n  claude:\n    base_url: x\n    api_key: k\n    model_id: m\n  qwen:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    expect(() => resolveModel("nope")).toThrow("claude");
  });

  it("throws on missing required field api_key (REQ-MC-5)", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    model_id: m\n`);
    expect(() => resolveModel("bad")).toThrow("missing required field 'api_key'");
  });

  it("throws on missing required field base_url", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    api_key: k\n    model_id: m\n`);
    expect(() => resolveModel("bad")).toThrow("missing required field 'base_url'");
  });

  it("throws on missing required field model_id", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    api_key: k\n`);
    expect(() => resolveModel("bad")).toThrow("missing required field 'model_id'");
  });

  it("throws on invalid protocol (REQ-MC-5)", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    api_key: k\n    model_id: m\n    protocol: grpc\n`);
    expect(() => resolveModel("bad")).toThrow("invalid protocol 'grpc'");
  });

  it("error message includes doctor hint", () => {
    writeFileSync(modelsPath, `models:\n  bad:\n    base_url: x\n    model_id: m\n`);
    expect(() => resolveModel("bad")).toThrow("voidrift doctor");
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

  it("resolves max_context field", () => {
    writeFileSync(modelsPath, `models:\n  big:\n    base_url: x\n    api_key: k\n    model_id: m\n    max_context: 200000\n`);
    const mi = resolveModel("big");
    expect(mi.config.maxContext).toBe(200000);
  });

  it("max_context undefined when not set", () => {
    writeFileSync(modelsPath, `models:\n  bare:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    const mi = resolveModel("bare");
    expect(mi.config.maxContext).toBeUndefined();
  });

  // --- Token budget fields ---

  it("resolves max_input_tokens and max_output_tokens", () => {
    writeFileSync(modelsPath, `models:\n  budgeted:\n    base_url: x\n    api_key: k\n    model_id: m\n    max_input_tokens: 200000\n    max_output_tokens: 50000\n`);
    const mi = resolveModel("budgeted");
    expect(mi.config.maxInputTokens).toBe(200000);
    expect(mi.config.maxOutputTokens).toBe(50000);
  });

  it("token budget fields undefined when not set", () => {
    writeFileSync(modelsPath, `models:\n  bare:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    const mi = resolveModel("bare");
    expect(mi.config.maxInputTokens).toBeUndefined();
    expect(mi.config.maxOutputTokens).toBeUndefined();
  });

  it("resolves provider field", () => {
    writeFileSync(modelsPath, `models:\n  claude:\n    base_url: https://api.anthropic.com\n    api_key: k\n    model_id: claude-opus\n    protocol: anthropic\n    provider: anthropic\n    type: cloud\n`);
    const mi = resolveModel("claude");
    expect(mi.config.provider).toBe("anthropic");
    expect(mi.config.modelType).toBe("cloud");
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

  it("includes all model types", () => {
    writeFileSync(modelsPath, `models:\n  cloud:\n    base_url: x\n    api_key: k\n    model_id: m\n    type: cloud\n  local:\n    base_url: x\n    api_key: k\n    model_id: m\n    type: local\n  gw:\n    base_url: x\n    api_key: k\n    model_id: m\n    type: gateway\n`);
    const aliases = listAliases();
    expect(aliases).toContain("cloud");
    expect(aliases).toContain("local");
    expect(aliases).toContain("gw");
  });

  it("returns empty when no models file", () => {
    // Point to nonexistent file
    writeFileSync(join(configDir, "config.yml"), `models_file: ${join(tmp, "nope.yml")}\n`);
    clearConfigCache();
    expect(listAliases()).toEqual([]);
  });

  it("usable for shell completion", () => {
    writeFileSync(modelsPath, `models:\n  qwen35:\n    base_url: x\n    api_key: k\n    model_id: m\n  claude:\n    base_url: x\n    api_key: k\n    model_id: m\n`);
    const aliases = listAliases();
    // Shell completion: sorted, no duplicates, plain strings
    expect(aliases).toEqual([...new Set(aliases)].sort());
    expect(aliases.every(a => typeof a === "string")).toBe(true);
  });
});
