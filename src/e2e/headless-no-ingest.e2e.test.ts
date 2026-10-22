/**
 * HEADLESS-NO-INGEST — the documented guarantee (core-blueprint.md §3.3/§8.7):
 * a HEADLESS run must NOT start the background project-instructions ingest
 * fan-out (the process may exit before it finishes and write nothing). The
 * real-router recheck caught the gap: with an oversized AGENTS.md a headless
 * `hello` STILL kicked the fan-out (dozens of worker.status events, summarizer
 * requests, a digest written) because the boot seam read the STATIC
 * `startSessionApprovalMode` (undefined on the headless CLI path, which fixes
 * `headless` only AFTER boot via `setLaunchDefaults`), not the LIVE posture.
 *
 * The fix makes the seam read the live approval mode (`api.liveApprovalMode()`),
 * so every embedding is right. This exercises the BUILT binary end-to-end:
 *   - a headless `--prompt` run over an oversized AGENTS.md makes ZERO
 *     summarizer (non-stream worker) requests and writes NO ingest digest;
 *   - an INTERACTIVE pty run over the SAME workspace DOES start the background
 *     fan-out (a digest lands in the ingest cache).
 *
 * Bounded + leak-free: the fake closes in afterAll, temp roots asserted empty.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** An oversized AGENTS.md: well over `fitFraction × budget` with a small
 * contextLimit, so the project-instructions head is a digest (a fan-out), not a
 * whole load. */
function bigAgents(sections: number, charsPerSection: number): string {
  const parts: string[] = ["# Project\n"];
  for (let i = 0; i < sections; i++) parts.push(`## Section ${i}\n` + "x".repeat(charsPerSection) + "\n");
  return parts.join("\n");
}

function hasPython3(): boolean {
  const r = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { stdio: "ignore" });
  return r.status === 0;
}
const HARNESS = path.resolve(fileURLToPath(new URL("./pty-harness.py", import.meta.url)));
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));
const py3 = hasPython3();

/** Count summarizer-shaped worker requests: a dispatched worker calls the model
 * NON-streaming (`stream !== true`), unlike the orchestrator's SSE turns. */
function nonStreamRequests(fake: FakeOpenAI): number {
  return fake.requests.filter((r) => r.body.stream !== true).length;
}

/**
 * The oversized config that forces the project-instructions DIGEST decision
 * while leaving room for the orchestrator's OWN turn to be sent.
 *
 * The pre-flight estimate (core §4.8 `preflightEstimate`) is the assembled
 * system prompt + bound tool schemas + chain + new message + a FIXED
 * `context.estimateMarginTokens` (2000) margin; the turn is refused when that
 * plus the output reservation (1024) exceeds `contextLimit`. The window must
 * therefore clear the agent's own prompt+schemas (which grow as prompts and
 * tool descriptions are tuned) + 2000 margin + 1024 reservation — NOT a tight
 * 4000 that the 2000 margin alone nearly fills. `contextLimit: 16000` gives that
 * headroom; the test's guarantee is unchanged.
 *
 * `fitFraction: 0.01` keeps the project-instructions head budget tiny
 * (`fitFraction × window` ≈ 160 tokens) so the oversized AGENTS.md (~3k tokens)
 * STILL exceeds it and STILL takes the digest path — the exact scenario under
 * test (headless must make ZERO summarizer requests and write NO digest).
 */
function smallCfg(fake: FakeOpenAI): Record<string, unknown> {
  return {
    models: { local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 16000 } },
    modelSelected: "local",
    limits: { ingest: { fitFraction: 0.01, chunkTargetTokens: 300 } },
  };
}

describe("headless suppresses the background project-instructions ingest (e2e)", () => {
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
    expect(await listE2eTmp("headless-no-ingest")).toHaveLength(0);
  });

  it("HEADLESS: an oversized AGENTS.md makes ZERO summarizer requests and writes no digest", async () => {
    const env = await makeEnv("headless-no-ingest", fake, smallCfg(fake));
    envs.push(env);
    await fs.writeFile(path.join(env.workspace, "AGENTS.md"), bigAgents(8, 1500));

    // The headless run answers in ONE orchestrator turn; no fan-out should run.
    fake.script({ text: "hello back" });
    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 60_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);

    // ZERO non-stream (worker) requests — the background fan-out never started.
    expect(nonStreamRequests(fake)).toBe(0);
    // No ingest digest written.
    const cacheDir = path.join(env.workspace, ".voidrift", "cache", "ingest");
    const cached = existsSync(cacheDir) ? await fs.readdir(cacheDir) : [];
    expect(cached).toHaveLength(0);
  }, 90_000);

  (py3 ? it : it.skip)("INTERACTIVE: the SAME oversized AGENTS.md DOES start the background fan-out", async () => {
    const env = await makeEnv("headless-no-ingest", fake, smallCfg(fake));
    envs.push(env);
    await fs.writeFile(path.join(env.workspace, "AGENTS.md"), bigAgents(8, 1500));

    // An interactive turn answers once; the summarizer map/reduce fan-out runs
    // in the background and writes a digest. Script generously so the fan-out
    // has replies regardless of chunk count.
    fake.always({ text: "SUMMARY" });

    await new Promise<void>((resolve) => {
      const child = spawn("python3", [HARNESS, JSON.stringify({
        cli: CLI_DIST,
        cwd: env.workspace,
        env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
        prompt: "hello",
        reply: "SUMMARY",
        fullSequence: false,
        exitMode: "keys",
        timeoutMs: 40_000,
      })], { maxBuffer: 32 * 1024 * 1024 } as never);
      const timer = setTimeout(() => child.kill("SIGKILL"), 48_000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Give the fire-and-forget background fan-out a moment to flush its digest.
    const cacheDir = path.join(env.workspace, ".voidrift", "cache", "ingest");
    let cached: string[] = [];
    for (let i = 0; i < 40 && cached.length === 0; i++) {
      cached = existsSync(cacheDir) ? await fs.readdir(cacheDir) : [];
      if (cached.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(cached.length).toBeGreaterThan(0);
  }, 90_000);
});
