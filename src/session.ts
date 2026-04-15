/**
 * Chat session persistence (REQ-U-13). Append-only JSONL.
 */

import { readFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Message } from "./agent/types.js";

const SESSION_GAP_THRESHOLD = 1800; // 30 minutes in seconds

export interface SessionEntry {
  id: string;
  parentId: string | null;
  type: "message" | "compaction" | "summary";
  timestamp: string;
  role?: string;
  content?: string;
}

export interface SearchResult {
  timestamp: string;
  role: string;
  content: string;
}

export class ChatSession {
  private _path: string;
  private _entries: SessionEntry[] = [];

  constructor(path: string) {
    this._path = path;
  }

  static loadOrCreate(dir: string): ChatSession {
    const path = join(dir, "chat-session.jsonl");
    const session = new ChatSession(path);
    if (existsSync(path)) session._load();
    return session;
  }

  private _load(): void {
    const lines = readFileSync(this._path, "utf-8").trim().split("\n").filter(Boolean);
    this._entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  append(role: string, content: string, parentId?: string): void {
    const entry: SessionEntry = {
      id: randomUUID(),
      parentId: parentId ?? null,
      type: "message",
      timestamp: new Date().toISOString(),
      role,
      content,
    };
    this._entries.push(entry);
    appendFileSync(this._path, JSON.stringify(entry) + "\n");
  }

  appendCompaction(summary: string): void {
    const entry: SessionEntry = {
      id: randomUUID(),
      parentId: null,
      type: "compaction",
      timestamp: new Date().toISOString(),
      content: summary,
    };
    this._entries.push(entry);
    appendFileSync(this._path, JSON.stringify(entry) + "\n");
  }

  clear(): void {
    this._entries = [];
    if (existsSync(this._path)) unlinkSync(this._path);
  }

  /**
   * Restore messages from the last compaction boundary forward.
   * Sanitizes: strips empty content and orphaned tool calls.
   */
  restoreMessages(): Message[] {
    let startIdx = 0;
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (this._entries[i].type === "compaction") {
        startIdx = i;
        break;
      }
    }

    const messages: Message[] = [];
    for (let i = startIdx; i < this._entries.length; i++) {
      const e = this._entries[i];
      if (e.type === "compaction") {
        messages.push({ role: "assistant", content: `[Conversation summary]\n${e.content}` });
        continue;
      }
      if (!e.role || !e.content?.trim()) continue;
      messages.push({ role: e.role as Message["role"], content: e.content });
    }
    return messages;
  }

  /**
   * Check if a session gap marker should be injected (REQ-U-23).
   */
  shouldInjectGapMarker(): boolean {
    if (!this._entries.length) return false;
    const last = this._entries[this._entries.length - 1];
    const elapsed = (Date.now() - new Date(last.timestamp).getTime()) / 1000;
    return elapsed > SESSION_GAP_THRESHOLD;
  }

  get lastTimestamp(): string | null {
    return this._entries.length ? this._entries[this._entries.length - 1].timestamp : null;
  }

  get entryCount(): number { return this._entries.length; }

  /**
   * Search all entries by case-insensitive substring (REQ-U-18).
   */
  searchEntries(query: string, limit = 5): SearchResult[] {
    const q = query.toLowerCase();
    const maxLimit = Math.min(limit, 10);
    const matches: SearchResult[] = [];

    // Search all entries (including pre-compaction)
    for (let i = this._entries.length - 1; i >= 0 && matches.length < maxLimit; i--) {
      const e = this._entries[i];
      if (!e.content) continue;
      if (e.content.toLowerCase().includes(q)) {
        let content = e.content;
        if (content.length > 2000) content = content.slice(0, 2000) + "... [truncated]";
        matches.push({ timestamp: e.timestamp, role: e.role ?? e.type, content });
      }
    }
    return matches;
  }
}
