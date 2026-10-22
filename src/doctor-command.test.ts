/**
 * `voidrift doctor` renderer (cli-blueprint.md §2.1; core §13.9.2).
 *
 * Text is NO_COLOR-safe grouped plain text; `--json` prints exactly one JSON
 * document and nothing else. Exit 0 (no fail) / 1 (any fail) / 3 (doctor crash).
 */
import { describe, it, expect } from "vitest";
import type { DoctorReport } from "@voidrift/core";
import { runDoctorCommand, renderText } from "./doctor-command.js";

function sink(): { out: string; err: string; stdout: { write(s: string): void }; stderr: { write(s: string): void } } {
  const o = { out: "", err: "" } as { out: string; err: string; stdout: { write(s: string): void }; stderr: { write(s: string): void } };
  o.stdout = { write: (s: string) => void (o.out += s) };
  o.stderr = { write: (s: string) => void (o.err += s) };
  return o;
}

const healthy: DoctorReport = {
  groups: [{ id: "config", title: "Config", findings: [{ id: "config.ok", status: "ok", message: "all layers valid" }] }],
  summary: { ok: 1, warn: 0, fail: 0 },
  exitCode: 0,
};
const broken: DoctorReport = {
  groups: [
    {
      id: "models",
      title: "Models",
      findings: [{ id: "models.none", status: "fail", message: "no model is configured", fix: "voidrift init" }],
    },
  ],
  summary: { ok: 0, warn: 0, fail: 1 },
  exitCode: 1,
};

describe("voidrift doctor command (§2.1, §13.9.2)", () => {
  it("text output is grouped plain text ending in the summary; exit 0", async () => {
    const s = sink();
    const code = await runDoctorCommand({}, { ...s, cwd: "/ws", run: async () => healthy });
    expect(code).toBe(0);
    expect(s.out).toContain("Config:");
    expect(s.out).toContain("[ok] all layers valid");
    expect(s.out.trimEnd().endsWith("1 ok, 0 warn, 0 fail")).toBe(true);
  });

  it("a fail finding prints an indented fix line and exits 1", async () => {
    const s = sink();
    const code = await runDoctorCommand({}, { ...s, cwd: "/ws", run: async () => broken });
    expect(code).toBe(1);
    expect(s.out).toContain("[FAIL] no model is configured");
    expect(s.out).toContain("      fix: voidrift init");
  });

  it("--json prints exactly one JSON document and nothing else on stdout", async () => {
    const s = sink();
    const code = await runDoctorCommand({ json: true }, { ...s, cwd: "/ws", run: async () => broken });
    expect(code).toBe(1);
    const trimmed = s.out.trim();
    const parsed = JSON.parse(trimmed) as DoctorReport;
    expect(parsed.exitCode).toBe(1);
    expect(parsed.groups[0]!.findings[0]!.fix).toBe("voidrift init");
    // No non-JSON text leaked to stdout.
    expect(trimmed.startsWith("{")).toBe(true);
    expect(trimmed.endsWith("}")).toBe(true);
  });

  it("passes offline through to the runner", async () => {
    const s = sink();
    let sawOffline = false;
    await runDoctorCommand(
      { offline: true },
      { ...s, cwd: "/ws", run: async (o) => ((sawOffline = o?.offline === true), healthy) },
    );
    expect(sawOffline).toBe(true);
  });

  it("an unexpected doctor crash exits 3 and writes to stderr", async () => {
    const s = sink();
    const code = await runDoctorCommand(
      {},
      {
        ...s,
        cwd: "/ws",
        run: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(code).toBe(3);
    expect(s.err).toContain("doctor failed: boom");
    expect(s.out).toBe("");
  });

  it("renderText is NO_COLOR-safe (no ANSI escapes)", () => {
    // eslint-disable-next-line no-control-regex
    expect(/\u001b\[/.test(renderText(broken))).toBe(false);
  });

  it("SANITIZE: ESC and bidi (U+202E) in config-origin strings never reach stdout (text and --json)", async () => {
    // A report whose message/fix/file carry an ESC CSI clear and a bidi override
    // (a rule pattern, an agent name, a file path originate OUTSIDE the CLI).
    const hostile: DoctorReport = {
      groups: [
        {
          id: "agents",
          title: "Agents",
          findings: [
            {
              id: "agents.evil",
              status: "fail",
              // ESC[2J (clear screen) + RLO bidi override in an agent name.
              message: "agent \u001b[2J\u202eevil\u202c named tool \u001b[31mx",
              fix: "remove \u202etool\u202c from agents/\u001b[2Kx/agent.json",
              file: "/ws/.voidrift/\u202eagents\u202c/x",
            },
          ],
        },
      ],
      summary: { ok: 0, warn: 0, fail: 1 },
      exitCode: 1,
    };
    // eslint-disable-next-line no-control-regex
    const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
    const text = renderText(hostile);
    expect(FORBIDDEN.test(text.replace(/[\n\t]/g, ""))).toBe(false);

    const s = sink();
    await runDoctorCommand({ json: true }, { ...s, cwd: "/ws", run: async () => hostile });
    // The JSON document is still valid and carries only the report.
    const parsed = JSON.parse(s.out.trim()) as DoctorReport;
    expect(parsed.exitCode).toBe(1);
    expect(FORBIDDEN.test(s.out.replace(/[\n\t]/g, ""))).toBe(false);
  });
});
