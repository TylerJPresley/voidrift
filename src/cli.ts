#!/usr/bin/env node
/**
 * CLI entry (cli-blueprint.md §1.5 step 1, §2).
 *
 * Parses flags and resolves the command and mode before any SDK work; a usage
 * error exits 2. Interactive runs enter the TUI; `--prompt`/`--routine` run
 * headless. `--version`/`--help` print to stdout and exit 0. stdout carries
 * results, stderr carries errors and status (§2.1).
 */
import { promises as fs } from "node:fs";
import { parseArgs, helpText } from "./args.js";
import { EXIT } from "./exit-codes.js";
import { runHeadless } from "./headless.js";
import { bootCore } from "./core-client.js";
import { resolvePrompt, type ResolveDeps } from "./prompt-resolve.js";
import { CLI_VERSION } from "./version.js";
import { isEntrypoint } from "./entrypoint.js";
import { runInit } from "./init-command.js";
import { runDoctorCommand } from "./doctor-command.js";
import { runAccessCommand } from "./access-command.js";
import { runStatsCommand } from "./stats-command.js";
import { runExportCommand } from "./export-command.js";
import { isFirstRun, scanLiveLeftovers } from "@voidrift/core";

/** Build the prompt-resolution deps over the real filesystem and stdin. */
function fileResolveDeps(maxReadLines: number): ResolveDeps {
  return {
    readFile: (p) => fs.readFile(p, "utf8"),
    isReadableFile: async (p) => {
      try {
        const stat = await fs.stat(p);
        return stat.isFile();
      } catch {
        return false;
      }
    },
    readStdin: async () => {
      if (process.stdin.isTTY) return undefined;
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      return text === "" ? undefined : text;
    },
    maxReadLines,
  };
}

/** The one-time first-run notice (§2.1, §13.8). The displayed path is the fixed
 * `~/.config/voidrift` label — the user-facing name of the global config home —
 * regardless of an `XDG_CONFIG_HOME` redirect, matching the blueprint's exact
 * wording. */
const FIRST_RUN_NOTICE = "voidrift: created ~/.config/voidrift (first run)";

