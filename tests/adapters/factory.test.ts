import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdapter, createTierAdapter } from "../../src/adapters/factory.js";
import type { VoidRiftConfig } from "../../src/config/loader.js";

const TEST_CONFIG: VoidRiftConfig = {
  tiers: { flash: "local-qwen", utility: "claude-sonnet", dense: "claude-opus" },
  models: {
    "local-qwen": {
      protocol: "openai",
      model: "qwen2.5-coder-7b",
      baseUrl: "http://localhost:11434/v1",
      contextLimit: 32768,
      temperature: 0.2,
      maxOutputTokens: 4096,
      topP: 0.95,
    },
    "claude-sonnet": {
      protocol: "anthropic",
      model: "claude-3-5-sonnet-latest",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      contextLimit: 200000,
      temperature: 0.0,
      maxOutputTokens: 8192,
      topP: 0.9,
      topK: 50,
      additionalHeaders: { "x-custom": "value" },
    },
    "claude-opus": {
      protocol: "anthropic",
      model: "claude-3-opus-latest",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      contextLimit: 200000,
      temperature: 0.2,
    },
    "gemini-flash": {
      protocol: "google",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKeyEnv: "GEMINI_API_KEY",
      contextLimit: 1000000,
      temperature: 0.1,
      maxOutputTokens: 4096,
      topP: 0.7,
      topK: 20,
    },
  },
};

describe("Adapter Factory", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  describe("OpenAI protocol", () => {
    it("maps model, temperature, maxTokens, topP to client", () => {
      const resolved = createAdapter("local-qwen", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.model).toBe("qwen2.5-coder-7b");
      expect(client.temperature).toBe(0.2);
      expect(client.maxTokens).toBe(4096);
      expect(client.topP).toBe(0.95);
    });

    it("maps baseUrl to configuration.baseURL", () => {
      const resolved = createAdapter("local-qwen", TEST_CONFIG);
      const client = resolved.client as any;
      // OpenAI client stores baseURL in clientConfig or configuration
      expect(client.clientConfig?.baseURL ?? client.configuration?.baseURL).toBe("http://localhost:11434/v1");
    });

    it("sets streaming to true", () => {
      const resolved = createAdapter("local-qwen", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.streaming).toBe(true);
    });
  });

  describe("Anthropic protocol", () => {
    it("maps model, temperature, maxTokens, topP, topK to client", () => {
      const resolved = createAdapter("claude-sonnet", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.model).toBe("claude-3-5-sonnet-latest");
      expect(client.temperature).toBe(0.0);
      expect(client.maxTokens).toBe(8192);
      expect(client.topP).toBe(0.9);
      expect(client.topK).toBe(50);
    });

    it("resolves apiKeyEnv from process.env", () => {
      const resolved = createAdapter("claude-sonnet", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.apiKey || client.anthropicApiKey).toBe("test-anthropic-key");
    });

    it("sets streaming to true", () => {
      const resolved = createAdapter("claude-sonnet", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.streaming).toBe(true);
    });
  });

  describe("Google protocol", () => {
    it("maps model, temperature, maxOutputTokens, topP, topK to client", () => {
      const resolved = createAdapter("gemini-flash", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.model).toBe("gemini-2.0-flash");
      expect(client.temperature).toBe(0.1);
      expect(client.maxOutputTokens).toBe(4096);
      expect(client.topP).toBe(0.7);
      expect(client.topK).toBe(20);
    });

    it("resolves apiKeyEnv from process.env", () => {
      const resolved = createAdapter("gemini-flash", TEST_CONFIG);
      const client = resolved.client as any;
      expect(client.apiKey).toBe("test-gemini-key");
    });
  });

  describe("Tier resolution", () => {
    it("flash tier resolves to local-qwen", () => {
      const resolved = createTierAdapter("flash", TEST_CONFIG);
      expect(resolved.name).toBe("local-qwen");
      expect(resolved.config.protocol).toBe("openai");
    });

    it("utility tier resolves to claude-sonnet", () => {
      const resolved = createTierAdapter("utility", TEST_CONFIG);
      expect(resolved.name).toBe("claude-sonnet");
      expect(resolved.config.protocol).toBe("anthropic");
    });

    it("dense tier resolves to claude-opus", () => {
      const resolved = createTierAdapter("dense", TEST_CONFIG);
      expect(resolved.name).toBe("claude-opus");
      expect(resolved.config.protocol).toBe("anthropic");
    });
  });

  describe("Error handling", () => {
    it("throws for unknown model name", () => {
      expect(() => createAdapter("nonexistent", TEST_CONFIG)).toThrow(/not found/);
    });
  });
});
