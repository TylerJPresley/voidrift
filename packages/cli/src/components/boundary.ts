/**
 * Find the last safe split point in streaming markdown text.
 * Safe means: not inside a code fence, not mid-inline-formatting.
 * Returns the index to split at, or -1 if no safe point found.
 */
export function findSafeSplitPoint(text: string): number {
  const lines = text.split("\n");
  let inCodeFence = false;
  let lastSafeLine = -1;
  let charCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^```/)) {
      inCodeFence = !inCodeFence;
    }
    charCount += line.length + 1; // +1 for \n

    // A line boundary is safe if we're not inside a code fence
    // and the line is complete (ends a paragraph, list item, or is blank)
    if (!inCodeFence && i < lines.length - 1) {
      const nextLine = lines[i + 1];
      // Safe after: blank lines, complete list items, headers, code fence closers
      if (line === "" || nextLine === "" || line.match(/^#{1,4}\s/) || line === "```") {
        lastSafeLine = i;
      }
    }
  }

  if (lastSafeLine === -1) return -1;

  // Convert line index back to character index
  let idx = 0;
  for (let i = 0; i <= lastSafeLine; i++) {
    idx += lines[i].length + 1;
  }
  return idx;
}

/**
 * Check if text has unclosed markdown formatting that would break rendering.
 */
export function hasUnclosedFormatting(text: string): boolean {
  // Check for unclosed code fence
  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) return true;

  // Check for unclosed bold/italic on the last line
  const lastLine = text.split("\n").pop() || "";
  const boldCount = (lastLine.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) return true;

  return false;
}
