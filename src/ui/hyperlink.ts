/**
 * Terminal Hyperlink Utility.
 *
 * Wraps text in an OSC 8 hyperlink escape sequence for terminals that support it.
 * Terminals that don't support it simply show the display text with no side effects.
 */
import { join } from "path";

/**
 * Create a clickable file:// link for terminal display.
 * @param absolutePath The full absolute path to the file
 * @param displayText What to show (defaults to the path)
 */
export function fileLink(absolutePath: string, displayText?: string): string {
  const display = displayText || absolutePath;
  return `\x1b]8;;file://${absolutePath}\x1b\\${display}\x1b]8;;\x1b\\`;
}

/**
 * Wrap a relative path as a clickable link, resolving against workspace root.
 */
export function relativeFileLink(workspaceRoot: string, relativePath: string, displayText?: string): string {
  const absolute = relativePath.startsWith("/") ? relativePath : join(workspaceRoot, relativePath);
  return fileLink(absolute, displayText || relativePath);
}
