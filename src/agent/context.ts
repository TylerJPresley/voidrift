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
  /** Estimated token count of the governance layer (system prompt). */
  governanceTokens?: number;
  logFn?: (msg: string) => void;
}

export class ContextCompactor {
  private _maxContext: number;
  private _compactPrompt: string;
  private _governanceTokens: number;
  private _logFn: (msg: string) => void;
  private _failCount = 0;
  private _disabled = false;
  private _nudgeSent = false;

  constructor(opts: CompactOpts) {
    this._maxContext = opts.maxContext;
    this._compactPrompt = opts.compactPrompt;
    this._governanceTokens = opts.governanceTokens ?? 0;
    this._logFn = opts.logFn ?? (() => {});
  }

  get disabled(): boolean { return this._disabled; }

  /** Work budget = maxContext minus governance layer tokens (REQ-CHAT-14). */
  get workBudget(): number {
    return this._maxContext - this._governanceTokens;
  }

  /** Update governance token count (e.g. after mode switch rebuilds governance). */
  setGovernanceTokens(tokens: number): void {
    this._governanceTokens = tokens;
  }

  /**
   * Check if auto-compact should trigger (80% work utilization).
   * promptTokens is the raw prompt_tokens from the API response (includes governance).
   * Work utilization = (promptTokens - governanceTokens) / workBudget (REQ-CHAT-14).
   */
  shouldAutoCompact(promptTokens: number): boolean {
    if (this._disabled) return false;
    const wb = this.workBudget;
    if (wb <= 0) return false;
    const workTokens = promptTokens - this._governanceTokens;
    return (workTokens / wb) >= 0.8;
  }

  /**
   * Check if a nudge should be shown (70% work utilization, one-time).
   * Uses work budget, not total context (REQ-CHAT-14).
   */
  shouldNudge(promptTokens: number): boolean {
    if (this._nudgeSent || this._disabled) return false;
    const wb = this.workBudget;
    if (wb <= 0) return false;
    const workTokens = promptTokens - this._governanceTokens;
    if ((workTokens / wb) >= 0.7) {
      this._nudgeSent = true;
      return true;
    }
    return false;
  }

  /**
   * Compact messages by summarizing via an API call.
   * Returns the new message list (system prompt + summary + recent).
   * The resulting work layer SHALL NOT exceed 10% of work budget (REQ-CHAT-14).
   * The governance layer (system prompt, messages[0]) is always preserved.
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

      let result = [systemMsg, { role: "assistant" as const, content: `[Conversation summary]\n${summary}` }, ...recent];

      // 10% ceiling check against work budget (REQ-CHAT-14)
      const ceiling = this.workBudget > 0 ? this.workBudget * 0.1 : this._maxContext * 0.1;
      if (ceiling > 0) {
        const historyChars = result.slice(1).reduce((n, m) => n + (m.content?.length ?? 0), 0);
        const estimatedTokens = historyChars / 4; // ~4 chars per token
        if (estimatedTokens > ceiling) {
          this._logFn(`[COMPACT_CEILING estimated=${Math.round(estimatedTokens)} ceiling=${Math.round(ceiling)}, dropping recent messages]`);
          result = [systemMsg, { role: "assistant" as const, content: `[Conversation summary]\n${summary}` }];
        }
      }

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