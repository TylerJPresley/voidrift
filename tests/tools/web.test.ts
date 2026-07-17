import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webFetch, webSearch } from "../../src/tools/web.js";
import type { WebResult } from "../../src/tools/web.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webFetch — URL validation", () => {
  it("rejects URLs without http/https", async () => {
    const result = await webFetch("ftp://example.com");
    expect(result.error).toBe("URL must start with http:// or https://");
  });

  it("rejects bare strings", async () => {
    const result = await webFetch("not-a-url");
    expect(result.error).toBe("URL must start with http:// or https://");
  });

  it("accepts http URLs", async () => {
    // Will fail on fetch but should pass validation
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Network error", "NetworkError"));
    global.fetch = fetchMock;

    const result = await webFetch("http://example.com");
    expect(result.error).toBe("Network error");

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("webFetch — private URL detection", () => {
  const privateUrls = [
    "http://localhost:3000/api",
    "http://127.0.0.1:8080",
    "http://192.168.1.1/admin",
    "http://10.0.0.5/data",
    "https://172.16.0.1/internal",
    "http://myhost.local/app",
    "https://server.internal/api",
  ];

  for (const url of privateUrls) {
    it(`rejects private URL: ${url}`, async () => {
      const result = await webFetch(url);
      expect(result.error).toBe("Private/localhost URL detected — requires approval");
      expect(result.isPrivate).toBe(true);
    });
  }
});

describe("webFetch — HTTP error responses", async () => {
  it("handles 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Map(),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/missing");
    expect(result.error).toBe("HTTP 404 Not Found");
  });

  it("handles 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Map(),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/error");
    expect(result.error).toBe("HTTP 500 Internal Server Error");
  });
});

describe("webFetch — content handling", async () => {
  it("returns plain text content inline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("Hello world"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/hello.txt");
    expect(result.output).toBe("Hello world");
    expect(result.error).toBeUndefined();
  });

  it("returns markdown content inline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/markdown"]]),
      text: () => Promise.resolve("# Title\n\nSome content"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/doc.md");
    expect(result.output).toContain("# Title");
    expect(result.output).toContain("Some content");
  });

  it("strips HTML from HTML content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/html"]]),
      text: () => Promise.resolve("<html><body><p>Hello <b>world</b></p></body></html>"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/page.html");
    expect(result.output).toContain("Hello world");
    expect(result.output).not.toContain("<");
  });

  it("returns small content inline (under threshold)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("line1\nline2\nline3"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/small.txt");
    expect(result.output).toBe("line1\nline2\nline3");
  });

  it("returns preview + cached path for large content", async () => {
    const workspaceRoot = join(tmpdir(), "voidrift-web-test");
    mkdirSync(workspaceRoot, { recursive: true });
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve(lines),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/large.txt", workspaceRoot);
    expect(result.output).toContain("line 1");
    expect(result.output).toContain("more lines");
    expect(result.output).toContain("line 100");
    expect(result.cachedPath).toBeDefined();
    expect(result.cachedPath).toContain(".voidrift/cache/web/");
  });

  it("returns preview without cached path when no workspaceRoot", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve(lines),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/large.txt");
    expect(result.output).toContain("more lines");
    expect(result.cachedPath).toBeUndefined();
  });
});

describe("webFetch — GitHub URL conversion", async () => {
  it("converts GitHub blob URLs to raw", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("raw content"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://github.com/user/repo/blob/main/src/main.ts");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/user/repo/main/src/main.ts",
      expect.any(Object)
    );
    expect(result.output).toBe("raw content");
  });

  it("leaves non-blob GitHub URLs unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("content"),
    });
    global.fetch = fetchMock;

    await webFetch("https://github.com/user/repo");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/user/repo",
      expect.any(Object)
    );
  });
});

