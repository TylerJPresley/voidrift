/**
 * Config-rejection reporting (cli-blueprint.md §2.1; core-blueprint §13.2–§13.3).
 *
 * When a config layer fails the strict schema the core sets it aside as a
 * `.rejected` sibling, recovers to defaults, and keeps running — but the
 * `CONFIG_INVALID` event fires during boot, before the CLI subscribes, so the
 * CLI reads the durable `config.rejections()` accessor at startup instead. The
 * notice is one stderr line per rejected layer, naming the file, the first few
 * problem KEYS (never values — a value could hold a secret), and the `.rejected`
 * backup path, so the user knows exactly why their config did not apply.
 */
import type { CoreAPI, ConfigRejection, ConfigWarning } from "@voidrift/core";

/** How many problem keys to name before summarizing the rest. */
const MAX_KEYS = 3;

/** Fetch the rejected layers, tolerating any shape error (never throws). */
export async function configRejections(api: CoreAPI): Promise<ConfigRejection[]> {
  try {
    const r = (await api.config.rejections()) as { ok?: boolean; value?: ConfigRejection[] };
    return r && r.ok === true && Array.isArray(r.value) ? r.value : [];
  } catch {
    return [];
  }
}

/** One concise, value-free line per rejected layer. */
export function formatRejectionLines(rejections: ConfigRejection[]): string[] {
  return rejections.map((rej) => {
    const keys = rej.errors.map((e) => e.key).filter((k) => k && k !== "(root)");
    const shown = keys.slice(0, MAX_KEYS);
    const extra = keys.length - shown.length;
    // When no specific key is named — a whole-document failure such as a parse
    // error (the file is not valid JSON) or an unreadable file — surface the
    // first error MESSAGE instead of a generic phrase. The core guarantees these
    // messages are value-free (never echo file content), so the user learns the
    // file is not valid JSON without any content leaking.
    const reason = rej.errors[0]?.message;
    const keyPart =
      shown.length > 0
        ? `invalid key(s): ${shown.join(", ")}${extra > 0 ? ` (+${extra} more)` : ""}`
        : reason && reason !== "(root)"
          ? reason
          : "invalid document";
    return `voidrift: config ${rej.path} was rejected (${keyPart}); running on defaults. A copy is at ${rej.rejectedPath}.`;
  });
}

/** Write the rejection notice to stderr (no-op when nothing was rejected). */
export async function writeRejectionNotice(
  api: CoreAPI,
  stderr: { write(s: string): unknown },
): Promise<ConfigRejection[]> {
  const rejections = await configRejections(api);
  for (const line of formatRejectionLines(rejections)) stderr.write(`${line}\n`);
  return rejections;
}

/** Fetch the non-fatal config warnings, tolerating any shape error (never throws). */
export async function configWarnings(api: CoreAPI): Promise<ConfigWarning[]> {
  try {
    const r = (await api.config.warnings()) as { ok?: boolean; value?: ConfigWarning[] };
    return r && r.ok === true && Array.isArray(r.value) ? r.value : [];
  } catch {
    return [];
  }
}

/** One value-free line per warning. The core message already names the file and
 * key only (never a value), so it is passed through behind the `warning:` tag. */
export function formatWarningLines(warnings: ConfigWarning[]): string[] {
  return warnings.map((w) => `voidrift: warning: ${w.message}`);
}

/**
 * Write the full config startup notice to stderr and return what was reported.
 * Rejections first, then warnings, so both share one code path and ordering
 * (cli-blueprint.md §2.1). Each warning is also logged once at `warn` level
 * through the structured logger (source `config`) so it lands in the session
 * log; `logWarning` is supplied by the caller once a session exists. Warnings
 * never change the exit code. A no-op when nothing was rejected or ignored.
 */
export async function writeConfigNotice(
  api: CoreAPI,
  stderr: { write(s: string): unknown },
  logWarning?: (w: ConfigWarning) => void,
): Promise<{ rejections: ConfigRejection[]; warnings: ConfigWarning[] }> {
  const rejections = await configRejections(api);
  for (const line of formatRejectionLines(rejections)) stderr.write(`${line}\n`);
  const warnings = await configWarnings(api);
  for (const line of formatWarningLines(warnings)) stderr.write(`${line}\n`);
  if (logWarning) for (const w of warnings) logWarning(w);
  return { rejections, warnings };
}

/**
 * A one-line hint appended to a `MODEL_NOT_CONFIGURED` headless failure: point
 * the user at the global config file, and — when the config was rejected — at
 * that as the likely reason.
 */
export function modelNotConfiguredHint(
  rejections: ConfigRejection[],
  globalConfigPath: string,
): string {
  if (rejections.length > 0) {
    const first = rejections[0]!;
    return `hint: no usable model endpoint — your config at ${first.path} was rejected (see the line above) and defaults have none configured. Edit ${first.path} and remove the invalid key(s), or set a model with \`voidrift\` config.`;
  }
  return `hint: no model endpoint is configured. Set one in ${globalConfigPath} (models + modelSelected).`;
}
