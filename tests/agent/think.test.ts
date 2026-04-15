import { describe, it, expect } from "vitest";
import { stripThinkTags, ThinkTagBuffer } from "../../src/agent/think.js";

describe("stripThinkTags", () => {
  it("removes <think>...</think> blocks", () => {
    expect(stripThinkTags("<think>reasoning</think>Hello")).toBe("Hello");
  });

  it("returns unchanged text without think tags", () => {
    expect(stripThinkTags("Hello world")).toBe("Hello world");
  });

  it("handles orphaned </think>", () => {
    expect(stripThinkTags("reasoning</think>Hello")).toBe("Hello");
  });

  it("logs thinking content", () => {
    const logs: string[] = [];
    stripThinkTags("<think>deep thought</think>Result", (m) => logs.push(m));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("deep thought");
  });

  it("handles multiple think blocks", () => {
    const result = stripThinkTags("<think>a</think>Hello<think>b</think> world");
    expect(result).toBe("Hello world");
  });
});

describe("ThinkTagBuffer", () => {
  it("passes through normal text", () => {
    const buf = new ThinkTagBuffer();
    expect(buf.push("hello")).toBe("");
    expect(buf.flush()).toBe("hello");
  });

  it("strips think blocks in streaming", () => {
    const buf = new ThinkTagBuffer();
    let out = "";
    out += buf.push("<think>reason");
    out += buf.push("ing</think>Hello");
    out += buf.flush();
    expect(out).toBe("Hello");
  });

  it("flushes buffer after 200 chars without think tag", () => {
    const buf = new ThinkTagBuffer();
    const long = "x".repeat(250);
    const out = buf.push(long);
    expect(out.length).toBeGreaterThan(200);
  });
});
