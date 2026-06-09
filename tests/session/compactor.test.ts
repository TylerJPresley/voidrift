import { describe, it, expect } from "vitest";
import { compactHistory, buildCompactionPrompt } from "../../src/session/compactor.js";
import type { Message } from "../../src/session/context.js";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Message ${i}: ${"x".repeat(50)}`,
  }));
}

describe("History Compactor (G-09)", () => {
  it("does not compact when under 75% threshold", () => {
    const msgs = makeMessages(20);
    const result = compactHistory(msgs, 5000, 100000);
    expect(result.compacted).toBe(false);
    expect(result.messages).toHaveLength(20);
  });

  it("does not compact when messages <= 10", () => {
    const msgs = makeMessages(8);
    const result = compactHistory(msgs, 80000, 100000);
    expect(result.compacted).toBe(false);
  });

  it("compacts when over 75% and more than 10 messages", () => {
    const msgs = makeMessages(25);
    const result = compactHistory(msgs, 80000, 100000);
    expect(result.compacted).toBe(true);
    expect(result.messages).toHaveLength(11); // 1 summary + 10 recent
  });

  it("summary contains HISTORICAL SESSION RECAP header", () => {
    const msgs = makeMessages(25);
    const result = compactHistory(msgs, 80000, 100000);
    expect(result.messages[0].content).toContain("HISTORICAL SESSION RECAP");
    expect(result.messages[0].content).toContain("15 turns compacted");
  });

  it("preserves last 10 messages intact", () => {
    const msgs = makeMessages(25);
    const result = compactHistory(msgs, 80000, 100000);
    const recent = result.messages.slice(1);
    expect(recent[0].content).toBe(msgs[15].content);
    expect(recent[9].content).toBe(msgs[24].content);
  });

  it("extracts unresolved diagnostics from older messages", () => {
    const msgs: Message[] = [
      ...makeMessages(15),
      { role: "tool", content: "Error: Cannot find module 'foo'\nFAIL src/test.ts" },
      ...makeMessages(10),
    ];
    const result = compactHistory(msgs, 80000, 100000);
    expect(result.preservedDiagnostics.length).toBeGreaterThan(0);
    expect(result.messages[0].content).toContain("Unresolved Diagnostics");
  });

  it("extracts active parameters from tool messages", () => {
    const msgs: Message[] = [
      ...makeMessages(15),
      { role: "tool", content: "env: DATABASE_URL=postgres://localhost\nconfig: port=3000" },
      ...makeMessages(10),
    ];
    const result = compactHistory(msgs, 80000, 100000);
    expect(result.preservedParameters.length).toBeGreaterThan(0);
    expect(result.messages[0].content).toContain("Active Parameters");
  });

  it("buildCompactionPrompt generates valid template", () => {
    const prompt = buildCompactionPrompt("User: hello\nAssistant: hi");
    expect(prompt).toContain("VoidRift Conversational History Compactor");
    expect(prompt).toContain("User: hello");
    expect(prompt).toContain("UNRESOLVED DIAGNOSTICS");
    expect(prompt).toContain("ACTIVE PARAMETERS");
  });
});
