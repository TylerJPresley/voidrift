/**
 * Tests for verify tools: process management and HTTP client.
 */

import { describe, it, expect, afterEach } from "vitest";
import { startProcess, readProcessOutput, stopProcess, stopAll } from "../../src/tools/process.js";

describe("Process management", () => {
  afterEach(() => stopAll());

  it("startProcess returns a handle_id", () => {
    const result = JSON.parse(startProcess("echo hello"));
    expect(result.handle_id).toBeDefined();
    expect(typeof result.handle_id).toBe("string");
  });

  it("readProcessOutput returns stdout after process completes", async () => {
    const { handle_id } = JSON.parse(startProcess("echo hello && sleep 0.1"));
    // Wait for process to produce output
    await new Promise(r => setTimeout(r, 300));
    const output = JSON.parse(readProcessOutput(handle_id));
    expect(output.stdout).toContain("hello");
  });

  it("readProcessOutput returns error for unknown handle", () => {
    const output = JSON.parse(readProcessOutput("nonexistent"));
    expect(output.error).toContain("No process");
  });

  it("stopProcess kills a running process", async () => {
    const { handle_id } = JSON.parse(startProcess("sleep 60"));
    await new Promise(r => setTimeout(r, 100));
    const result = JSON.parse(stopProcess(handle_id));
    expect(result.stopped).toBe(handle_id);
  });

  it("stopAll clears all processes", () => {
    JSON.parse(startProcess("sleep 60"));
    JSON.parse(startProcess("sleep 60"));
    stopAll();
    // No error means success
  });

  it("readProcessOutput shows exited status after process ends", async () => {
    const { handle_id } = JSON.parse(startProcess("echo done"));
    await new Promise(r => setTimeout(r, 300));
    const output = JSON.parse(readProcessOutput(handle_id));
    expect(output.exited).toBe(true);
    expect(output.exit_code).toBe(0);
  });
});
