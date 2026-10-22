/**
 * Entry-point detection for the `voidrift` bin (cli-blueprint.md §2).
 *
 * Deciding "am I the process entry point?" by string-comparing
 * `import.meta.url` to `` `file://${process.argv[1]}` `` is wrong on two counts:
 *   1. Under an npm bin SYMLINK, `process.argv[1]` is the symlink path (e.g.
 *      `…/node_modules/.bin/voidrift`) while `import.meta.url` is the realpath of
 *      the module (`…/dist/cli.js`), so they never match and the CLI prints
 *      nothing and exits 0.
 *   2. The hand-built `file://` string is not URL-encoded, so a path containing a
 *      space, `#`, or `%` never matches its properly-encoded `import.meta.url`.
 *
 * The fix compares REALPATHS: resolve `argv1` through the filesystem (following
 * symlinks) and compare it to the realpath'd module path decoded from
 * `import.meta.url`. A missing/undefined `argv1` (or one that cannot be
 * realpath'd) is simply "not the entry point".
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve a path through the filesystem, or return undefined if it cannot be. */
function tryRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

/**
 * True when the module identified by `metaUrl` is the process entry point named
 * by `argv1`. Compares realpaths so an npm bin symlink (and paths with spaces or
 * special characters) resolve correctly.
 */
export function isEntrypoint(argv1: string | undefined, metaUrl: string): boolean {
  if (argv1 === undefined) return false;
  const argvReal = tryRealpath(argv1);
  if (argvReal === undefined) return false;
  // The module path from import.meta.url, URL-decoded by fileURLToPath, then
  // realpath'd so a symlinked dist/ resolves the same as the invoked path.
  const moduleReal = tryRealpath(fileURLToPath(metaUrl));
  if (moduleReal === undefined) return false;
  return argvReal === moduleReal;
}
