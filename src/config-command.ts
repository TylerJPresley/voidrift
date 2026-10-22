/**
 * The `/config` renderer (cli-blueprint.md §7.3).
 *
 * `/config` prints the effective configuration and the config LAYERS with their
 * file paths — read host-only from `config.paths()` and `config.get()` (one op
 * each, no model, no network, no turn). `/config edit` opens the PROJECT config
 * file in the editor (§3.8); this module renders the read-only report only.
 *
 * SECRETS ARE NEVER PRINTED. VoidRift config carries only secret-NAMES (an
 * `apiKeyEnv` names the env var, never the key, core §11), but as defence in
 * depth every value whose key looks secret-bearing (`*key*`, `*token*`,
 * `*secret*`, `*password*`, an `Authorization`-style header) is replaced with
 * `«redacted»` before it is rendered. NO_COLOR-safe: words and layout, no ANSI.
 */
import { sanitize } from "./render/theme.js";

/** `config.paths()` shape (core §13): the four layers and their files. */
export type ConfigLayerName = "managed" | "global" | "project" | "session";
export type ConfigPaths = Record<ConfigLayerName, { path: string; exists: boolean }>;

/** The layer order shown in the report (most-authoritative pin last). */
const LAYER_ORDER: ConfigLayerName[] = ["managed", "global", "project", "session"];

/** A key whose VALUE must never be printed (defence in depth, §10.10). The
 * `apiKeyEnv` key names an env var (safe) — only the literal `apiKey`/token/
 * secret/password-shaped keys are redacted. */
function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "apikeyenv") return false; // names the env var, not the key
  return (
    /(^|[^a-z])(api[_-]?key|secret|password|passwd|token|credential|authorization|cookie)([^a-z]|$)/.test(k) ||
    k.endsWith("key")
  );
}

/** Mask credentials embedded in a STRING value regardless of its key name
 * (defence in depth, §10.10). `baseUrl`, an mcp `url`, a `webSearch` endpoint,
 * or any header value can carry a secret that a key-name check misses:
 *   - URL userinfo `scheme://user:pass@host` → `scheme://«redacted»@host`,
 *   - secret-named query parameters (`?token=…`, `&apikey=…`, `password`,
 *     `secret`, `access_token`, `sig`, `signature`, `auth`) → `«redacted»`.
 * Non-URL strings and URLs with no credential are returned unchanged. PURE. */
const SECRET_QUERY_PARAM = /^(api[_-]?key|access[_-]?token|token|secret|password|passwd|auth|authorization|sig|signature|key|credential)$/i;
function maskUrlSecrets(value: string): string {
  // Userinfo: scheme://user:pass@host  (also user@host → treat as credential).
  let out = value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, (_m, scheme: string) => `${scheme}«redacted»@`);
  // Secret-named query parameters anywhere in the string.
  out = out.replace(/([?&])([^=&\s]+)=([^&\s]*)/g, (m, sep: string, name: string, _v: string) =>
    SECRET_QUERY_PARAM.test(decodeURIComponent(name)) ? `${sep}${name}=«redacted»` : m,
  );
  return out;
}

/** Deep-clone a config value, replacing any secret-keyed value with a marker
 * and sorting object keys for a stable, diffable render. Arrays and nested
 * objects are walked; every string primitive is additionally scrubbed of URL
 * userinfo and secret query parameters. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      out[k] = isSecretKey(k) ? "«redacted»" : redact(v);
    }
    return out;
  }
  if (typeof value === "string") return maskUrlSecrets(value);
  return value;
}

/**
 * Render the `/config` report: the layers with their file paths, then the
 * effective (merged) config as redacted, sorted JSON. `paths` comes from
 * `config.paths()` and `effective` from `config.get()` (§7.3). Pure and
 * secret-free; the caller prints it as a system message.
 */
export function renderConfigReport(paths: ConfigPaths, effective: unknown): string {
  const lines: string[] = [];
  lines.push("VoidRift configuration");
  lines.push("");
  lines.push("Layers (project overrides global; managed pins):");
  for (const layer of LAYER_ORDER) {
    const p = paths[layer];
    const state = p.exists ? "present" : "absent";
    lines.push(`  ${layer.padEnd(8)} ${state.padEnd(8)} ${sanitize(p.path)}`);
  }
  lines.push("");
  lines.push("Effective config (secrets redacted):");
  const json = JSON.stringify(redact(effective), null, 2);
  for (const l of json.split("\n")) lines.push(`  ${sanitize(l)}`);
  return lines.join("\n");
}
