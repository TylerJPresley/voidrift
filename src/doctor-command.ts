/**
 * `voidrift doctor` — validate every resource and its configuration, read-only
 * (cli-blueprint.md §2.1; core-blueprint.md §13.9.2).
 *
 * `doctor` is a top-level COMMAND like `init`, bound to the HOST-LEVEL
 * `doctorConfigHome` the core exports (§13.9): it runs WITHOUT booting a core,
 * needing a model, or starting a session — a doctor run on a broken, model-less
 * install is its main use. It never calls a model and writes nothing.
 *
 * Output (§13.9.2): the default is NO_COLOR-safe grouped plain text — a header,
 * then per group a title and one line per finding `[ok]`/`[warn]`/`[FAIL]`
 * followed by an indented `fix:` line, then the summary `N ok, N warn, N fail`.
 * `--json` prints exactly one JSON document of the DoctorReport and nothing
 * else. The exit code is 0 (no fail) or 1 (any fail); exit 3 only for an
 * unexpected crash of doctor itself.
 */
import { doctorConfigHome, type DoctorReport, type DoctorFinding } from "@voidrift/core";
import { EXIT } from "./exit-codes.js";
import { sanitize } from "./render/theme.js";

/** The streams/process surface `doctor` touches, injected so tests drive it. */
export interface DoctorDeps {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
  /** The host doctor runner (injected for tests; defaults to the core export). */
  run?: typeof doctorConfigHome;
}

const STATUS_TAG: Record<DoctorFinding["status"], string> = {
  ok: "[ok]",
  warn: "[warn]",
  fail: "[FAIL]",
};

/**
 * Sanitize every config-origin string field of the report (§4 terminal-escape
 * defence): messages, fixes, and file paths carry agent names, rule patterns,
 * and probe reasons that originate OUTSIDE the CLI. `sanitize` strips ANSI/
 * control/bidi so a hostile config cannot inject a terminal sequence or reorder
 * the display — in the text renderer AND in `--json` (the document stays valid
 * JSON containing only the report). Statuses/ids/counts are CLI-fixed and left.
 */
function sanitizeReport(report: DoctorReport): DoctorReport {
  return {
    ...report,
    groups: report.groups.map((g) => ({
      ...g,
      title: sanitize(g.title),
      findings: g.findings.map((f) => ({
        ...f,
        message: sanitize(f.message),
        ...(f.fix !== undefined ? { fix: sanitize(f.fix) } : {}),
        ...(f.file !== undefined ? { file: sanitize(f.file) } : {}),
      })),
    })),
  };
}

/** Render the full report as NO_COLOR-safe grouped plain text (§13.9.2). Every
 * config-origin string is sanitized first (§4 terminal-escape defence). */
export function renderText(report: DoctorReport): string {
  const safe = sanitizeReport(report);
  const lines: string[] = ["voidrift doctor — resource and configuration check", ""];
  for (const group of safe.groups) {
    lines.push(`${group.title}:`);
    for (const f of group.findings) {
      lines.push(`  ${STATUS_TAG[f.status]} ${f.message}`);
      if (f.status !== "ok" && f.fix) lines.push(`      fix: ${f.fix}`);
    }
    lines.push("");
  }
  const { ok, warn, fail } = safe.summary;
  lines.push(`${ok} ok, ${warn} warn, ${fail} fail`);
  return lines.join("\n");
}

/** Run `voidrift doctor` and return the process exit code (§2.1, §13.9.2). */
export async function runDoctorCommand(
  opts: { offline?: boolean; json?: boolean },
  deps: DoctorDeps,
): Promise<number> {
  const run = deps.run ?? doctorConfigHome;
  let report: DoctorReport;
  try {
    report = await run({ ...(opts.offline ? { offline: true } : {}), workspaceRoot: deps.cwd });
  } catch (e) {
    // An unexpected crash of doctor itself → exit 3 (§13.9.2); never 0/1.
    deps.stderr.write(`Error: doctor failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.STARTUP;
  }
  if (opts.json) {
    deps.stdout.write(JSON.stringify(sanitizeReport(report)) + "\n");
  } else {
    deps.stdout.write(renderText(report) + "\n");
  }
  return report.exitCode === 1 ? EXIT.FAILED : EXIT.COMPLETED;
}
