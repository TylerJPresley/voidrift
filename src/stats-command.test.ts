/**
 * `voidrift stats` command + `/stats` panel renderer tests (cli-blueprint.md
 * §2.1, §7.2, core §10.14). The runner reads local trails only (a fake core),
 * prints a single JSON document with `--json`, a plain table otherwise, and
 * exits 0; the renderers mark estimated figures `~` and leave the money column
 * empty when no price is configured.
 */
import { describe, it, expect } from "vitest";
import type { StatsReport } from "@voidrift/core";
import { runStatsCommand, renderStatsTable, statsPanelRows } from "./stats-command.js";
import { EXIT } from "./exit-codes.js";

function report(over?: Partial<StatsReport>): StatsReport {
  return {
    scope: "aggregate",
    totals: { turns: 2, toolCalls: 3, toolErrors: 1, tokensIn: 300, tokensOut: 130, tokensCacheRead: 10, tokensTotal: 430, wallMs: 5000, genMs: 1500, estimatedTurns: 0, tokensPerSecond: 86, cost: 0.4 },
    byModel: { cloud: { turns: 1, toolCalls: 1, toolErrors: 0, tokensIn: 100, tokensOut: 50, tokensCacheRead: 10, tokensTotal: 150, wallMs: 2000, genMs: 666, estimatedTurns: 0, tokensPerSecond: 75, cost: 0.3 } },
    byAgent: { chat: { turns: 2, toolCalls: 3, toolErrors: 1, tokensIn: 300, tokensOut: 130, tokensCacheRead: 10, tokensTotal: 430, wallMs: 5000, genMs: 1500, estimatedTurns: 0 } },
    byDay: { "2026-10-19": { turns: 2, toolCalls: 3, toolErrors: 1, tokensIn: 300, tokensOut: 130, tokensCacheRead: 10, tokensTotal: 430, wallMs: 5000, genMs: 1500, estimatedTurns: 0 } },
    ...over,
  };
}

function fakeCore(r: StatsReport, calls: { stats: unknown[]; shutdown: number }) {
  return {
    api: {
      observability: {
        stats: async (opts?: unknown) => {
          calls.stats.push(opts);
          return { ok: true as const, value: r };
        },
      },
      session: { shutdown: async () => void (calls.shutdown += 1) },
    },
  } as unknown as import("@voidrift/core").CoreReady;
}

function streams() {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    out,
    errs,
    stdout: { write: (s: string) => void out.push(s) },
    stderr: { write: (s: string) => void errs.push(s) },
  };
}

describe("§10.14 — voidrift stats", () => {
  it("--json prints exactly one JSON StatsReport document and nothing else, exit 0", async () => {
    const r = report();
    const calls = { stats: [] as unknown[], shutdown: 0 };
    const s = streams();
    const code = await runStatsCommand({ json: true }, { stdout: s.stdout, stderr: s.stderr, cwd: "/w", boot: async () => fakeCore(r, calls) });
    expect(code).toBe(EXIT.COMPLETED);
    expect(s.out).toHaveLength(1);
    const doc = JSON.parse(s.out[0]!.trim()) as StatsReport;
    expect(doc.scope).toBe("aggregate");
    expect(doc.totals.tokensTotal).toBe(430);
    expect(s.errs).toHaveLength(0);
    expect(calls.shutdown).toBe(1);
  });

  it("the plain run prints a legible table with the money column present when priced", async () => {
    const r = report();
    const calls = { stats: [] as unknown[], shutdown: 0 };
    const s = streams();
    const code = await runStatsCommand({}, { stdout: s.stdout, stderr: s.stderr, cwd: "/w", boot: async () => fakeCore(r, calls) });
    expect(code).toBe(EXIT.COMPLETED);
    const text = s.out.join("");
    expect(text).toContain("VoidRift stats");
    expect(text).toContain("TOTAL");
    expect(text).toContain("$0.4000");
  });

  it("passes --days/--model/--agent through to observability.stats", async () => {
    const calls = { stats: [] as unknown[], shutdown: 0 };
    const s = streams();
    await runStatsCommand(
      { days: 7, model: "local", agent: "chat", json: true },
      { stdout: s.stdout, stderr: s.stderr, cwd: "/w", boot: async () => fakeCore(report(), calls) },
    );
    expect(calls.stats[0]).toEqual({ days: 7, model: "local", agent: "chat" });
  });

  it("renderStatsTable leaves the money column empty when no price is configured and marks estimated figures", () => {
    const r = report({
      totals: { turns: 1, toolCalls: 0, toolErrors: 0, tokensIn: 100, tokensOut: 40, tokensCacheRead: 0, tokensTotal: 140, wallMs: 1000, genMs: 0, estimatedTurns: 1 },
      byModel: {},
      byAgent: {},
      byDay: {},
    });
    const text = renderStatsTable(r);
    expect(text).not.toContain("$");
    expect(text).toContain("~140");
  });

  it("statsPanelRows renders the tokens block, turns, tool calls/errors, wall time, tok/s and the money column only when priced", () => {
    const rows = statsPanelRows(report());
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["turns"]).toBe("2");
    expect(byLabel["tool errors"]).toBe("1");
    expect(byLabel["tokens total"]).toBe("430");
    expect(byLabel["wall time (ms)"]).toBe("5000");
    expect(byLabel["cost"]).toBe("$0.4000");
    expect(byLabel["model: cloud"]).toContain("$0.3000");
  });

  it("marks a bucket's token cell with ~ only when it has estimated turns (both cases)", () => {
    // Unestimated: no mark.
    const unest = report({
      totals: { turns: 2, toolCalls: 0, toolErrors: 0, tokensIn: 100, tokensOut: 40, tokensCacheRead: 0, tokensTotal: 140, wallMs: 1000, genMs: 0, estimatedTurns: 0 },
      byModel: {}, byAgent: {}, byDay: {},
    });
    const unmarked = renderStatsTable(unest);
    expect(unmarked).toContain(" 140");
    expect(unmarked).not.toContain("~140");
    // Estimated: marked.
    const est = report({
      totals: { turns: 2, toolCalls: 0, toolErrors: 0, tokensIn: 100, tokensOut: 40, tokensCacheRead: 0, tokensTotal: 140, wallMs: 1000, genMs: 0, estimatedTurns: 1 },
      byModel: {}, byAgent: {}, byDay: {},
    });
    expect(renderStatsTable(est)).toContain("~140");
  });

  it("statsPanelRows shows (no price configured) and an est turn count when unpriced/estimated", () => {
    const rows = statsPanelRows(report({
      totals: { turns: 1, toolCalls: 0, toolErrors: 0, tokensIn: 100, tokensOut: 40, tokensCacheRead: 0, tokensTotal: 140, wallMs: 1000, genMs: 0, estimatedTurns: 1 },
      byModel: {},
      byAgent: {},
    }));
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["cost"]).toBe("(no price configured)");
    expect(byLabel["turns"]).toContain("est");
  });
});