describe("webFetch — timeout handling", async () => {
  it("handles AbortError as timeout", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/slow", undefined, { timeoutMs: 100 });
    expect(result.error).toBe("Fetch timed out");
  });

  it("passes timeout to AbortController", async () => {
    let controller: AbortController;
    const fetchMock = vi.fn().mockImplementation((url, opts) => {
      controller = opts.signal ? { signal: opts.signal } as AbortController : null;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "text/plain"]]),
        text: () => Promise.resolve("ok"),
      });
    });
    global.fetch = fetchMock;

    await webFetch("https://example.com/fast", undefined, { timeoutMs: 5000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/fast",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

describe("webFetch — custom small file threshold", async () => {
  it("returns inline when under custom threshold", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("line1\nline2\nline3"),
    });
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/small.txt", "/workspace", { smallFileLines: 10 });
    expect(result.output).toBe("line1\nline2\nline3");
  });
});

describe("webFetch — error handling", async () => {
  it("handles fetch errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));
    global.fetch = fetchMock;

    const result = await webFetch("https://example.com/error");
    expect(result.error).toBe("DNS lookup failed");
  });
});

describe("webSearch — provider routing", () => {
  it("defaults to duckduckgo when no config", async () => {
    const result = await webSearch("test query");
    expect(result.output).toBeDefined();
  });

  it("uses tavily when configured with API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        results: [
          { title: "Result 1", url: "https://example.com/1", content: "Content 1" },
          { title: "Result 2", url: "https://example.com/2", content: "Content 2" },
        ],
      }),
    });
    global.fetch = fetchMock;

    const result = await webSearch("test query", { provider: "tavily", apiKey: "test-key" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.tavily.com/search", expect.any(Object));
    expect(result.output).toContain("Result 1");
    expect(result.output).toContain("Result 2");
  });

  it("uses google when configured with API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        items: [
          { title: "Google Result", link: "https://google.com/1", snippet: "Snippet 1" },
        ],
      }),
    });
    global.fetch = fetchMock;

    const result = await webSearch("test query", { provider: "google", apiKey: "test-key" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("googleapis.com/customsearch/v1"),
      expect.any(Object)
    );
    expect(result.output).toContain("Google Result");
  });

  it("falls back to duckduckgo when tavily has no API key", async () => {
    const result = await webSearch("test query", { provider: "tavily" });
    expect(result.output).toBeDefined();
  });

  it("falls back to duckduckgo when google has no API key", async () => {
    const result = await webSearch("test query", { provider: "google" });
    expect(result.output).toBeDefined();
  });
});

describe("webSearch — tavily empty results", async () => {
  it("returns no results message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ results: [] }),
    });
    global.fetch = fetchMock;

    const result = await webSearch("nonexistent query xyz", { provider: "tavily", apiKey: "test" });
    expect(result.output).toBe("No results found.");
  });
});

describe("webSearch — google empty results", async () => {
  it("returns no results message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ items: [] }),
    });
    global.fetch = fetchMock;

    const result = await webSearch("nonexistent query xyz", { provider: "google", apiKey: "test" });
    expect(result.output).toBe("No results found.");
  });
});

describe("webSearch — tavily API errors", async () => {
  it("handles tavily API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    global.fetch = fetchMock;

    const result = await webSearch("test", { provider: "tavily", apiKey: "bad-key" });
    expect(result.error).toContain("Tavily API error");
  });
});

describe("webSearch — google API errors", async () => {
  it("handles google API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    global.fetch = fetchMock;

    const result = await webSearch("test", { provider: "google", apiKey: "bad-key" });
    expect(result.error).toContain("Google API error");
  });
});

describe("webSearch — timeout handling", async () => {
  it("handles tavily timeout", async () => {
    // Note: fake timers don't work reliably with real setTimeout inside tavilySearch
    // We verify the AbortError path is handled correctly
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError")
    );
    global.fetch = fetchMock;

    const result = await webSearch("test", { provider: "tavily", apiKey: "test" });
    expect(result.error).toBe("Search timed out");
  });
});