/**
 * The once-per-day interactive startup notice for out-of-date seeded defaults
 * (cli-blueprint.md §5.5; core §13.9.1/§13.9.2).
 *
 * On an INTERACTIVE start only (never a headless `--prompt`/`--routine` run),
 * VoidRift checks cheaply — a hash compare of a handful of seeded files, no
 * model, no network — whether any seeded default is OUT OF DATE (an unmodified
 * older default) or missing, and whether any seeded allow rule is missing. If
 * so it writes ONE dim `ℹ` line naming the count and the fix (`voidrift init
 * --update`). It is shown AT MOST once per day per config dir, tracked by a
 * `0600` state file (`<configDir>/.update-notice`) holding the last date it was
 * shown. A CUSTOMIZED file never triggers the notice (only `--update` targets).
 *
 * The check is best-effort: any error is swallowed and the notice is skipped,
 * so a broken manifest or an unreadable config dir never blocks startup.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { seededDefaultsOutOfDate, voidriftConfigDir } from "@voidrift/core";

/** The streams/clock surface the notice touches, injected for tests. */
export interface NoticeDeps {
  stderr: { write(s: string): unknown };
  /** The resolved global config dir (defaults to the core resolver). */
  configDir?: () => string;
  /** Today's date key `YYYY-MM-DD` (injected for a deterministic test). */
  today?: () => string;
  /** Count stale/missing defaults (injected for tests; default core export). */
  check?: typeof seededDefaultsOutOfDate;
}

const STATE_FILE = ".update-notice";

/** Today's `YYYY-MM-DD` in local time. */
function todayKey(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Emit the once-per-day update notice if seeded defaults are out of date and it
 * has not already been shown today (§5.5). Returns true when a line was written.
 * Interactive callers invoke this at start; headless runs must NOT call it.
 */
export async function maybeShowUpdateNotice(deps: NoticeDeps): Promise<boolean> {
  try {
    const configDir = (deps.configDir ?? voidriftConfigDir)();
    const today = (deps.today ?? todayKey)();
    const statePath = path.join(configDir, STATE_FILE);

    // Already shown today? (A missing/unreadable state file means "not shown".)
    const last = await fs.readFile(statePath, "utf8").catch(() => "");
    if (last.trim() === today) return false;

    const check = deps.check ?? seededDefaultsOutOfDate;
    const { count, names } = await check();
    if (count <= 0) return false;

    const named = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? `, +${names.length - 3} more` : "";
    // Dim (ANSI 2) `ℹ` line; one fix hint. One line, committed once at start.
    deps.stderr.write(
      `\x1b[2mℹ ${count} seeded default${count === 1 ? " is" : "s are"} out of date (${named}${more}) — run: voidrift init --update\x1b[0m\n`,
    );

    // Record today as shown; the file is 0600 (owner-only), created if missing.
    await fs
      .writeFile(statePath, today + "\n", { mode: 0o600 })
      .catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
