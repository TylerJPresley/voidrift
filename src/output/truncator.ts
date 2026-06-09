const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?\x07|\x1B[()][AB012]|\x1B\[?[0-9;]*[hlm]/g;
const MAX_LINES = 50;

/**
 * Strips ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Truncates output to first and last N lines, inserting a marker in between.
 * Keeps full output if under the threshold.
 */
export function truncateOutput(text: string, maxLines = MAX_LINES): string {
  const stripped = stripAnsi(text);
  const lines = stripped.split("\n");

  if (lines.length <= maxLines * 2) return stripped;

  const head = lines.slice(0, maxLines);
  const tail = lines.slice(-maxLines);
  const omitted = lines.length - maxLines * 2;

  return [...head, `\n... (${omitted} lines omitted) ...\n`, ...tail].join("\n");
}
