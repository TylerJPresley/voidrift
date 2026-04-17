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
