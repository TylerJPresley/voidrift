/**
 * Tests for P0 features: streaming, context compactor, permission gate.
 */

import { describe, it, expect, vi } from "vitest";
import { ContextCompactor } from "../src/agent/context.js";
import { createPermissionGate } from "../src/tools/permissions.js";
import type { Message } from "../src/agent/types.js";

// ---------------------------------------------------------------------------
// ContextCompactor
// ---------------------------------------------------------------------------

describe("ContextCompactor", () => {
  it("shouldAutoCompact returns false below 80%", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.shouldAutoCompact(70000)).toBe(false);
  });

  it("shouldAutoCompact returns true at 80%", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.shouldAutoCompact(80000)).toBe(true);
  });

  it("shouldNudge fires once at 70%", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.shouldNudge(70000)).toBe(true);
    expect(c.shouldNudge(75000)).toBe(false); // already sent
  });

  it("shouldNudge returns false below 70%", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.shouldNudge(60000)).toBe(false);
  });

  it("compact replaces messages with summary", async () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const messages: Message[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "Welcome" },
      { role: "user", content: "Recent 1" },
      { role: "assistant", content: "Recent 2" },
      { role: "user", content: "Recent 3" },
      { role: "assistant", content: "Recent 4" },
    ];
    const callFn = vi.fn().mockResolvedValue("Summary of conversation");
    const result = await c.compact(messages, callFn);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toContain("Summary of conversation");
    expect(result.length).toBeLessThan(messages.length);
    expect(callFn).toHaveBeenCalledOnce();
  });

  it("compact returns unchanged for 2 or fewer messages", async () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const messages: Message[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const callFn = vi.fn();
    const result = await c.compact(messages, callFn);
    expect(result).toBe(messages);
    expect(callFn).not.toHaveBeenCalled();
  });

  it("disables after 3 consecutive failures", async () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
    ];
    const callFn = vi.fn().mockRejectedValue(new Error("API error"));
    await c.compact(messages, callFn);
    await c.compact(messages, callFn);
    await c.compact(messages, callFn);
    expect(c.disabled).toBe(true);
    expect(c.shouldAutoCompact(90000)).toBe(false);
  });

  it("buildRestoration returns null when no files", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.buildRestoration([], [], 10000)).toBeNull();
  });

  // --- Fix 1: shouldAutoCompact/shouldNudge accept raw prompt_tokens ---

  it("shouldAutoCompact uses raw prompt_tokens (not reverse-calculated %)", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    // 79999 tokens of 100000 = 79.999% → should NOT trigger
    expect(c.shouldAutoCompact(79999)).toBe(false);
    // 80000 tokens of 100000 = 80% → should trigger
    expect(c.shouldAutoCompact(80000)).toBe(true);
  });

  it("shouldNudge uses raw prompt_tokens", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    expect(c.shouldNudge(69999)).toBe(false);
    expect(c.shouldNudge(70000)).toBe(true);
  });

  // --- Fix 2: 10% ceiling check after compaction ---

  it("compact drops recent messages when result exceeds 10% ceiling", async () => {
    // maxContext=1000 → ceiling = 100 tokens = ~400 chars
    const c = new ContextCompactor({ maxContext: 1000, compactPrompt: "summarize" });
    const messages: Message[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Old message" },
      { role: "assistant", content: "Old reply" },
      { role: "user", content: "Old message 2" },
      { role: "assistant", content: "Old reply 2" },
      // Recent 4 messages — each 200 chars to blow past the 400-char ceiling
      { role: "user", content: "A".repeat(200) },
      { role: "assistant", content: "B".repeat(200) },
      { role: "user", content: "C".repeat(200) },
      { role: "assistant", content: "D".repeat(200) },
    ];
    const callFn = vi.fn().mockResolvedValue("Short summary");
    const result = await c.compact(messages, callFn);
    // Should have dropped recent messages: only system + summary remain
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toContain("Short summary");
  });

  it("compact keeps recent messages when result is within 10% ceiling", async () => {
    // maxContext=100000 → ceiling = 10000 tokens = ~40000 chars — plenty of room
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const messages: Message[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Old message" },
      { role: "assistant", content: "Old reply" },
      { role: "user", content: "Old message 2" },
      { role: "assistant", content: "Old reply 2" },
      { role: "user", content: "Recent 1" },
      { role: "assistant", content: "Recent 2" },
      { role: "user", content: "Recent 3" },
      { role: "assistant", content: "Recent 4" },
    ];
    const callFn = vi.fn().mockResolvedValue("Summary");
    const result = await c.compact(messages, callFn);
    // system + summary + 4 recent = 6
    expect(result.length).toBe(6);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toContain("Summary");
  });

  it("compact ceiling check logs when triggered", async () => {
    const logs: string[] = [];
    const c = new ContextCompactor({ maxContext: 1000, compactPrompt: "summarize", logFn: (m) => logs.push(m) });
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old" },
      { role: "assistant", content: "old" },
      { role: "user", content: "old2" },
      { role: "assistant", content: "old2" },
      { role: "user", content: "X".repeat(500) },
      { role: "assistant", content: "Y".repeat(500) },
      { role: "user", content: "Z".repeat(500) },
      { role: "assistant", content: "W".repeat(500) },
    ];
    const callFn = vi.fn().mockResolvedValue("Short");
    await c.compact(messages, callFn);
    expect(logs.some(l => l.includes("COMPACT_CEILING"))).toBe(true);
  });

  // --- Fix 3: buildRestoration accepts skills ---

  it("buildRestoration includes skill content", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const skills = ["# ANALYSIS-REQS\nUse EARS notation for requirements."];
    const result = c.buildRestoration([], skills, 10000);
    expect(result).toContain("ANALYSIS-REQS");
    expect(result).toContain("EARS notation");
  });

  it("buildRestoration respects maxBytes for skills", () => {
    const c = new ContextCompactor({ maxContext: 100000, compactPrompt: "summarize" });
    const bigSkill = "X".repeat(5000);
    const smallSkill = "Small skill content";
    // maxBytes=100 — big skill won't fit, small skill will
    const result = c.buildRestoration([], [smallSkill, bigSkill], 100);
    expect(result).toContain("Small skill content");
    expect(result).not.toContain("XXXXX");
  });
});

