import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createTierAdapter } from "../adapters/factory.js";
import { getModelCache } from "../adapters/cache.js";
import type { VoidRiftConfig } from "../config/loader.js";
import { summarizeFile } from "../codemap/index.js";

const SUMMARIZE_PROMPT = `You are a file indexer. Summarize this file's structure, purpose, and key content concisely. Include:
- What the file does (1-2 sentences)
- Key sections with line ranges (e.g., "L10-45: Database connection setup")
- Important exports, functions, classes, or config values
- Any critical details a developer would need to know

Keep it under 300 words. Use line references so the developer can read_file with offset to access specific sections.`;

/**
 * Summarizes a file using the Flash tier model.
 * Falls back to regex-based structural summary if the Flash call fails.
 */
export async function summarizeFileWithFlash(
  path: string,
  content: string,
  config: VoidRiftConfig
): Promise<{ summary: string; totalLines: number }> {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Small files: pin in full
  if (totalLines <= (config.summarizeThreshold ?? 500)) {
    return { summary: content, totalLines };
  }

  try {
    const resolved = createTierAdapter("utility", config);
    resolved.client.cache = getModelCache();
    const messages = [
      new SystemMessage(SUMMARIZE_PROMPT),
      new HumanMessage(`File: ${path} (${totalLines} lines)\n\n${content}`),
    ];
    const response = await resolved.client.invoke(messages);
    const summary = typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
        : "";

    if (summary.length > 0) {
      return { summary: `[${path}] ${totalLines} lines (Flash summary)\n${summary}\n  Use read_file("${path}", offset, limit) to read specific sections.`, totalLines };
    }
  } catch {
    // Flash unavailable — fall back to structural summary
  }

  return summarizeFile(path, content);
}
