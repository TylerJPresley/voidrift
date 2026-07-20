import { describe, it, expect } from "vitest";
import { checkGuardrails, createGuardrailContext } from "../../src/orchestration/guardrails.js";
import { createLoopDetection } from "../../src/orchestration/loop-detection.js";
import { parseDelay } from "../../src/orchestration/scheduler.js";

describe("guardrails", () => {
  it("blocks edit_file without prior read", () => {
    const ctx = createGuardrailContext("/test", "0");
    const result = checkGuardrails("edit_file", { path: "src/main.ts", search: "x", replace: "y" }, ctx);
    expect(result.block).toBe(true);
    expect(result.preWarning).toContain("read_file");
  });

  it("allows edit_file after read", () => {
    const ctx = createGuardrailContext("/test", "0");
    ctx.filesRead.add("src/main.ts");
    const result = checkGuardrails("edit_file", { path: "src/main.ts", search: "x", replace: "y" }, ctx);
    expect(result.block).toBeFalsy();
  });

  it("blocks write_file to /tmp", () => {
    const ctx = createGuardrailContext("/test", "session1");
    const result = checkGuardrails("write_file", { path: "/tmp/evil.sh", content: "rm -rf /" }, ctx);
    expect(result.block).toBe(true);
    expect(result.preWarning).toContain("/tmp");
  });

  it("allows write_file to workspace paths", () => {
    const ctx = createGuardrailContext("/test", "0");
    const result = checkGuardrails("write_file", { path: "src/new-file.ts", content: "export {}" }, ctx);
    expect(result.block).toBeFalsy();
  });

  it("blocks edit_file with search > 50 lines", () => {
    const ctx = createGuardrailContext("/test", "0");
    ctx.filesRead.add("big.ts");
    const bigSearch = Array(60).fill("line").join("\n");
    const result = checkGuardrails("edit_file", { path: "big.ts", search: bigSearch, replace: "new" }, ctx);
    expect(result.block).toBe(true);
    expect(result.preWarning).toContain("full rewrite");
  });

  it("does not warn on write_file with > 50 lines (generator guidance removed)", () => {
    const ctx = createGuardrailContext("/test", "0");
    const bigContent = Array(60).fill("line").join("\n");
    const result = checkGuardrails("write_file", { path: "file.ts", content: bigContent }, ctx);
    expect(result.block).toBeFalsy();
    expect(result.preWarning).toBeUndefined();
  });

  it("warns on /tmp in execute_command", () => {
    const ctx = createGuardrailContext("/test", "session1");
    const result = checkGuardrails("execute_command", { command: "cp file.txt /tmp/backup" }, ctx);
    expect(result.block).toBeFalsy();
    expect(result.preWarning).toContain("/tmp");
  });

  it("warns on repetitive tool pattern (>4 same tool)", () => {
    const ctx = createGuardrailContext("/test", "0");
    ctx.round = 6;
    for (let i = 0; i < 5; i++) ctx.callHistory.push({ name: "write_file", args: {} });
    const result = checkGuardrails("write_file", { path: "x.ts", content: "" }, ctx);
    expect(result.postWarning).toContain("Repetitive");
  });
});

describe("loop-detection", () => {
  it("allows first few calls", () => {
    const state = createLoopDetection();
    expect(state.consecutiveErrors).toBe(0);
  });

  it("tracks consecutive errors", () => {
    const state = createLoopDetection();
    state.consecutiveErrors = 2;
    state.consecutiveErrors++;
    expect(state.consecutiveErrors).toBe(3);
    expect(state.consecutiveErrors >= state.maxConsecutiveErrors).toBe(true);
  });

  it("tracks per-tool failures", () => {
    const state = createLoopDetection();
    state.toolFailures.set("edit_file", 3);
    state.toolFailures.set("edit_file", (state.toolFailures.get("edit_file") || 0) + 1);
    expect(state.toolFailures.get("edit_file")).toBe(4);
    expect((state.toolFailures.get("edit_file") || 0) >= state.maxToolFailures).toBe(true);
  });

  it("detects fingerprint doom loop", () => {
    const state = createLoopDetection();
    const fp = "edit_file:{\"path\":\"x.ts\"}";
    for (let i = 0; i < 3; i++) state.fingerprints.push(fp);
    const count = state.fingerprints.filter(f => f === fp).length;
    expect(count >= state.fingerprintThreshold).toBe(true);
  });

  it("sliding window limits fingerprint history", () => {
    const state = createLoopDetection();
    for (let i = 0; i < 25; i++) {
      state.fingerprints.push(`tool-${i}`);
      if (state.fingerprints.length > state.fingerprintWindow) state.fingerprints.shift();
    }
    expect(state.fingerprints.length).toBeLessThanOrEqual(state.fingerprintWindow);
  });
});

describe("scheduler — parseDelay", () => {
  it("parses seconds", () => expect(parseDelay("30s")).toBe(30000));
  it("parses minutes", () => expect(parseDelay("5m")).toBe(300000));
  it("parses hours", () => expect(parseDelay("2h")).toBe(7200000));
  it("defaults to 1m on invalid", () => expect(parseDelay("invalid")).toBe(60000));
});
