import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runChecks, formatResults } from "../../src/commands/doctor.js";
import { clearConfigCache } from "../../src/config.js";

describe("doctor", () => {
  const tmp = join(tmpdir(), `voidrift-test-doctor-${Date.now()}`);

  beforeEach(() => {
    clearConfigCache();
    mkdirSync(join(tmp, "logs"), { recursive: true });
    mkdirSync(join(tmp, "resources", "skills"), { recursive: true });
    process.env.VOIDRIFT_HOME = tmp;
  });

  afterEach(() => {
    clearConfigCache();
    delete process.env.VOIDRIFT_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("passes with valid setup", () => {
    writeFileSync(join(tmp, "config.yml"), "models_file: /tmp/models.yml\n");
    writeFileSync("/tmp/models.yml", "models:\n  test:\n    base_url: http://localhost\n    api_key: k\n    model_id: m\n");
    const results = runChecks();
    expect(results.some(r => r.name === "config" && r.status === "pass")).toBe(true);
  });

  it("fails on invalid YAML config", () => {
    writeFileSync(join(tmp, "config.yml"), "key: [unclosed");
    const results = runChecks();
    expect(results.some(r => r.name === "config" && r.status === "fail")).toBe(true);
  });

  it("warns on missing config", () => {
    const results = runChecks();
    expect(results.some(r => r.name === "config" && r.status === "warn")).toBe(true);
  });

  it("checks disk space", () => {
    const results = runChecks();
    expect(results.some(r => r.name === "disk_space")).toBe(true);
  });

  it("formatResults produces readable output", () => {
    const results = [
      { name: "test", status: "pass" as const, message: "ok" },
      { name: "warn", status: "warn" as const, message: "low" },
      { name: "fail", status: "fail" as const, message: "bad" },
    ];
    const output = formatResults(results);
    expect(output).toContain("✓");
    expect(output).toContain("⚠");
    expect(output).toContain("✗");
  });

  it("detects missing model fields (REQ-U-16b)", () => {
    writeFileSync(join(tmp, "config.yml"), `models_file: ${join(tmp, "models.yml")}\n`);
    writeFileSync(join(tmp, "models.yml"), "models:\n  bad:\n    base_url: x\n    model_id: m\n");
    const results = runChecks();
    expect(results.some(r => r.name === "model_entry" && r.status === "fail" && r.message.includes("api_key"))).toBe(true);
  });
});
