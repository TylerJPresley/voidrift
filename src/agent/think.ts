/**
 * Think-tag stripping (REQ-ARCH-8).
 *
 * Removes <think>...</think> blocks from model responses.
 * Handles orphaned </think> (no opening tag).
 */

export function stripThinkTags(text: string, logFn?: (msg: string) => void): string {
  if (!text.includes("</think>") && !text.includes("<think>")) return text;

  // Handle orphaned </think> — content before it is thinking
  if (!text.includes("<think>") && text.includes("</think>")) {
    const idx = text.indexOf("</think>");
    const thinking = text.slice(0, idx);
    if (thinking.trim() && logFn) logFn(`[THINKING] ${thinking.trim()}`);
    return text.slice(idx + "</think>".length).trimStart();
  }

  // Handle <think>...</think> blocks
  let result = text;
  const re = /<think>([\s\S]*?)<\/think>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(result)) !== null) {
    const thinking = match[1];
    if (thinking.trim() && logFn) logFn(`[THINKING] ${thinking.trim()}`);
  }
  result = result.replace(re, "");
  return result.trimStart();
}

/**
 * Streaming think-tag buffer.
 * Buffers up to 200 chars waiting for </think>. Flushes as real content if threshold passed.
 */
export class ThinkTagBuffer {
  private _buffer = "";
  private _inThink = false;
  private _thinkContent = "";
  private _logFn?: (msg: string) => void;

  constructor(logFn?: (msg: string) => void) {
    this._logFn = logFn;
  }

  push(token: string): string {
    let output = "";

    for (const ch of token) {
      if (this._inThink) {
        this._thinkContent += ch;
        if (this._thinkContent.endsWith("</think>")) {
          const thinking = this._thinkContent.slice(0, -"</think>".length);
          if (thinking.trim() && this._logFn) this._logFn(`[THINKING] ${thinking.trim()}`);
          this._inThink = false;
          this._thinkContent = "";
        }
        continue;
      }

      this._buffer += ch;

      // Check for <think> start
      if (this._buffer.endsWith("<think>")) {
        output += this._buffer.slice(0, -"<think>".length);
        this._buffer = "";
        this._inThink = true;
        this._thinkContent = "";
        continue;
      }

      // Check for orphaned </think>
      if (this._buffer.endsWith("</think>")) {
        const thinking = this._buffer.slice(0, -"</think>".length);
        if (thinking.trim() && this._logFn) this._logFn(`[THINKING] ${thinking.trim()}`);
        this._buffer = "";
        continue;
      }

      // Flush buffer if over 200 chars and no think tag detected
      if (this._buffer.length > 200 && !this._buffer.includes("<")) {
        output += this._buffer;
        this._buffer = "";
      }
    }

    return output;
  }

  flush(): string {
    const out = this._buffer;
    this._buffer = "";
    if (this._inThink && this._thinkContent.trim() && this._logFn) {
      this._logFn(`[THINKING] ${this._thinkContent.trim()}`);
    }
    this._inThink = false;
    this._thinkContent = "";
    return out;
  }
}
