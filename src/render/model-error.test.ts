import { describe, it, expect } from "vitest";
import {
  hostOf,
  maskSecrets,
  hintFor,
  formatRetryLine,
  formatModelFailure,
  displayClass,
  formatHeadlessModelError,
  MODEL_SWITCH_HINT,
  type ModelErrorInfo,
} from "./model-error.js";

const TEST_HOST = "models.example.test";

const base = (over: Partial<ModelErrorInfo> = {}): ModelErrorInfo => ({
  name: "gx10",
  code: "server",
  message: "502 status code (no body)",
  attempt: 2,
  maxRetries: 2,
  baseUrl: `https://${TEST_HOST}/v1`,
  modelId: "qwen2.5-coder",
  ...over,
});

describe("hostOf", () => {
  it("returns host[:port] only — no scheme, path, query, or userinfo", () => {
    expect(hostOf(`https://${TEST_HOST}/v1`)).toBe(TEST_HOST);
    expect(hostOf("http://127.0.0.1:11434/v1/chat")).toBe("127.0.0.1:11434");
    // Credentials embedded in the URL never leak.
    expect(hostOf("https://user:pass@secret.example/v1")).toBe("secret.example");
    expect(hostOf("https://user:pass@secret.example/v1")).not.toContain("pass");
  });

  it("falls back to a host-ish prefix for an unparseable baseUrl and to a label when absent", () => {
    expect(hostOf("not a url/path")).toBe("not a url");
    expect(hostOf(undefined)).toBe("the configured endpoint");
  });
});

describe("maskSecrets", () => {
  it("masks api keys, bearer tokens, and key=value secrets", () => {
    expect(maskSecrets("got sk-abcdef1234567890")).not.toContain("abcdef1234567890");
    expect(maskSecrets("Authorization: Bearer abc.def.ghijklmno")).not.toContain("ghijklmno");
    expect(maskSecrets("api_key=supersecretvalue rejected")).not.toContain("supersecretvalue");
    // Non-secret text is left intact.
    expect(maskSecrets("temperature must be <= 2")).toBe("temperature must be <= 2");
  });
});

describe("hintFor — one hint per failure class", () => {
  it("5xx server → check the model server", () => {
    expect(hintFor(base({ code: "server" }))).toMatch(/model server is not responding/);
  });
  it("network/ECONNREFUSED → cannot connect to host:port with the URL question", () => {
    const h = hintFor(base({ code: "network", baseUrl: "http://127.0.0.1:11434/v1" }));
    expect(h).toBe("cannot connect to 127.0.0.1:11434 — is the server running and the URL right?");
  });
  it("auth 401/403 → check apiKeyEnv", () => {
    expect(hintFor(base({ code: "auth" }))).toBe("authentication failed — check apiKeyEnv");
  });
  it("404 → list ids with GET <baseUrl>/models and names the model id", () => {
    const h = hintFor(base({ code: "client", message: "404 model not found", modelId: "ghost" }));
    expect(h).toContain("'ghost'");
    expect(h).toContain(`GET https://${TEST_HOST}/v1/models`);
  });
  it("400 → check modelKwargs", () => {
    expect(hintFor(base({ code: "client", message: "400 Bad Request" }))).toMatch(/modelKwargs/);
  });
  it("429 → rate limited", () => {
    expect(hintFor(base({ code: "rate_limited" }))).toMatch(/rate limiting/);
  });
  it("timeout → timed out", () => {
    expect(hintFor(base({ code: "timeout" }))).toMatch(/timed out/);
  });
});

describe("formatRetryLine", () => {
  it("shows model @ host, the reason, and (attempt/total)", () => {
    expect(formatRetryLine(base({ attempt: 2, maxRetries: 2 }))).toBe(
      `gx10 @ ${TEST_HOST}: 502 status code (no body) — retrying (2/3)…`,
    );
  });
});

describe("formatModelFailure", () => {
  it("final 502 line reports host, reason, attempt count, and the server hint", () => {
    const f = formatModelFailure(base({ code: "server", attempt: 3, maxRetries: 2 }));
    expect(f.reason).toBe(`gx10 @ ${TEST_HOST}: 502 status code (no body) after 3 attempts.`);
    expect(f.hint).toMatch(/model server is not responding/);
  });

  it("singular 'attempt' for a single non-retryable attempt", () => {
    const f = formatModelFailure(base({ code: "auth", message: "401 Unauthorized", attempt: 1 }));
    expect(f.reason).toContain("after 1 attempt.");
    expect(f.hint).toBe("authentication failed — check apiKeyEnv");
  });

  it("400 shows the server's own message (truncated, masked) and the modelKwargs hint", () => {
    const longBody = "400 " + "x".repeat(400);
    const f = formatModelFailure(base({ code: "client", message: `${longBody}\napi_key=leak` }));
    // First 200 chars of the first line only; the leaked key on line 2 is dropped.
    expect(f.reason.length).toBeLessThan(260);
    expect(f.reason).not.toContain("leak");
    expect(f.hint).toMatch(/modelKwargs/);
  });

  it("never leaks a secret embedded in the reason", () => {
    const f = formatModelFailure(base({ code: "client", message: "400 bad: sk-abcdefgh12345678" }));
    expect(f.reason).not.toContain("abcdefgh12345678");
  });
});

describe("displayClass — core class → headless display word (D5)", () => {
  it("maps rate_limited → rate_limit", () => {
    expect(displayClass(base({ code: "rate_limited" }))).toBe("rate_limit");
  });
  it("a refused connect (network + ECONNREFUSED) reads as 'refused'", () => {
    expect(displayClass(base({ code: "network", message: "connect ECONNREFUSED 127.0.0.1:11434" }))).toBe("refused");
  });
  it("a non-refused network fault keeps 'network'", () => {
    expect(displayClass(base({ code: "network", message: "fetch failed" }))).toBe("network");
  });
  it("passes server/auth/timeout through unchanged", () => {
    expect(displayClass(base({ code: "server" }))).toBe("server");
    expect(displayClass(base({ code: "auth" }))).toBe("auth");
    expect(displayClass(base({ code: "timeout" }))).toBe("timeout");
  });
});

describe("formatHeadlessModelError — one legible line, never silent (D5)", () => {
  it("names the class, the host (host only), a fix, and the /model pointer", () => {
    const line = formatHeadlessModelError(base({ code: "server" }));
    expect(line).toBe(
      `voidrift: model error: server from ${TEST_HOST} — the endpoint answered but its model server is not responding — check that service, then send again; switch with /model in an interactive session or fix the endpoint`,
    );
  });
  it("a refused connect reports 'refused' and the host:port, never a URL path or key", () => {
    const line = formatHeadlessModelError(
      base({ code: "network", message: "ECONNREFUSED", baseUrl: `https://user:pass@${TEST_HOST}/v1/chat` }),
    );
    expect(line).toContain(`model error: refused from ${TEST_HOST}`);
    expect(line).not.toContain("pass");
    expect(line).not.toContain("/v1/chat");
  });
  it("always ends with the /model escape", () => {
    expect(formatHeadlessModelError(base({ code: "auth" }))).toContain(
      "switch with /model in an interactive session or fix the endpoint",
    );
  });
});

describe("MODEL_SWITCH_HINT — interactive /model pointer (D5)", () => {
  it("mentions /model so the TUI failure block tells a user how to switch", () => {
    expect(MODEL_SWITCH_HINT).toContain("/model");
  });
});
