/**
 * Context management: snip old tool results, reactive compaction (REQ-ARCH-12, REQ-ARCH-15).
 */

import type { Message } from "./types.js";

const SNIP_MIN_CHARS = 500;
const SNIP_READ_TOOLS = new Set(["file"]);

export function snipOldToolResults(messages: Message[], maxAgeTurns = 2): Message[] {
  if (maxAgeTurns === 0) return [...messages];

  // Count assistant messages after each tool result
  const assistantIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant") assistantIndices.push(i);
  }

  return messages.map((m, i) => {
    if (m.role !== "tool") return m;
    if (!m.content || m.content.length <= SNIP_MIN_CHARS) return m;

    // Check if this is a read tool result
    const name = m.name ?? "";
    if (!SNIP_READ_TOOLS.has(name)) return m;

    // For domain 'file' tool, only snip read actions
    if (name === "file") {
      // Try to find the corresponding tool call to check action
      // Look backwards for the assistant message with matching tool_call_id
      let isRead = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.role === "assistant" && prev.tool_calls) {
          const tc = prev.tool_calls.find(c => c.id === m.tool_call_id);
          if (tc) {
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              isRead = args.action === "read";
            } catch { /* */ }
            break;
          }
        }
      }
      if (!isRead) return m;
    }

    // Count assistant messages after this position
    const assistantsAfter = assistantIndices.filter(idx => idx > i).length;
    if (assistantsAfter < maxAgeTurns) return m;

    const lineCount = m.content.split("\n").length;
    return {
      ...m,
      content: `[snipped — ${lineCount} lines, use file(action="read") to re-read]`,
    };
  });
}

export function trimMessages(messages: Message[]): Message[] {
  return messages.filter(m => {
    if (!m.content && !m.tool_calls?.length && m.role !== "tool") return false;
    if (m.role === "tool" && (!m.content || !m.content.trim())) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// ContextCompactor (REQ-U-7, REQ-U-10, REQ-U-11)
// ---------------------------------------------------------------------------

export interface CompactOpts {
  maxContext: number;
  compactPrompt: string;
  logFn?: (msg: string) => void;
}

export class ContextCompactor {
  private _maxContext: number;
  private _compactPrompt: string;
  private _logFn: (msg: string) => void;
  private _failCount = 0;
  private _disabled = false;
  private _nudgeSent = false;

  constructor(opts: CompactOpts) {
    this._maxContext = opts.maxContext;
    this._compactPrompt = opts.compactPrompt;
    this._logFn = opts.logFn ?? (() => {});
  }

  get disabled(): boolean { return this._disabled; }

  /** Check if auto-compact should trigger (80% utilization). */
  shouldAutoCompact(promptTokens: number): boolean {
    if (this._disabled || !this._maxContext) return false;
    return (promptTokens / this._maxContext) >= 0.8;
  }

  /** Check if a nudge should be shown (70% utilization, one-time). */
  shouldNudge(promptTokens: number): boolean {
    if (this._nudgeSent || this._disabled || !this._maxContext) return false;
    if ((promptTokens / this._maxContext) >= 0.7) {
      this._nudgeSent = true;
      return true;
    }
    return false;
  }

  /**
   * Compact messages by summarizing via an API call.
   * Returns the new message list (system prompt + summary + recent).
   */
  async compact(
    messages: Message[],
    callFn: (msgs: Message[], maxTokens: number) => Promise<string>,
  ): Promise<Message[]> {
    if (messages.length <= 2) return messages; // system + 1 msg = nothing to compact

    const systemMsg = messages[0];
    const recent = messages.slice(-4); // Keep last 4 messages
    const toSummarize = messages.slice(1, -4);
    if (!toSummarize.length) return messages;

    try {
      const summaryPrompt = this._compactPrompt + "\n\nConversation to summarize:\n" +
        toSummarize.map(m => `[${m.role}]: ${(m.content ?? "").slice(0, 500)}`).join("\n");
      const summary = await callFn(
        [{ role: "system", content: "Summarize the conversation concisely." }, { role: "user", content: summaryPrompt }],
        1024,
      );

      const result = [systemMsg, { role: "assistant" as const, content: `[Conversation summary]\n${summary}` }, ...recent];

      // Check if result is within 10% of context
      this._failCount = 0;
      this._logFn(`[COMPACT freed=${toSummarize.length} messages]`);
      return result;
    } catch (e) {
      this._failCount++;
      this._logFn(`[COMPACT_FAIL attempt=${this._failCount} error=${e}]`);
      if (this._failCount >= 3) {
        this._disabled = true;
        this._logFn("[COMPACT_DISABLED] 3 consecutive failures — auto-compact disabled");
      }
      return messages;
    }
  }

  /** Build restoration message after compact (REQ-U-11). */
  buildRestoration(recentFiles: string[], skills: string[], maxBytes: number): string | null {
    const parts: string[] = [];
    let size = 0;
    // Add skills first
    for (const s of skills) {
      const bytes = Buffer.byteLength(s, "utf-8");
      if (size + bytes > maxBytes) break;
      parts.push(s);
      size += bytes;
    }
    // Add recent files (newest first)
    for (const f of recentFiles.slice(0, 3)) {
      try {
        const { readFileSync } = require("node:fs");
        const content = readFileSync(f, "utf-8");
        const bytes = Buffer.byteLength(content, "utf-8");
        if (size + bytes > maxBytes) continue;
        parts.push(`## File: ${f}\n\`\`\`\n${content}\n\`\`\``);
        size += bytes;
      } catch { /* skip unreadable files */ }
    }
    return parts.length ? parts.join("\n\n") : null;
  }
}