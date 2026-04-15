import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatSession } from "../src/session.js";

describe("ChatSession", () => {
  const tmp = join(tmpdir(), `voidrift-test-session-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates new session with zero entries", () => {
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

  it("no session file returns empty messages", () => {
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.restoreMessages()).toEqual([]);
  });

  it("sanitizes empty content on restore", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "Hello");
    s.append("assistant", "");
    s.append("assistant", "   ");
    s.append("assistant", "Real reply");
    const s2 = ChatSession.loadOrCreate(tmp);
    const msgs = s2.restoreMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe("Real reply");
  });

  it("tracks entry count and lastTimestamp", () => {
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.entryCount).toBe(0);
    expect(s.lastTimestamp).toBeNull();
    s.append("user", "Hello");
    expect(s.entryCount).toBe(1);
    expect(s.lastTimestamp).not.toBeNull();
  });

  it("malformed JSONL lines are skipped on load", () => {
    const p = join(tmp, "chat-session.jsonl");
    const valid = JSON.stringify({
      id: "1", parentId: null, type: "message",
      timestamp: new Date().toISOString(), role: "user", content: "Hi",
    });
    writeFileSync(p, valid + "\nBAD LINE\n");
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.entryCount).toBe(1);
  });

  // --- Compaction boundary edge cases ---

  it("multiple compactions: only last boundary used", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "early msg");
    s.appendCompaction("First summary");
    s.append("user", "middle msg");
    s.appendCompaction("Second summary");
    s.append("user", "latest msg");
    const s2 = ChatSession.loadOrCreate(tmp);
    const msgs = s2.restoreMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain("Second summary");
    expect(msgs[1].content).toBe("latest msg");
  });

  it("compaction with no messages after returns only summary", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "old");
    s.appendCompaction("Summary only");
    const s2 = ChatSession.loadOrCreate(tmp);
    const msgs = s2.restoreMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Summary only");
  });

  // --- Gap marker ---

  it("shouldInjectGapMarker returns false for empty session", () => {
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.shouldInjectGapMarker()).toBe(false);
  });

  it("shouldInjectGapMarker returns false for recent message", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "just now");
    expect(s.shouldInjectGapMarker()).toBe(false);
  });

  it("shouldInjectGapMarker returns true after 30+ min gap", () => {
    const s = ChatSession.loadOrCreate(tmp);
    // Write an entry with old timestamp directly
    const oldTs = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
    const p = join(tmp, "chat-session.jsonl");
    const entry = JSON.stringify({
      id: "old", parentId: null, type: "message",
      timestamp: oldTs, role: "user", content: "old msg",
    });
    writeFileSync(p, entry + "\n");
    const s2 = ChatSession.loadOrCreate(tmp);
    expect(s2.shouldInjectGapMarker()).toBe(true);
  });
});

describe("searchEntries", () => {
  const tmp = join(tmpdir(), `voidrift-test-search-${Date.now()}`);

  beforeEach(() => mkdirSync(tmp, { recursive: true }));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("finds matching entries", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "auth endpoint question");
    s.append("assistant", "the auth endpoint is /api/login");
    s.append("user", "something else");
    const results = s.searchEntries("auth");
    expect(results.length).toBe(2);
    expect(results.every(r => r.content.toLowerCase().includes("auth"))).toBe(true);
  });

  it("case-insensitive search", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "Configure the DATABASE");
    const results = s.searchEntries("database");
    expect(results).toHaveLength(1);
  });

  it("returns newest first", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "first match");
    s.append("user", "second match");
    s.append("user", "third match");
    const results = s.searchEntries("match");
    expect(results[0].content).toBe("third match");
    expect(results[2].content).toBe("first match");
  });

  it("no matches returns empty", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "Hello world");
    expect(s.searchEntries("nonexistent")).toEqual([]);
  });

  it("empty session returns empty", () => {
    const s = ChatSession.loadOrCreate(tmp);
    expect(s.searchEntries("anything")).toEqual([]);
  });

  it("truncates content at 2000 chars", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "x".repeat(5000));
    const results = s.searchEntries("x");
    expect(results).toHaveLength(1);
    expect(results[0].content.length).toBeLessThan(5000);
    expect(results[0].content).toContain("... [truncated]");
  });

  it("respects limit parameter", () => {
    const s = ChatSession.loadOrCreate(tmp);
    for (let i = 0; i < 10; i++) s.append("user", `match ${i}`);
    expect(s.searchEntries("match", 3)).toHaveLength(3);
  });

  it("caps limit at 10", () => {
    const s = ChatSession.loadOrCreate(tmp);
    for (let i = 0; i < 15; i++) s.append("user", `entry ${i}`);
    expect(s.searchEntries("entry", 99)).toHaveLength(10);
  });

  it("searches entries before compaction boundary", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "early decision about auth");
    s.append("assistant", "noted the auth approach");
    s.appendCompaction("Summary: discussed auth");
    s.append("user", "new topic");
    // "auth approach" only in pre-compaction assistant message
    const results = s.searchEntries("auth approach");
    expect(results.length).toBe(1);
    expect(results[0].role).toBe("assistant");
  });

  it("results include timestamp and role", () => {
    const s = ChatSession.loadOrCreate(tmp);
    s.append("user", "test message");
    const results = s.searchEntries("test");
    expect(results[0]).toHaveProperty("timestamp");
    expect(results[0]).toHaveProperty("role");
    expect(results[0]).toHaveProperty("content");
    expect(results[0].role).toBe("user");
  });
});