/** Run the CLI and return the process exit code (§2). */
export async function main(argv: readonly string[], proc: NodeJS.Process = process): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    proc.stderr.write(`Error: ${parsed.error}\n`);
    proc.stderr.write("Run voidrift --help for usage.\n");
    return EXIT.USAGE;
  }

  const mode = parsed.mode;

  // §2.1/§13.8 — the first-run notice. For a runnable command (chat / --prompt /
  // --routine) that boots the core, the global seed is created during boot
  // (A2's `createCore`). Detect the absence of the global config.json BEFORE
  // boot and print exactly ONE stderr line when seeding is about to happen in
  // this process. NEVER printed for `--help`, `--version`, or `init` (init
  // reports its own created/left-alone summary to stdout).
  const printFirstRun = (): void => {
    if (isFirstRun()) proc.stderr.write(`${FIRST_RUN_NOTICE}\n`);
  };

  // §13.9.1 — a runnable command (chat / --prompt / --routine) refuses to start
  // (exit 3) when a backup/editor-leftover file sits inside a live resource
  // directory (global or project agents/skills/prompts). It lists the files
  // (home shortened to `~`) and names the fix `voidrift init --sweep`. `doctor`,
  // `init`, `--help`, and `--version` never call this, so they still run. True
  // means clean; false means the gate already printed and the caller returns 3.
  const liveDirsClean = async (): Promise<boolean> => {
    const offending = await scanLiveLeftovers(proc.cwd()).catch(() => [] as string[]);
    if (offending.length === 0) return true;
    const home = process.env["HOME"] ?? "";
    const shorten = (p: string): string =>
      home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p;
    proc.stderr.write("voidrift: a live resource directory holds backup/editor leftover files:\n");
    for (const f of offending) proc.stderr.write(`  ${shorten(f)}\n`);
    proc.stderr.write("fix: voidrift init --sweep\n");
    return false;
  };

  switch (mode.kind) {
    case "help":
      proc.stdout.write(helpText() + "\n");
      return EXIT.COMPLETED;
    case "version":
      proc.stdout.write(CLI_VERSION + "\n");
      return EXIT.COMPLETED;
    case "init": {
      let readLine: (() => Promise<string>) | undefined;
      // Read one confirmation line from stdin only on a TTY (the reset path).
      if (proc.stdin.isTTY) {
        readLine = async (): Promise<string> => {
          return await new Promise<string>((resolve) => {
            const onData = (chunk: Buffer): void => {
              proc.stdin.off("data", onData);
              try {
                proc.stdin.pause();
              } catch {
                /* ignore */
              }
              resolve(chunk.toString("utf8"));
            };
            try {
              proc.stdin.resume();
            } catch {
              /* ignore */
            }
            proc.stdin.on("data", onData);
          });
        };
      }
      return runInit(
        {
          ...(mode.reset !== undefined ? { reset: mode.reset } : {}),
          ...(mode.update ? { update: mode.update } : {}),
          ...(mode.sweep ? { sweep: mode.sweep } : {}),
          ...(mode.migrate ? { migrate: mode.migrate } : {}),
          ...(mode.vacuum ? { vacuum: mode.vacuum } : {}),
          ...(mode.yes ? { yes: mode.yes } : {}),
        },
        {
          stdout: proc.stdout,
          stderr: proc.stderr,
          cwd: proc.cwd(),
          isTty: Boolean(proc.stdin.isTTY),
          ...(readLine ? { readLine } : {}),
        },
      );
    }
    case "doctor": {
      // `doctor` needs no model and no session; it binds to the host-level
      // `doctorConfigHome` exactly as `init` binds to `initConfigHome` (§2.1).
      return runDoctorCommand(
        {
          ...(mode.offline ? { offline: mode.offline } : {}),
          ...(mode.json ? { json: mode.json } : {}),
        },
        { stdout: proc.stdout, stderr: proc.stderr, cwd: proc.cwd() },
      );
    }
    case "access": {
      // `access` needs no model and no session; it binds to the host-level
      // `accessReportConfigHome` exactly as `doctor` binds to `doctorConfigHome`
      // (§2.1, §7.4). Read-only: it prints the effective-permissions block and
      // exits without a model call, a network request, or a durable session.
      return runAccessCommand(
        { ...(mode.enableWrite ? { enableWrite: mode.enableWrite } : {}) },
        { stdout: proc.stdout, stderr: proc.stderr, cwd: proc.cwd() },
      );
    }
    case "export": {
      // `export` renders a stored session as a sanitized document (core §10.13):
      // no model, no network, no session turn. It boots the core read-only to
      // reach the stored session, calls the HOST-ONLY `session.export`, and maps
      // the result to an exit code (0 / 2 usage like doctor/access).
      return runExportCommand(
        {
          id: mode.id,
          ...(mode.format ? { format: mode.format } : {}),
          ...(mode.out ? { out: mode.out } : {}),
          ...(mode.noToolResults ? { noToolResults: mode.noToolResults } : {}),
        },
        {
          stdout: proc.stdout,
          stderr: proc.stderr,
          cwd: proc.cwd(),
          boot: (opts) => bootCore(opts),
        },
      );
    }
    case "stats": {
      // `stats` needs no model and no session turn; it boots the core only to
      // reach the stored trails, prints the aggregate cost/token/time report,
      // then shuts down (core §10.14). Read-only: no model call, no network, no
      // session start, never prints a secret.
      return runStatsCommand(
        {
          ...(mode.days !== undefined ? { days: mode.days } : {}),
          ...(mode.model !== undefined ? { model: mode.model } : {}),
          ...(mode.agent !== undefined ? { agent: mode.agent } : {}),
          ...(mode.json ? { json: mode.json } : {}),
        },
        {
          stdout: proc.stdout,
          stderr: proc.stderr,
          cwd: proc.cwd(),
          boot: (workspaceRoot) => bootCore({ workspaceRoot, output: (t) => proc.stdout.write(t) }),
        },
      );
    }
    case "prompt": {
      // Resolve a forced-file usage error before boot (§2.3, §2.4).
      const deps = fileResolveDeps(2000);
      if (mode.arg.startsWith("@")) {
        const resolved = await resolvePrompt(mode.arg, deps);
        if (!resolved.ok) {
          proc.stderr.write(`Error: ${resolved.usageError}\n`);
          return EXIT.USAGE;
        }
      }
      const enableWrite = mode.enableWrite === true;
      if (!(await liveDirsClean())) return EXIT.STARTUP;
      printFirstRun();
      return runHeadless({
        boot: (startAgent?: string) =>
          bootCore({
            workspaceRoot: proc.cwd(),
            output: (t) => proc.stdout.write(t),
            ...(startAgent ? { startAgent } : {}),
          }),
        entry: { kind: "prompt", arg: mode.arg },
        resolveDeps: deps,
        streams: { stdout: proc.stdout, stderr: proc.stderr },
        enableWrite,
        proc,
      });
    }
    case "routine": {
      const enableWrite = mode.enableWrite === true;
      if (!(await liveDirsClean())) return EXIT.STARTUP;
      printFirstRun();
      return runHeadless({
        boot: (startAgent?: string) =>
          bootCore({
            workspaceRoot: proc.cwd(),
            output: (t) => proc.stdout.write(t),
            ...(startAgent ? { startAgent } : {}),
          }),
        entry: { kind: "routine", id: mode.id },
        resolveDeps: fileResolveDeps(2000),
        streams: { stdout: proc.stdout, stderr: proc.stderr },
        enableWrite,
        proc,
      });
    }
    case "routine-list": {
      // `voidrift --routine --list` — print saved routine ids with an 80-char
      // prompt preview and exit 0 (routines §4, cli §2.2). Read-only: it boots a
      // core, routes `{ list: true }` to the routine command, prints, exits.
      if (!(await liveDirsClean())) return EXIT.STARTUP;
      printFirstRun();
      let ready: import("@voidrift/core").CoreReady;
      try {
        ready = await bootCore({ workspaceRoot: proc.cwd(), output: (t) => proc.stdout.write(t) });
      } catch {
        return EXIT.STARTUP;
      }
      try {
        proc.stderr.write(`voidrift: session (none — listing routines)\n`);
        const res = await ready.api.session.command("routine", { list: true });
        if (!res.ok) {
          proc.stderr.write(`voidrift: ${res.error.message}\n`);
          return EXIT.FAILED;
        }
        const rows = (res.value as { routines?: { id: string; preview: string }[] }).routines ?? [];
        for (const r of rows) {
          const preview = r.preview.replace(/\s+/g, " ").slice(0, 80);
          proc.stdout.write(`${r.id}\t${preview}\n`);
        }
        return EXIT.COMPLETED;
      } finally {
        await ready.api.session.shutdown().catch(() => undefined);
      }
    }
    case "chat": {
      if (!(await liveDirsClean())) return EXIT.STARTUP;
      printFirstRun();
      // The once-per-day interactive notice for out-of-date seeded defaults
      // (§5.5). Interactive only; never in a headless run. Skipped on a first
      // run (nothing is stale yet). Best-effort: never blocks startup.
      if (!isFirstRun()) {
        const { maybeShowUpdateNotice } = await import("./update-notice.js");
        await maybeShowUpdateNotice({ stderr: proc.stderr });
      }
      const { runTui } = await import("./tui.js");
      return runTui({
        workspaceRoot: proc.cwd(),
        ...(mode.resume ? { resume: mode.resume } : {}),
        ...(mode.forceNew ? { forceNew: mode.forceNew } : {}),
        proc,
      });
    }
  }
}

// Execute when invoked directly (the `voidrift` bin), not when imported. Compare
// REALPATHS so an npm bin symlink and paths with spaces/special chars resolve
// correctly (see entrypoint.ts for why the old string compare was broken).
//
// FX-C — a short headless run must deliver its telemetry before exit. The fix is
// at the ROOT: each exporter's `flush()` now awaits the underlying HTTP send
// (bounded by a 5 s cap), and `session.shutdown()` awaits the obs writer's close
// (which drains every registered exporter). `runHeadless`/`main` already `await`
// `session.shutdown()` before resolving — so by the time `main()` resolves NO
// flush is pending (the sends have completed) and `process.exit` drops nothing.
if (isEntrypoint(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(EXIT.STARTUP));
}
