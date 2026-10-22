/**
 * Model-failure legibility (cli-blueprint.md §10.1).
 *
 * ONE tested, pure, side-effect-free place that turns the core's `MODEL_ERROR`
 * `{ name, code, message, retryable, attempt, willRetry, maxRetries }` (core
 * §3.6, §11.9) into the lines the TUI and headless both print. The core emits
 * the raw provider message (e.g. `502 status code (no body)`); this module adds
 * WHICH endpoint it is, HOW many attempts ran, and ONE hint chosen by failure
 * class — so a user sees cause and next step instead of a bare status code.
 *
 * It never prints a secret: the only external text it echoes is the server's
 * own error message for a 400 (truncated to 200 chars and masked), and it reads
 * `<host>` from the model's `baseUrl` as `host[:port]` only — never the path,
 * query, userinfo, or any apiKey (those never reach this layer).
 */
import { sanitize } from "./theme.js";

/** The fields this module reads from a core `MODEL_ERROR` payload (§3.6). */
export interface ModelErrorInfo {
  /** The model endpoint name (config key), e.g. `gx10`. */
  name: string;
  /** The free-string classification: `server`, `network`, `auth`, `rate_limited`, `timeout`, `client`, `unknown` (§11.9). */
  code: string;
  /** The raw provider message, verbatim from the core. */
  message: string;
  /** The attempt number this failure is (1-based). */
  attempt: number;
  /** The retry budget (`networkModelMaxRetries`); total attempts = `maxRetries + 1`. */
  maxRetries: number;
  /** The endpoint's `baseUrl` (from `models.list()`), used for `<host>`. Absent for a bundled cloud default. */
  baseUrl?: string | undefined;
  /** The model id the endpoint serves (`models.list().model`), for the 404 hint. */
  modelId?: string | undefined;
}

/** Mask anything in `s` that looks like a credential (never print a secret). */
export function maskSecrets(s: string): string {
  return (
    s
      // `sk-...` style API keys and `Bearer <token>` → replace wholesale.
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***")
      .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***")
      // `api_key=<token>` / `token: <token>` / `secret=<token>` → keep the key
      // name, mask the value (the first capture group is the key+separator).
      .replace(/\b(api[_-]?key|authorization|token|secret)(\s*[:=]\s*)\S+/gi, "$1$2***")
  );
}

/**
 * Extract `host[:port]` from a `baseUrl` — no scheme, path, query, or userinfo,
 * so credentials embedded in a URL (`https://user:pass@host`) never leak. A
 * baseUrl that will not parse falls back to its own host-ish prefix; an absent
 * baseUrl yields `the configured endpoint` so the line still reads naturally.
 */
export function hostOf(baseUrl: string | undefined): string {
  if (!baseUrl) return "the configured endpoint";
  try {
    const u = new URL(baseUrl);
    return u.host || baseUrl; // `host` is `hostname[:port]`, dropping userinfo.
  } catch {
    // Not a full URL; strip any scheme and take up to the first slash.
    const noScheme = baseUrl.replace(/^[a-z]+:\/\//i, "");
    const hostPart = noScheme.split("/")[0] ?? baseUrl;
    // Drop any `user:pass@` userinfo.
    return hostPart.includes("@") ? hostPart.slice(hostPart.lastIndexOf("@") + 1) : hostPart;
  }
}

/** The host and its `:port` split out, for the ECONNREFUSED hint's `<host>:<port>`. */
function hostAndPort(baseUrl: string | undefined): { host: string; port: string } {
  const hp = hostOf(baseUrl);
  const idx = hp.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(hp.slice(idx + 1))) return { host: hp.slice(0, idx), port: hp.slice(idx + 1) };
  return { host: hp, port: baseUrl?.startsWith("https") ? "443" : "80" };
}

/** A short human reason per class, used in the retry line and the final block. */
function humanReason(info: ModelErrorInfo): string {
  switch (info.code) {
    case "server":
      // Keep the server status visible (502/503/504 live in the raw message).
      return firstLine(info.message) || "the model server is not responding";
    case "network":
      return "cannot reach the endpoint";
    case "auth":
      return "authentication failed";
    case "rate_limited":
      return "rate limited";
    case "timeout":
      return "the request timed out";
    case "client":
      return firstLine(info.message) || "the server rejected the request";
    default:
      return firstLine(info.message) || "the model call failed";
  }
}

/** The first line of a message, trimmed — the status/summary, not a stack. */
function firstLine(message: string): string {
  return (message.split("\n")[0] ?? "").trim();
}

/** Does this message look like an HTTP 400 (bad request)? */
function isStatus(message: string, status: number): boolean {
  return new RegExp(`\\b${status}\\b`).test(message);
}

/**
 * ONE dim hint line chosen by failure class (§10.1). Returns the hint text
 * WITHOUT a glyph; the caller prefixes the dim glyph. Returns null when a class
 * has no actionable hint (never happens for the known classes below).
 */
