/**
 * `voidrift stats` and the `/stats` panel renderer (cli-blueprint.md §2.1, §7.2,
 * core §10.14, §11.9).
 *
 * `stats` is a top-level COMMAND like `doctor`/`access`: it prints the aggregate
 * cost/token/time report across this workspace's stored session trails and
 * exits. It reads local data only — no model call, no network, no session start
 * (it boots the core to reach the stored trails but never sends a turn). Plain
 * NO_COLOR-safe table by default; `--json` prints exactly one `StatsReport`
 * document and nothing else. Every value is already masked by the core (§10.10).
 *
 * `renderStatsTable` and `statsPanelRows` are shared projections of a
 * `StatsReport`: the CLI command renders the table, and the `/stats` panel
 * renders the live single-session report from `models.stats()` through
 * `statsPanelRows`. An estimated bucket is marked `~`.
 */
import type { CoreReady, StatsReport, StatsBucket } from "@voidrift/core";
import { EXIT } from "./exit-codes.js";
import { sanitize } from "./render/theme.js";

/** The streams/process surface `stats` touches, injected so tests drive it. */
export interface StatsDeps {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
  /** Boot the core to reach the stored trails (injected for tests). */
  boot: (workspaceRoot: string) => Promise<CoreReady>;
}

/** Round a number for display; integers print bare, else to one decimal. */
function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** The token/time cells for a bucket, marking an estimated bucket with `~`. */
function bucketCells(b: StatsBucket): string[] {
  const mark = b.estimatedTurns > 0 ? "~" : "";
  const tok = `${mark}${n(b.tokensTotal)}`;
  const tps = b.tokensPerSecond !== undefined ? n(b.tokensPerSecond) : "—";
  const cost = b.cost !== undefined ? `$${b.cost.toFixed(4)}` : "";
  return [
    n(b.turns),
    n(b.toolCalls),
    n(b.toolErrors),
    tok,
    n(b.tokensIn),
    n(b.tokensOut),
    n(b.tokensCacheRead),
    n(b.wallMs),
    tps,
    cost,
  ];
}

const HEADER = ["turns", "tools", "errs", "tok", "in", "out", "cache", "ms", "tok/s", "cost"];

/** Render a plain NO_COLOR-safe table of a `StatsReport` (§10.14). The money
 * column is empty when no price is configured; estimated figures are marked
 * `~`. */
export function renderStatsTable(report: StatsReport): string {
  const L: string[] = [];
  const scope = report.scope === "aggregate" ? "workspace (aggregate)" : "session";
  L.push(`VoidRift stats — ${scope}${report.since ? ` since ${sanitize(report.since)}` : ""}`);
  L.push("");

  const row = (label: string, b: StatsBucket): string => {
    const cells = [sanitize(label).padEnd(22), ...bucketCells(b).map((c, i) => c.padStart(HEADER[i]!.length))];
    return cells.join("  ");
  };
  const head = ["".padEnd(22), ...HEADER.map((h) => h.padStart(h.length))].join("  ");

  L.push(head);
  L.push(row("TOTAL", report.totals));
  L.push("");

  const section = (title: string, map: Record<string, StatsBucket>): void => {
    const keys = Object.keys(map).sort();
    if (keys.length === 0) return;
    L.push(`${title}:`);
    L.push(head);
    for (const k of keys) L.push(row(k, map[k]!));
    L.push("");
  };
  section("by model", report.byModel);
  section("by agent", report.byAgent);
  section("by day", report.byDay);

  L.push("`~` marks a figure resting on the harness estimate; an empty cost column means no price is configured.");
  return L.join("\n");
}

/** Project a `StatsReport` into `{label,value}` rows for the `/stats` panel
 * (§7.2): a tokens block, turns, tool calls/errors, wall time, tokens/second,
 * the money column only when priced, and the by-model/by-agent rollup. An
 * estimated bucket is marked. */
export function statsPanelRows(report: StatsReport): { label: string; value: string }[] {
  const t = report.totals;
  const estMark = t.estimatedTurns > 0 ? " ~" : "";
  const rows: { label: string; value: string }[] = [
    { label: "turns", value: `${n(t.turns)}${t.estimatedTurns > 0 ? ` (${n(t.estimatedTurns)} est)` : ""}` },
    { label: "tool calls", value: n(t.toolCalls) },
    { label: "tool errors", value: n(t.toolErrors) },
    { label: "tokens in", value: `${n(t.tokensIn)}${estMark}` },
    { label: "tokens out", value: `${n(t.tokensOut)}${estMark}` },
    { label: "tokens cache-read", value: n(t.tokensCacheRead) },
    { label: "tokens total", value: `${n(t.tokensTotal)}${estMark}` },
    { label: "wall time (ms)", value: n(t.wallMs) },
    { label: "tokens/second", value: t.tokensPerSecond !== undefined ? n(t.tokensPerSecond) : "—" },
    { label: "cost", value: t.cost !== undefined ? `$${t.cost.toFixed(4)}` : "(no price configured)" },
  ];
  for (const k of Object.keys(report.byModel).sort()) {
    const b = report.byModel[k]!;
    rows.push({ label: `model: ${sanitize(k)}`, value: `${n(b.tokensTotal)} tok, ${n(b.turns)} turns${b.cost !== undefined ? `, $${b.cost.toFixed(4)}` : ""}` });
  }
  for (const k of Object.keys(report.byAgent).sort()) {
    const b = report.byAgent[k]!;
    rows.push({ label: `agent: ${sanitize(k)}`, value: `${n(b.tokensTotal)} tok, ${n(b.turns)} turns` });
  }
  return rows;
}

/**
 * Run `voidrift stats [--days N] [--model <name>] [--agent <name>] [--json]`
 * and return the process exit code (§2.1, §10.14). Reads local trails only; no
 * model call, no network, no session start. `--json` prints exactly one
 * `StatsReport` document to stdout. Exit 0 on success, 3 on a startup failure.
 */
export async function runStatsCommand(
  opts: { days?: number; model?: string; agent?: string; json?: boolean },
  deps: StatsDeps,
): Promise<number> {
  let ready: CoreReady;
  try {
    ready = await deps.boot(deps.cwd);
  } catch (e) {
    deps.stderr.write(`Error: stats failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.STARTUP;
  }
  try {
    const query: { days?: number; model?: string; agent?: string } = {};
    if (opts.days !== undefined) query.days = opts.days;
    if (opts.model !== undefined) query.model = opts.model;
    if (opts.agent !== undefined) query.agent = opts.agent;
    const res = await ready.api.observability.stats(query);
    if (!res.ok) {
      deps.stderr.write(`Error: ${res.error.message}\n`);
      return EXIT.STARTUP;
    }
    if (opts.json) {
      deps.stdout.write(JSON.stringify(res.value) + "\n");
    } else {
      deps.stdout.write(renderStatsTable(res.value) + "\n");
    }
    return EXIT.COMPLETED;
  } catch (e) {
    deps.stderr.write(`Error: stats failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.STARTUP;
  } finally {
    await ready.api.session.shutdown().catch(() => undefined);
  }
}
