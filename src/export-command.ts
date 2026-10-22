/**
 * `voidrift export` (cli-blueprint.md §2.1, core §10.13).
 *
 * A top-level COMMAND like `doctor`/`access`, bound to the HOST-ONLY
 * `session.export` (core §10.13): it renders a stored session as a sanitized
 * document with NO model call and NO network. Unlike `doctor`/`access` it needs
 * the stored session state, so it boots a core (read-only) exactly as
 * `--routine --list` does, calls `session.export`, and maps the result to an
 * exit code (0 success, 2 usage: an unknown session, a bad format, an existing
 * or protected target). `export` is NOT a model tool and NOT on any tool list.
 *
 * `--out` writes an owner-only file (the core does the atomic owner-only write
 * and the protected-path/exists/symlink refusals); without `--out` the rendered
 * content goes to stdout. The core sanitizes every string (secrets, absolute
 * paths, unsafe characters) before it leaves the process, so stdout is safe.
 */
import type { CoreReady } from "@voidrift/core";
import { EXIT } from "./exit-codes.js";

/** The streams/process surface `export` touches, injected so tests drive it. */
export interface ExportDeps {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
  /** Boot a read-only core for this workspace (injected for tests). */
  boot: (opts: { workspaceRoot: string; output?: (t: string) => void }) => Promise<CoreReady>;
}

export interface ExportArgs {
  id: string;
  format?: "md" | "json";
  out?: string;
  noToolResults?: boolean;
}

/** Run `voidrift export <id|last> [--format] [--out] [--no-tool-results]` and
 * return the process exit code (§2.1, core §10.13). */
export async function runExportCommand(args: ExportArgs, deps: ExportDeps): Promise<number> {
  let ready: CoreReady;
  try {
    ready = await deps.boot({ workspaceRoot: deps.cwd, output: () => undefined });
  } catch {
    return EXIT.STARTUP;
  }
  try {
    deps.stderr.write("voidrift: export (no model, no network)\n");
    const res = await ready.api.session.export(args.id, {
      ...(args.format ? { format: args.format } : {}),
      ...(args.out ? { out: args.out } : {}),
      ...(args.noToolResults ? { includeToolResults: false } : {}),
    });
    if (!res.ok) {
      deps.stderr.write(`voidrift: export failed: ${res.error.message}\n`);
      // SESSION_NOT_FOUND / EXPORT_* / INVALID_INPUT are all usage-class here:
      // the command took no session, so a bad request exits 2 like doctor/access.
      return EXIT.USAGE;
    }
    if (res.value.path) {
      deps.stderr.write(`voidrift: wrote ${res.value.path}\n`);
    } else if (res.value.content !== undefined) {
      deps.stdout.write(res.value.content);
    }
    return EXIT.COMPLETED;
  } finally {
    await ready.api.session.shutdown().catch(() => undefined);
  }
}
