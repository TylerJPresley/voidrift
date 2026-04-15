import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandEnv, loadConfig, clearConfigCache, getMaxTokens, getBashConfig, expandConfigRefs } from "../src/config.js";

describe("expandEnv", () => {
  it("expands ${VAR} from environment", () => {
    process.env.TEST_VAR = "hello";
    expect(expandEnv("${TEST_VAR}")).toBe("hello");
    delete process.env.TEST_VAR;
  });

  it("expands ${VAR:-default} with fallback", () => {
    delete process.env.MISSING_VAR;
    expect(expandEnv("${MISSING_VAR:-fallback}")).toBe("fallback");
  });

  it("strips newlines from resolved values (REQ-CFG-10)", () => {
    process.env.NEWLINE_VAR = "line1\nline2\r\nline3";
    expect(expandEnv("${NEWLINE_VAR}")).toBe("line1line2line3");
    delete process.env.NEWLINE_VAR;
  });

  it("returns non-string values unchanged", () => {
    expect(expandEnv("no vars here")).toBe("no vars here");
  });

  it("returns empty string for unset var without default", () => {
    delete process.env.UNSET;
    expect(expandEnv("${UNSET}")).toBe("");
  });
});

describe("loadConfig", () => {
  const tmp = join(tmpdir(), `voidrift-test-config-${Date.now()}`);

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    clearConfigCache();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty object when config.yml missing", () => {
    const config = loadConfig(tmp);
    expect(config).toEqual({});
  });

  it("loads and parses YAML config", () => {
    writeFileSync(join(tmp, "config.yml"), "models_file: /tmp/models.yml\n");
    const config = loadConfig(tmp);
    expect(config.models_file).toBe("/tmp/models.yml");
  });

  it("expands env vars in config values", () => {
    process.env.TEST_KEY = "secret123";
    writeFileSync(join(tmp, "config.yml"), "api_keys:\n  test: ${TEST_KEY}\n");
    const config = loadConfig(tmp) as Record<string, unknown>;
    expect((config.api_keys as Record<string, string>).test).toBe("secret123");
    delete process.env.TEST_KEY;
  });
});

describe("getMaxTokens", () => {
  const tmp = join(tmpdir(), `voidrift-test-maxtok-${Date.now()}`);

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(tmp, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns min of stage default and model max_tokens", () => {
    const model = { maxTokens: 4096 };
    expect(getMaxTokens(model, "gather.triage")).toBe(4096);
  });

  it("returns stage default when model cap is higher", () => {
    const model = { maxTokens: 32768 };
    expect(getMaxTokens(model, "plan.task")).toBe(4000);
  });

  it("returns 4096 for unknown stage", () => {
    const model = { maxTokens: 16384 };
    expect(getMaxTokens(model, "unknown.stage")).toBe(4096);
  });
});

describe("getBashConfig", () => {
  const tmp = join(tmpdir(), `voidrift-test-bash-${Date.now()}`);

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(tmp, { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns defaults when no bash section", () => {
    const config = getBashConfig("develop");
    expect(config.enabled).toBe(true);
    expect(config.timeout).toBe(120);
    expect(config.maxOutputLines).toBe(500);
    expect(config.allowedPatterns).toEqual([]);
  });
});
