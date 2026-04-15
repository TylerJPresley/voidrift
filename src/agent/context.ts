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