export function hintFor(info: ModelErrorInfo): string {
  const { host, port } = hostAndPort(info.baseUrl);
  switch (info.code) {
    case "server":
      return "the endpoint answered but its model server is not responding — check that service, then send again";
    case "network":
      return `cannot connect to ${host}:${port} — is the server running and the URL right?`;
    case "auth":
      return "authentication failed — check apiKeyEnv";
    case "rate_limited":
      return "the endpoint is rate limiting requests — slow down or raise your quota, then send again";
    case "timeout":
      return "the request timed out — the server took too long; try again or raise networkModelTimeout";
    case "client": {
      // 404 (unknown model id) and 400 (bad parameter) are distinct client faults.
      if (isStatus(info.message, 404)) {
        const base = info.baseUrl ? info.baseUrl.replace(/\/+$/, "") : "<baseUrl>";
        return `the endpoint does not serve model id '${info.modelId ?? info.name}' — list ids with GET ${base}/models`;
      }
      return "the server rejected a request parameter — check this model's modelKwargs in your config";
    }
    default:
      return "check the endpoint and your model config, then send again";
  }
}

/** Map a core `MODEL_ERROR` class (§11.9: `timeout`/`rate_limited`/`auth`/
 * `server`/`network`/`client`/`unknown`) to the short display word a user sees
 * on a headless failure line (cli §10.1). A refused connect (`network`,
 * non-retryable) is surfaced as `refused` so the user can tell a down endpoint
 * from a transient network blip; `rate_limited` shortens to `rate_limit`. */
export function displayClass(info: ModelErrorInfo): string {
  switch (info.code) {
    case "rate_limited":
      return "rate_limit";
    case "network":
      // A connection refusal reads as `refused`; any other network fault keeps
      // `network`. The refused message carries the ECONNREFUSED hint text.
      return /refus|ECONNREFUSED/i.test(info.message) ? "refused" : "network";
    default:
      return info.code;
  }
}

/**
 * The ONE headless stderr line for a model failure (cli §10.1, core §11.5): the
 * failure class, the endpoint host (host only — never a path, userinfo, or key),
 * one fix hint, and the `/model` pointer so a user knows the interactive escape.
 * A headless run prints exactly this so a model-down run is never silent.
 */
export function formatHeadlessModelError(info: ModelErrorInfo): string {
  const cls = displayClass(info);
  const host = hostOf(info.baseUrl);
  const fix = sanitize(maskSecrets(hintFor(info)));
  return `voidrift: model error: ${cls} from ${host} — ${fix}; switch with /model in an interactive session or fix the endpoint`;
}

/** The interactive `/model` pointer line shown after a model failure (cli
 * §10.1): the TUI escape a user takes to switch endpoints. Headless folds the
 * same pointer into its one-line message (`formatHeadlessModelError`); the TUI
 * shows it as its own dim line under the reason and hint. */
export const MODEL_SWITCH_HINT = "switch with /model or fix the endpoint, then send again";

/** The live retry line shown while the engine retries (§10.1): one dim line,
 * `<model> @ <host>: <reason> — retrying (attempt/total)…`. No glyph (the TUI
 * prefixes `↻`, headless prefixes nothing but the status channel). */
export function formatRetryLine(info: ModelErrorInfo): string {
  const total = info.maxRetries + 1;
  const reason = sanitize(maskSecrets(humanReason(info)));
  return `${info.name} @ ${hostOf(info.baseUrl)}: ${reason} — retrying (${info.attempt}/${total})…`;
}

/** The final failed-turn lines (§10.1): the `✗` reason line (no glyph here) and
 * ONE dim hint line. Both already masked/sanitized. `attempts` is the attempt
 * count the last `MODEL_ERROR` reported. */
export interface ModelFailureLines {
  /** `<model> @ <host>: <reason> after <n> attempt(s).` — the caller prefixes `✗`. */
  reason: string;
  /** The single dim hint line — the caller prefixes a dim glyph. */
  hint: string;
}

/** Build the two final-failure lines from the last `MODEL_ERROR` (§10.1). For a
 * 400 the server's own message is shown (first 200 chars, masked) ahead of the
 * generic reason so the user sees exactly what the server objected to. */
export function formatModelFailure(info: ModelErrorInfo): ModelFailureLines {
  const attempts = Math.max(1, info.attempt);
  const plural = attempts === 1 ? "attempt" : "attempts";
  let reason = humanReason(info);
  // 400: surface the server's message (first 200 chars, masked) in the reason.
  if (info.code === "client" && isStatus(info.message, 400)) {
    const body = maskSecrets(firstLine(info.message)).slice(0, 200);
    reason = body || "the server rejected the request";
  }
  reason = sanitize(maskSecrets(reason));
  return {
    reason: `${info.name} @ ${hostOf(info.baseUrl)}: ${reason} after ${attempts} ${plural}.`,
    hint: sanitize(maskSecrets(hintFor(info))),
  };
}
