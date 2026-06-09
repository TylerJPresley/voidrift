import type { Message } from "./context.js";

const RECENT_TURNS_KEPT = 10;

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;
  preservedDiagnostics: string[];
  preservedParameters: string[];
}

/**
 * Conversational History Compactor (G-09).
 *
 * Fires when work partition exceeds 75% of context limit.
 * Keeps last 10 turns at full fidelity, compresses older turns using
 * a structured summarization template with protective metadata filters.
 */
export function compactHistory(
  messages: Message[],
  usedTokens: number,
  contextLimit: number
): CompactionResult {
  const threshold = contextLimit * 0.75;

  if (usedTokens <= threshold || messages.length <= RECENT_TURNS_KEPT) {
    return { messages, compacted: false, preservedDiagnostics: [], preservedParameters: [] };
  }

  const older = messages.slice(0, -RECENT_TURNS_KEPT);
  const recent = messages.slice(-RECENT_TURNS_KEPT);

  // Protective metadata filters — extract before summarization
  const preservedDiagnostics = extractDiagnostics(older);
  const preservedParameters = extractParameters(older);

  // Generate structured summary
  const summary = buildSummary(older, preservedDiagnostics, preservedParameters);

  const compactedMessages: Message[] = [
    { role: "assistant", content: summary },
    ...recent,
  ];

  return { messages: compactedMessages, compacted: true, preservedDiagnostics, preservedParameters };
}

/**
 * Generates the summarization prompt template for model-based compaction.
 * Can be sent to a flash-tier model for async background summarization.
 */
export function buildCompactionPrompt(serializedPastTurns: string): string {
  return `You are the VoidRift Conversational History Compactor.
Your job is to condense the provided older conversation history into a highly dense, bullet-point chronological summary, while explicitly preserving all structural metadata, errors, and critical commands.

### INSTRUCTIONS:
1. Maintain a chronological list of actions taken, decisions made, and files modified.
2. Identify and preserve all active, unresolved compiler/linter error messages and exceptions verbatim under the "UNRESOLVED DIAGNOSTICS" header.
3. Identify and preserve any crucial environment properties, tool credentials, or user-supplied instructions that govern the remaining tasks under the "ACTIVE PARAMETERS" header.
4. DO NOT write conversational filler. Keep the output extremely dense and formatted as markdown.

### PAST CONVERSATION TO SUMMARIZE:
${serializedPastTurns}

### OUTPUT FORMAT:
# Session Summary
- **Activity Log**:
  - [Bullet points of chronological engineering progress...]
- **Files Touched**:
  - [List of files and specific changes made...]
- **Unresolved Diagnostics**:
  - [Verbatim error snippets or "None" if all tests passed...]
- **Active Parameters**:
  - [Key environment parameters or instructions...]`;
}

function buildSummary(messages: Message[], diagnostics: string[], parameters: string[]): string {
  const bullets = messages.map((m) => {
    const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Tool";
    const truncated = m.content.length > 120 ? m.content.slice(0, 120) + "..." : m.content;
    return `• [${prefix}] ${truncated}`;
  });

  const parts = [
    `[HISTORICAL SESSION RECAP] (${messages.length} turns compacted)`,
    "",
    "**Activity Log:**",
    ...bullets,
  ];

  if (diagnostics.length) {
    parts.push("", "**Unresolved Diagnostics:**", ...diagnostics.map((d) => `  ${d}`));
  }
  if (parameters.length) {
    parts.push("", "**Active Parameters:**", ...parameters.map((p) => `  ${p}`));
  }

  return parts.join("\n");
}

/** Extracts unresolved error messages from history (protective filter). */
function extractDiagnostics(messages: Message[]): string[] {
  const diagnostics: string[] = [];
  for (const m of messages) {
    if (m.content.includes("Error:") || m.content.includes("error:") || m.content.includes("FAIL")) {
      const lines = m.content.split("\n").filter((l) => /error|fail|exception/i.test(l));
      diagnostics.push(...lines.slice(0, 5));
    }
  }
  return [...new Set(diagnostics)];
}

/** Extracts active tool hooks and environment parameters (protective filter). */
function extractParameters(messages: Message[]): string[] {
  const params: string[] = [];
  for (const m of messages) {
    if (m.role === "tool" || m.content.includes("env:") || m.content.includes("config:")) {
      const lines = m.content.split("\n").filter((l) => /env|config|key|token|url/i.test(l));
      params.push(...lines.slice(0, 3));
    }
  }
  return [...new Set(params)];
}
