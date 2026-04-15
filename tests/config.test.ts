import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  expandEnv, loadConfig, clearConfigCache, getMaxTokens,
  getBashConfig, expandConfigRefs, getRetention,
} from "../src/config.js";

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

  it("strips LF from default branch", () => {
    delete process.env.UNSET_VAR;
    expect(expandEnv("${UNSET_VAR:-default\ninjection}")).toBe("defaultinjection");
  });

  it("normal value without newlines unchanged", () => {
    process.env.CLEAN_VAR = "sk-abc123";
    expect(expandEnv("${CLEAN_VAR}")).toBe("sk-abc123");
    delete process.env.CLEAN_VAR;
  });
});

describe("expandConfigRefs", () => {
  const tmp = join(tmpdir(), `voidrift-test-configrefs-${Date.now()}`);

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

  it("expands env var in string", () => {
    process.env.MY_HOST = "10.0.0.1";
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    expect(expandConfigRefs("http://${MY_HOST}:8000")).toBe("http://10.0.0.1:8000");
    delete process.env.MY_HOST;
  });

  it("expands cross-reference to config section", () => {
    writeFileSync(join(tmp, "config.yml"), "worker:\n  ip: 10.0.0.1\n");
    expect(expandConfigRefs("http://${worker.ip}:8000")).toBe("http://10.0.0.1:8000");
  });

  it("cross-reference with integer value", () => {
    writeFileSync(join(tmp, "config.yml"), "server:\n  port: 9999\n");
    expect(expandConfigRefs("http://localhost:${server.port}/v1")).toBe("http://localhost:9999/v1");
  });

  it("returns plain string unchanged", () => {
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    expect(expandConfigRefs("plain-string")).toBe("plain-string");
  });

  it("missing env var returns empty", () => {
    delete process.env.NOPE;
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    expect(expandConfigRefs("${NOPE}")).toBe("");
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
    expect(config.models_file ?? (config as Record<string, unknown>)["models_file"]).toBe("/tmp/models.yml");
  });

  it("expands env vars in config values", () => {
    process.env.TEST_KEY = "secret123";
    writeFileSync(join(tmp, "config.yml"), "api_keys:\n  test: ${TEST_KEY}\n");
    const config = loadConfig(tmp) as Record<string, unknown>;
    expect((config.api_keys as Record<string, string>).test).toBe("secret123");
    delete process.env.TEST_KEY;
  });
});

describe("getRetention", () => {
  const tmp = join(tmpdir(), `voidrift-test-retention-${Date.now()}`);

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

  it("returns default project retention of 5", () => {
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    expect(getRetention("project")).toBe(5);
  });

  it("returns default global retention of 30", () => {
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    expect(getRetention("global")).toBe(30);
  });

  it("returns configured project retention", () => {
    writeFileSync(join(tmp, "config.yml"), "retention:\n  project: 10\n");
    expect(getRetention("project")).toBe(10);
  });

  it("returns configured global retention", () => {
    writeFileSync(join(tmp, "config.yml"), "retention:\n  global: 60\n");
    expect(getRetention("global")).toBe(60);
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

  it("gather.analysis stage default is 8192", () => {
    const model = { maxTokens: 32768 };
    expect(getMaxTokens(model, "gather.analysis")).toBe(8192);
  });

  it("plan.architecture stage default is 32768", () => {
    const model = { maxTokens: 65536 };
    expect(getMaxTokens(model, "plan.architecture")).toBe(32768);
  });

  it("plan.architecture capped by low model limit", () => {
    const model = { maxTokens: 4096 };
    expect(getMaxTokens(model, "plan.architecture")).toBe(4096);
  });

  it("config override wins over builtin default", () => {
    writeFileSync(join(tmp, "config.yml"), "stage_max_tokens:\n  gather.analysis: 16384\n");
    const model = { maxTokens: 32768 };
    expect(getMaxTokens(model, "gather.analysis")).toBe(16384);
  });

  it("config override still capped by model", () => {
    writeFileSync(join(tmp, "config.yml"), "stage_max_tokens:\n  gather.analysis: 32768\n");
    const model = { maxTokens: 4096 };
    expect(getMaxTokens(model, "gather.analysis")).toBe(4096);
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
    writeFileSync(join(tmp, "config.yml"), "{}\n");
    const config = getBashConfig("develop");
    expect(config.enabled).toBe(true);
    expect(config.timeout).toBe(120);
    expect(config.maxOutputLines).toBe(500);
    expect(config.allowedPatterns).toEqual([]);
  });

  it("reads per-command timeout", () => {
    writeFileSync(join(tmp, "config.yml"),
      "bash:\n  timeout: 120\n  develop:\n    timeout: 60\n");
    const config = getBashConfig("develop");
    expect(config.timeout).toBe(60);
  });

  it("inherits global timeout when command has none", () => {
    writeFileSync(join(tmp, "config.yml"),
      "bash:\n  timeout: 180\n  chat:\n    enabled: true\n");
    const config = getBashConfig("chat");
    expect(config.timeout).toBe(180);
  });

  it("reads allowed_patterns per command", () => {
    writeFileSync(join(tmp, "config.yml"),
      'bash:\n  develop:\n    allowed_patterns:\n      - "make *"\n      - "pytest *"\n');
    const config = getBashConfig("develop");
    expect(config.allowedPatterns).toEqual(["make *", "pytest *"]);
  });

  it("disabled command", () => {
    writeFileSync(join(tmp, "config.yml"),
      "bash:\n  develop:\n    enabled: false\n");
    const config = getBashConfig("develop");
    expect(config.enabled).toBe(false);
  });
});