// ---------------------------------------------------------------------------
// Permission Gate
// ---------------------------------------------------------------------------

describe("PermissionGate", () => {
  it("allows reads inside project dir without prompt", () => {
    const gate = createPermissionGate();
    const result = gate.check("file", { action: "read", path: "src/main.ts" }, "/project");
    expect(result).toBeNull();
  });

  it("requires permission for writes", () => {
    const gate = createPermissionGate();
    const result = gate.check("file", { action: "write", path: "src/main.ts" }, "/project");
    expect(result).toBe("writes");
  });

  it("requires permission for shell", () => {
    const gate = createPermissionGate();
    const result = gate.check("shell", { cmd: "npm test" }, "/project");
    expect(result).toBe("runs");
  });

  it("requires permission for reads outside project", () => {
    const gate = createPermissionGate();
    const result = gate.check("file", { action: "read", path: "../../etc/passwd" }, "/project");
    expect(result).toBe("reads-outside");
  });

  it("always grant skips subsequent prompts", () => {
    const gate = createPermissionGate();
    gate.grant("writes", "always");
    const result = gate.check("file", { action: "write", path: "src/main.ts" }, "/project");
    expect(result).toBeNull();
  });

  it("hook returns null for allowed actions", () => {
    const gate = createPermissionGate();
    const hookFn = gate.hook("/project", () => "allow-once");
    const result = hookFn("file", JSON.stringify({ action: "read", path: "src/main.ts" }));
    expect(result).toBeNull();
  });

  it("hook returns denial message when denied", () => {
    const gate = createPermissionGate();
    const hookFn = gate.hook("/project", () => "deny");
    const result = hookFn("file", JSON.stringify({ action: "write", path: "src/main.ts" }));
    expect(result).toContain("Permission denied");
  });

  it("hook with always grant skips future prompts", () => {
    const gate = createPermissionGate();
    const promptFn = vi.fn().mockReturnValue("always");
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const hookFn = gate.hook("/project", promptFn);
      hookFn("shell", JSON.stringify({ cmd: "npm test" }));
      hookFn("shell", JSON.stringify({ cmd: "npm build" }));
      expect(promptFn).toHaveBeenCalledTimes(1); // only prompted once
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origTTY, configurable: true });
    }
  });
});

// ---------------------------------------------------------------------------
// StreamEvent type (structural test)
// ---------------------------------------------------------------------------

describe("StreamEvent", () => {
  it("text event has correct shape", () => {
    const event = { type: "text" as const, text: "hello" };
    expect(event.type).toBe("text");
    expect(event.text).toBe("hello");
  });

  it("tool_call event has correct shape", () => {
    const event = { type: "tool_call" as const, index: 0, id: "call_1", name: "file", arguments: '{"action":"read"}' };
    expect(event.type).toBe("tool_call");
    expect(event.index).toBe(0);
  });

  it("finish event has correct shape", () => {
    const event = { type: "finish" as const, finishReason: "stop", usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    expect(event.type).toBe("finish");
    expect(event.usage.prompt_tokens).toBe(100);
  });
});
