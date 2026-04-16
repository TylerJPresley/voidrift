/**
 * HTTP client with per-session cookie/auth persistence (REQ-VF-12, REQ-SEC-3).
 */

import { checkSsrf } from "./ssrf.js";

interface SessionState {
  cookies: Record<string, string>;
  authHeader?: string;
}

const sessions = new Map<string, SessionState>();

function getSession(id: string): SessionState {
  let s = sessions.get(id);
  if (!s) { s = { cookies: {} }; sessions.set(id, s); }
  return s;
}

/** Make an HTTP request with session persistence (REQ-VF-12). */
export async function httpRequest(
  method: string, url: string, headers?: string, body?: string, sessionId?: string,
): Promise<string> {
  const sid = sessionId ?? "default";
  const session = getSession(sid);

  // Parse custom headers
  const hdrs: Record<string, string> = {};
  if (headers) { try { Object.assign(hdrs, JSON.parse(headers)); } catch { /* */ } }

  // Inject session cookies
  const cookieStr = Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) hdrs["Cookie"] = cookieStr;

  // Inject auth header from session
  if (session.authHeader && !hdrs["Authorization"]) hdrs["Authorization"] = session.authHeader;

  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: hdrs,
      body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
    });

    // Capture Set-Cookie headers into session
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const match = sc.match(/^([^=]+)=([^;]*)/);
      if (match) session.cookies[match[1]] = match[2];
    }

    // Capture auth header if response includes one
    const authResp = res.headers.get("authorization");
    if (authResp) session.authHeader = authResp;

    const text = await res.text();
    return JSON.stringify({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: text.length > 50000 ? text.slice(0, 50000) + "\n[truncated]" : text,
    });
  } catch (e) {
    return JSON.stringify({ error: `HTTP ${method} ${url} failed: ${e instanceof Error ? e.message : e}` });
  }
}

/** Clear all sessions (REQ-VF-10). */
export function clearSessions(): void {
  sessions.clear();
}
