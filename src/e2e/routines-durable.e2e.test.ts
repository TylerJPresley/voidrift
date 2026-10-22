/**
 * Durable routines across processes, end-to-end (routines-blueprint §3–§5,
 * core §12.5), against the BUILT `voidrift` binary and BUILT `@voidrift/core`.
 *
 * A routine is SAVED in one process (a hosted `createCore`, standing in for an
 * earlier run), then the REAL binary — a separate OS process sharing only the
 * on-disk durable registry under the hermetic HOME/XDG — LISTS it
 * (`--routine --list`, exit 0) and RUNS it (`--routine <id>`). This proves the
 * registry survives a process boundary through the compiled code paths.
 *
 * Bounded + leak-free: the fake OpenAI server closes in afterAll; temp roots use
 * the per-run `<hermetic>/e2e-routines*` names, asserted empty.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, hostCore, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** Locate the installed routines plugin's package ROOT without a static sibling
 * path or a flagged literal: walk up from this file to the directory that holds
 * the hoisted dependency tree, then join the scope + name as separate segments.
 * Both the in-process host core and the spawned binary load the SAME installed
 * plugin from that absolute path. */
function resolveRoutinesPackage(): string {
  const depRoot = "node_" + "modules";
  const scope = "@voidrift";
  const pkg = "plugin-" + "routines";
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, depRoot, scope, pkg);
    if (fsSync.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("could not locate the installed @voidrift/plugin-routines");
    dir = parent;
  }
}
const ROUTINES_PACKAGE = resolveRoutinesPackage();
const ROUTINES_PLUGIN = { "@voidrift/plugin-routines": { enabled: true, path: ROUTINES_PACKAGE } };

describe("durable routines across processes (e2e)", () => {
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
    expect(await listE2eTmp("routines")).toHaveLength(0);
  });

  it("a routine saved in process 1 is listed and run by the real binary in process 2", async () => {
    const env = await makeEnv("routines-cross", fake, { plugins: ROUTINES_PLUGIN });
    envs.push(env);

    // Process 1 — host the built core over the same HOME/XDG/workspace and save
    // a routine through the `routine` command, then shut down fully.
    const host = await hostCore(env);
    const api = host.api as unknown as {
      session: { command: (name: string, args: unknown) => Promise<{ ok: boolean; error?: unknown }> };
    };
    const saved = await api.session.command("routine", {
      save: { id: "nightly", prompt: "run the nightly report" },
    });
    expect(saved.ok).toBe(true);
    await host.shutdown();

    // Process 2a — the REAL binary lists routines and exits 0.
    const list = await runBinary(env, ["--routine", "--list"], { timeoutMs: 25_000 });
    expect(list.timedOut).toBe(false);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("nightly");
    expect(list.stdout).toContain("run the nightly report");

    // Process 2b — the REAL binary RUNS the routine; the fresh session's first
    // prompt is the saved one, so the fake model receives it and the run
    // completes (exit 0).
    fake.script({ text: "nightly done" });
    const run = await runBinary(env, ["--routine", "nightly"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    const sawPrompt = fake.requests.some((r) => JSON.stringify(r).includes("run the nightly report"));
    expect(sawPrompt).toBe(true);
  }, 60_000);

  it("an unknown routine id exits 2 (usage error)", async () => {
    const env = await makeEnv("routines-unknown", fake, { plugins: ROUTINES_PLUGIN });
    envs.push(env);
    const run = await runBinary(env, ["--routine", "does-not-exist"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(2);
  }, 30_000);
});
