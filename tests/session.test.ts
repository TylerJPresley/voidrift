import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatSession } from "../src/session.js";

describe("ChatSession", () => {
  const tmp = join(tmpdir(), `voidrift-test-session-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates new session", () => {
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.entryCount).toBe(0);
  });

  it("appends and restores messages", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "hello");
    s.append("assistant", "hi there");
    const s2 = ChatSession.loadOrCreate(tmp);
    const msgs = s2.restoreMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("hello");
    expect(msgs[1].content).toBe("hi there");
  });

  it("restores from compaction boundary", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "old message");
    s.append("assistant", "old response");
    s.appendCompaction("Summary of conversation");
    s.append("user", "new message");
    const s2 = ChatSession.loadOrCreate(tmp);
    const msgs = s2.restoreMessages();
    // Should have: compaction summary + new message
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain("Summary");
    expect(msgs[1].content).toBe("new message");
  });

  it("clear deletes session file", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "test");
    s.clear();
    expect(existsSync(join(tmp, "chat-session.jsonl"))).toBe(false);
    expect(s.entryCount).toBe(0);
  });

  it("searchEntries finds matches", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "auth endpoint question");
    s.append("assistant", "the auth endpoint is /api/login");
    s.append("user", "something else");
    const results = s.searchEntries("auth");
    expect(results.length).toBe(2);
    expect(results[0].content).toContain("auth");
  });

  it("searchEntries returns newest first", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "first match");
    s.append("user", "second match");
    const results = s.searchEntries("match");
    expect(results[0].content).toBe("second match");
  });

  it("searchEntries truncates long content", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "x".repeat(3000));
    const results = s.searchEntries("x");
    expect(results[0].content.length).toBeLessThanOrEqual(2020);
  });

  it("searchEntries respects limit", () => {
    const s = ChatSession.loadOrCreate(tmp);
    for (let i = 0; i < 10; i++) s.append("user", `match ${i}`);
    expect(s.searchEntries("match", 3)).toHaveLength(3);
  });
});
