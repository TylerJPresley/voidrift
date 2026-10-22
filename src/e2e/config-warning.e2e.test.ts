/**
 * Real-binary end-to-end test for Slice C2c: a config warning (an IGNORED
 * project `unlock`) must be VISIBLE at startup, not silent (core-blueprint
 * §13.5/§13.10; cli-blueprint §2.1, §8.3).
 *
 * A project `.voidrift/config.json` that sets `unlock` is honored only from the
 * global/managed layer, so its value is dropped — but the drop must be reported:
 * the core retains the warning and the CLI prints one `voidrift: warning:` stderr
 * line at startup (before the `voidrift: session <id>` line). The warning never
 * changes the exit code, and stdout stays the model text only.
 *
 * This runs the BUILT binary with an isolated HOME/XDG and a working fake model
 * (via `makeEnv`), and asserts:
 *   - a project `{"unlock":["x"]}` produces a `voidrift: warning:` line naming
 *     the project config path and the key `unlock` (never the value), exit 0,
 *     and stdout is the model text only;
 *   - a clean project config prints no warning line.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("config warning: an ignored project unlock is visible at startup (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });

  afterEach(async () => {
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
    while (envs.length) await envs.pop()!.cleanup();
  });

  afterAll(async () => {
    await fake.close();
    expect(await listE2eTmp("config-warning")).toHaveLength(0);
  });

  it("prints one `voidrift: warning:` line naming the project config path and `unlock`; exit 0; stdout is model text only", async () => {
    // A project layer whose `unlock` is honored only from global/managed → ignored.
    const env = await makeEnv("config-warning-ignored", fake, { unlock: ["power-state"] });
    envs.push(env);
    const projectConfig = path.join(env.workspace, ".voidrift", "config.json");
    fake.script({ text: "MODEL-REPLY" });

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 25_000 });

    expect(run.timedOut).toBe(false);
    // A warning never changes the exit code — a clean run still exits 0.
    expect(run.code).toBe(0);

    // One value-free warning line names the project config file and the key.
    expect(run.stderr).toContain("voidrift: warning:");
    expect(run.stderr).toContain(projectConfig);
    expect(run.stderr).toContain("unlock");
    // EXACTLY ONE warning line (Slice C2d): the session layer no longer re-reads
    // the project config, so a project `unlock` warns once — not twice.
    const warningLines = run.stderr.split("\n").filter((l) => l.includes("voidrift: warning:"));
    expect(warningLines).toHaveLength(1);
    // Never the ignored VALUE.
    expect(run.stderr).not.toContain("power-state");
    // The warning precedes the session line (§8.3 ordering).
    const warnAt = run.stderr.indexOf("voidrift: warning:");
    const sessionAt = run.stderr.indexOf("voidrift: session ");
    expect(warnAt).toBeGreaterThanOrEqual(0);
    expect(sessionAt).toBeGreaterThan(warnAt);

    // stdout carries the model text ONLY (no warning, no status line).
    expect(run.stdout).toContain("MODEL-REPLY");
    expect(run.stdout).not.toContain("voidrift: warning:");
    expect(run.stdout).not.toContain("voidrift: session ");
  }, 30_000);

  it("a clean project config prints no warning line", async () => {
    const env = await makeEnv("config-warning-clean", fake, {});
    envs.push(env);
    fake.script({ text: "OK" });

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 25_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("voidrift: warning:");
    expect(run.stdout).toContain("OK");
  }, 30_000);
});
