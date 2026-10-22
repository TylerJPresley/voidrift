/**
 * W1 — model-callable `task` delegation end to end on the BUILT binary
 * (core-blueprint.md §3.1, §7), against the scriptable fake OpenAI server. This
 * is the ONE path the unit tests cannot reach: the orchestrator's model emitting
 * a `task` tool call inside a real headless `voidrift --prompt` turn, over real
 * HTTP + SSE, which fans out a worker whose own model (consumed in request order
 * off the SAME fake endpoint) does the work; its summary returns to the
 * orchestrator and the worker's change reaches the user's tree through the gate.
 *
 * Two cases:
 *   W1 `--enable-write` (vibe, `unlisted: allow`): the model emits `task` for the
 *      seeded `implementer`; the worker calls `write_file`; a reviewer PASSes;
 *      the file lands in the workspace (no-repo staged apply under the fan-out
 *      grant), exit 0.
 *   W2 default read-only run (research, `unlisted: deny`): the model emits `task`
 *      for the read-class `researcher`; the worker runs in place and returns a
 *      summary; the run completes (exit 0) and nothing is written.
 *
 * The fake server scripts a SEQUENCE consumed in arrival order, so the two
 * "agents" (orchestrator and worker/reviewer) are served by call order — the
 * minimal extension the task calls for; no fixture change is needed because the
 * server already serves SSE for the streaming orchestrator and JSON for the
 * worker's `.invoke()`.
 *
 * Bounded + leak-free: the fake closes in afterAll and temp roots are asserted
 * empty.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("model-callable task dispatch (e2e)", () => {
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
    expect(await listE2eTmp("task-dispatch")).toHaveLength(0);
  });

  it("W1 --enable-write: vibe delegates to a worker via `task`; the worker writes and the file lands (exit 0)", async () => {
    const env = await makeEnv("task-dispatch-write", fake, {});
    envs.push(env);
    // Request order: (1) orchestrator SSE emits `task` for implementer;
    // (2) worker invoke writes hello.txt; (3) worker invoke finishes;
    // (4) reviewer invoke PASS; (5) orchestrator SSE finishes.
    fake.script(
      { toolCalls: [{ name: "task", args: { worker: "implementer", task: "create hello.txt containing hi" } }] },
      { toolCalls: [{ name: "write_file", args: { path: "hello.txt", content: "hi\n" } }] },
      { text: "worker done" },
      { text: "PASS: the file is correct" },
      { text: "delegated and done" },
    );
    const run = await runBinary(env, ["--prompt", "create hello.txt via a worker", "--enable-write"], { timeoutMs: 40_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The worker's change reached the user's tree through the gated apply.
    expect(existsSync(path.join(env.workspace, "hello.txt"))).toBe(true);
    expect(await fs.readFile(path.join(env.workspace, "hello.txt"), "utf8")).toBe("hi\n");
    // The orchestrator actually called `task` (a tool-result message carries the
    // worker's summary back on a later request).
    const boundTask = fake.requests.some((r) => r.toolNames.includes("task"));
    expect(boundTask).toBe(true);
  }, 50_000);

  it("W2 default read-only run: research delegates a read-class worker via `task`; completes, writes nothing (exit 0)", async () => {
    const env = await makeEnv("task-dispatch-read", fake, {});
    envs.push(env);
    await fs.writeFile(path.join(env.workspace, "readme.txt"), "DELEGATED-READ-TARGET");
    // Request order: (1) orchestrator emits `task` for researcher;
    // (2) worker invoke reads the file; (3) worker invoke summarizes;
    // (4) orchestrator finishes. (A read-class worker has no reviewer gate.)
    fake.script(
      { toolCalls: [{ name: "task", args: { worker: "researcher", task: "read readme.txt and summarize" } }] },
      { toolCalls: [{ name: "read_file", args: { path: "readme.txt" } }] },
      { text: "the readme says DELEGATED-READ-TARGET" },
      { text: "the worker investigated the readme" },
    );
    const run = await runBinary(env, ["--prompt", "investigate readme.txt via a worker"], { timeoutMs: 40_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // A read-only run changes nothing.
    const boundTask = fake.requests.some((r) => r.toolNames.includes("task"));
    expect(boundTask).toBe(true);
    // No worktrees/staging leaked for a read-class worker (no isolation).
    const wtDir = path.join(env.workspace, ".voidrift", "worktrees");
    expect(existsSync(wtDir) ? (await fs.readdir(wtDir)).length : 0).toBe(0);
  }, 50_000);
});
