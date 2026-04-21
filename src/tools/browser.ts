/**
 * Browser automation for verify sub-agents (REQ-ARCH-10, REQ-VF-2).
 * Uses Playwright for navigation, screenshots, clicks, and text extraction.
 * Sessions are scoped to a command run and cleaned up via closeAllSessions().
 *
 * Sync bridge: tool handlers return string synchronously. Playwright is async.
 * Each action spawns a helper subprocess with data passed via stdin (no shell
 * interpolation) to avoid injection (REQ-SEC-1). Session state persists via
 * Playwright storageState files on disk.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";

const activeSessions = new Set<string>();

function resolveSessionId(sessionId?: string): string {
  return sessionId || "default";
}

function sessionDir(id: string): string {
  return resolve(tmpdir(), `voidrift-browser-${id}`);
}

/**
 * Execute a browser action via a child process. Data passed through stdin
 * as JSON to prevent injection (REQ-SEC-1).
 */
function execBrowserAction(action: string, params: Record<string, string>): string {
  const input = JSON.stringify({ action, ...params });
  try {
    const helperPath = resolve(__dirname, "browser-helper.cjs");
    const result = execFileSync("node", [helperPath], {
      timeout: 40000,
      encoding: "utf-8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || JSON.stringify({ error: "No output from browser action" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Check if playwright is not installed
    if (msg.includes("Cannot find module") || msg.includes("playwright")) {
      return JSON.stringify({ error: "Playwright not installed. Run: npx playwright install chromium" });
    }
    return JSON.stringify({ error: `Browser ${action} failed: ${msg}` });
  }
}

/**
 * Navigate to a URL. Returns page title and URL on success.
 */
export function browserNavigate(url: string, sessionId?: string): string {
  const id = resolveSessionId(sessionId);
  activeSessions.add(id);
  return execBrowserAction("navigate", { url, sessionId: id });
}

/**
 * Take a screenshot. Returns the file path where the screenshot was saved.
 */
export function browserScreenshot(path?: string, sessionId?: string): string {
  const id = resolveSessionId(sessionId);
  const outPath = path || resolve(tmpdir(), `voidrift-screenshot-${Date.now()}.png`);
  return execBrowserAction("screenshot", { path: outPath, sessionId: id });
}

/**
 * Click an element by CSS selector.
 */
export function browserClick(selector: string, sessionId?: string): string {
  const id = resolveSessionId(sessionId);
  return execBrowserAction("click", { selector, sessionId: id });
}

/**
 * Get text content from the page or a specific element.
 */
export function browserGetText(selector?: string, sessionId?: string): string {
  const id = resolveSessionId(sessionId);
  return execBrowserAction("get_text", { selector: selector || "", sessionId: id });
}

/**
 * Close all browser sessions. Called in try/finally by verify orchestrator (REQ-ARCH-17).
 */
export function closeAllSessions(): void {
  for (const id of activeSessions) {
    const dir = sessionDir(id);
    try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
  activeSessions.clear();
}

/**
 * Close a specific browser session.
 */
export function closeSession(sessionId: string): void {
  const dir = sessionDir(sessionId);
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  activeSessions.delete(sessionId);
}
