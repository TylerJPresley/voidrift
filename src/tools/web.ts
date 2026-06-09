/**
 * Web tools — fetch URLs and search the web.
 * Strips HTML to plain text, truncates large responses.
 */

import { createHash } from "crypto";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const FETCH_TIMEOUT_MS = 10000;
const MAX_CONTENT_LENGTH = 50000;
const MAX_LINES = 100;
const SMALL_FILE_THRESHOLD = 50; // lines — return full content inline

export interface WebResult {
  output: string;
  error?: string;
  isPrivate?: boolean;
  cachedPath?: string;
}

/**
 * Fetch a URL and cache the content to .voidrift/cache/web/{hash}.md.
 * - Small content: returns full text inline
 * - Large content: returns summary + cached file path for read_file access
 * - Negotiates markdown format when possible (fewer tokens)
 * - Converts GitHub blob URLs to raw
 * - Detects private/localhost URLs
 */
export async function webFetch(url: string, workspaceRoot?: string): Promise<WebResult> {
  try {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { output: "", error: "URL must start with http:// or https://" };
    }

    if (isPrivateUrl(url)) {
      return { output: "", error: "Private/localhost URL detected — requires approval", isPrivate: true };
    }

    url = convertGitHubUrl(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VoidRift/0.1",
        "Accept": "text/markdown, text/plain, text/html;q=0.9, */*;q=0.1",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { output: "", error: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();

    let text: string;
    if (contentType.includes("text/markdown") || contentType.includes("text/plain")) {
      text = raw;
    } else {
      text = stripHtml(raw);
    }

    const lines = text.split("\n").filter(l => l.trim());

    // Small content: return inline
    if (lines.length <= SMALL_FILE_THRESHOLD) {
      return { output: lines.join("\n") };
    }

    // Large content: cache to file and return summary + path
    let cachedPath: string | undefined;
    if (workspaceRoot) {
      const hash = createHash("md5").update(url).digest("hex").slice(0, 12);
      const cacheDir = join(workspaceRoot, ".voidrift", "cache", "web");
      mkdirSync(cacheDir, { recursive: true });
      cachedPath = join(cacheDir, `${hash}.md`);
      const header = `<!-- Fetched from: ${url} -->\n\n`;
      writeFileSync(cachedPath, header + lines.join("\n"), "utf-8");
      cachedPath = `.voidrift/cache/web/${hash}.md`;
    }

    // Return first/last lines as preview
    const preview = [
      ...lines.slice(0, 20),
      "",
      `[... ${lines.length - 40} more lines ...]`,
      "",
      ...lines.slice(-20),
    ].join("\n");

    const pathNote = cachedPath ? `\n\nFull content cached at: ${cachedPath}\nUse read_file("${cachedPath}", offset, limit) to read specific sections.` : "";

    return { output: preview + pathNote, cachedPath };
  } catch (err: any) {
    if (err.name === "AbortError") return { output: "", error: "Fetch timed out" };
    return { output: "", error: err.message || "Fetch failed" };
  }
}

export interface SearchConfig {
  provider: "duckduckgo" | "tavily" | "google";
  apiKey?: string;
}

/**
 * Search the web using the configured provider.
 * Falls back to DuckDuckGo if no API key is configured.
 */
export async function webSearch(query: string, config?: SearchConfig): Promise<WebResult> {
  const provider = config?.provider || "duckduckgo";

  if (provider === "tavily" && config?.apiKey) {
    return tavilySearch(query, config.apiKey);
  }

  return duckduckgoSearch(query);
}

async function tavilySearch(query: string, apiKey: string): Promise<WebResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 8 }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { output: "", error: `Tavily API error: HTTP ${response.status}` };
    }

    const data = await response.json() as any;
    const results = (data.results || []).slice(0, 8);

    if (results.length === 0) return { output: "No results found." };

    const formatted = results.map((r: any, i: number) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content?.slice(0, 200) || ""}`
    ).join("\n\n");

    return { output: formatted };
  } catch (err: any) {
    if (err.name === "AbortError") return { output: "", error: "Search timed out" };
    return { output: "", error: err.message || "Tavily search failed" };
  }
}

async function duckduckgoSearch(query: string): Promise<WebResult> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "VoidRift/0.1" },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { output: "", error: `Search failed: HTTP ${response.status}` };
    }

    const html = await response.text();
    const results = parseSearchResults(html);

    if (results.length === 0) {
      return { output: "No results found." };
    }

    const formatted = results.slice(0, 8).map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join("\n\n");

    return { output: formatted };
  } catch (err: any) {
    if (err.name === "AbortError") return { output: "", error: "Search timed out" };
    return { output: "", error: err.message || "Search failed" };
  }
}

/**
 * Detect private/localhost URLs that shouldn't be fetched without permission.
 */
function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Convert GitHub blob URLs to raw content URLs.
 * e.g., github.com/user/repo/blob/main/file.ts → raw.githubusercontent.com/user/repo/main/file.ts
 */
function convertGitHubUrl(url: string): string {
  if (url.includes("github.com") && url.includes("/blob/")) {
    return url
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
  }
  return url;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < links.length; i++) {
    const url = links[i][1] || "";
    const title = (links[i][2] || "").replace(/<[^>]+>/g, "").trim();
    const snippet = (snippets[i]?.[1] || "").replace(/<[^>]+>/g, "").trim();

    const actualUrl = decodeURIComponent(url.replace(/.*uddg=/, "").replace(/&.*/, ""));

    if (title && actualUrl) {
      results.push({ title, url: actualUrl, snippet });
    }
  }

  return results;
}
