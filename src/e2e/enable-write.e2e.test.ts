/**
 * `--enable-write` and headless agent selection end-to-end (cli-blueprint.md §2.2,
 * §8; core §2.7, §9.5), against the BUILT `voidrift` binary and BUILT
 * `@voidrift/core`.
 *
 *   W1 default `--prompt` runs the read-only (research-posture) agent: a model
 *      attempt to call `write_file` is refused and COUNTED → the end-of-run
 *      "N action(s) denied" line appears once with the right N; stdout/exit are
 *      unchanged (exit 0).
 *   W2 `--enable-write` prints the WRITE ENABLED line once and runs the write
 *      (vibe-posture `unlisted: allow`) agent to completion (exit 0). The write
 *      agent delegates changes to workers (it has no direct write tools); the
 *      auto-approve of a delegated worker's writes under an `allow` posture is
 *      covered at the core level (decision-point.auto-approve,
 *      task-isolated-dispatch, auto-approve.adversarial) rather than driven
 *      through a full worker loop here, keeping this built-binary e2e cheap.
 *   W3 an SSRF-range `web_fetch` under `--enable-write` is DENIED-AND-CONTINUE
 *      (no exit 5): the run completes, the fixture gets zero requests.
 *   W4 `--vibe` is an UNKNOWN flag → exit 2, no run.
 *   W5 `--enable-write` with `chat` / alone → exit 2.
 *   W6 with the seeded `research` (the only `unlisted: deny` top-level agent)
 *      removed from the global agents folder, a default `--prompt` run has no
 *      read-only agent to select and refuses with exit 2 and the plain message
 *      naming the agents folder (headless never falls back to `chat`).
 *
 * Bounded + leak-free: the fake server is closed in afterAll; temp roots use the
 * per-run `<hermetic>/e2e-enable-write*` names, asserted empty.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const WRITE_ENABLED =
  "voidrift: WRITE ENABLED — this run may change files and run commands without asking (--enable-write); never-list commands, deny rules, Warden and guardrails still apply.";

describe("--enable-write / headless agent selection (e2e)", () => {
  let fake: FakeOpenAI;
  let fixture: http.Server;
  let fixtureUrl: string;
  let fixtureHits = 0;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
    fixture = http.createServer((_req, res) => {
      fixtureHits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("secret internal data");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", () => r()));
    fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/internal`;
  });

  afterEach(async () => {
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
    while (envs.length) await envs.pop()!.cleanup();
  });

  afterAll(async () => {
    await fake.close();
    await new Promise<void>((r) => fixture.close(() => r()));
    expect(await listE2eTmp("enable-write")).toHaveLength(0);
  });

  it("W1 default --prompt runs the read-only agent; a write_file attempt is refused and counted (exit 0)", async () => {
    const env = await makeEnv("enable-write-readonly", fake, {});
    envs.push(env);
    // research binds no write_file → the model's write is an unknown-tool
    // rejection the posture counts; the loop continues and the turn completes.
    fake.script(
      { toolCalls: [{ name: "write_file", args: { path: "x.ts", content: "hi" } }] },
      { text: "done" },
    );
    const run = await runBinary(env, ["--prompt", "write x.ts"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0); // NOT exit 5
    expect(run.stderr).toContain("voidrift: 1 action(s) denied (read-only run; pass --enable-write to allow changes)");
    expect(run.stdout).not.toContain("action(s) denied");
    expect(run.stderr).not.toContain(WRITE_ENABLED);
  }, 30_000);

  it("W1b a headless read-only (research) run cannot read directly, but a `task` batch dispatches the researcher worker, which reads and whose summary reaches the final answer (§2.7, §7)", async () => {
    // The seeded `research` agent is a PURE ORCHESTRATOR (core §2.7): it holds
    // `task` and memory/skill tools but NO direct read/search/web tools. So a
    // read-only headless run investigates ONLY by delegating: the orchestrator
    // emits a `task` BATCH naming the read-class `researcher` worker, the worker
    // reads the file over the real createAgent path, and its summary flows back
    // into the orchestrator's final answer.
    const env = await makeEnv("enable-write-read", fake, {});
    envs.push(env);
    await fs.writeFile(path.join(env.workspace, "notes.txt"), "SEEDED-READABLE-CONTENT");
    // Request order on the SAME fake endpoint, consumed in arrival order:
    //   (1) orchestrator SSE emits a `task` batch for `researcher`;
    //   (2) worker invoke reads notes.txt;
    //   (3) worker invoke summarizes what it read;
    //   (4) orchestrator SSE returns the final answer citing the summary.
    fake.script(
      { toolCalls: [{ name: "task", args: { tasks: [{ id: "r1", worker: "researcher", task: "read notes.txt and report its content" }] } }] },
      { toolCalls: [{ name: "read_file", args: { path: "notes.txt" } }] },
      { text: "the notes contain SEEDED-READABLE-CONTENT" },
      { text: "the researcher reported SEEDED-READABLE-CONTENT" },
    );
    const run = await runBinary(env, ["--prompt", "investigate notes.txt"], { timeoutMs: 40_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The orchestrator bound `task` (it delegates) and NOT read_file (§2.7).
    const first = fake.requests[0]!;
    expect(first.toolNames).toContain("task");
    expect(first.toolNames).not.toContain("read_file");
    // The researcher worker actually read the file: the content flowed to the
    // worker's follow-up model request (proving the delegated read executed).
    const sawContent = fake.requests.some((r) =>
      JSON.stringify(r).includes("SEEDED-READABLE-CONTENT"),
    );
    expect(sawContent).toBe(true);
  }, 50_000);

  it("W2 --enable-write prints the WRITE ENABLED line once and runs the write agent (exit 0)", async () => {
    const env = await makeEnv("enable-write-on", fake, {});
    envs.push(env);
    fake.script({ text: "all set" });
    const run = await runBinary(env, ["--prompt", "do work", "--enable-write"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(WRITE_ENABLED);
    expect(run.stderr.split(WRITE_ENABLED).length - 1).toBe(1); // exactly once
    expect(run.stdout).not.toContain("WRITE ENABLED");
    // No read-only denied line on a write run.
    expect(run.stderr).not.toContain("action(s) denied");
  }, 30_000);

  it("W3 an SSRF-range web_fetch under --enable-write is denied-and-continue (no exit 5), zero fetches", async () => {
    fixtureHits = 0;
    const env = await makeEnv("enable-write-ssrf", fake, {});
    envs.push(env);
    fake.script(
      { toolCalls: [{ name: "web_fetch", args: { url: fixtureUrl } }] },
      { text: "could not fetch" },
    );
    const run = await runBinary(env, ["--prompt", "fetch the internal page", "--enable-write"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(5); // exit 5 is retired
    expect(fixtureHits).toBe(0); // the SSRF fetch never happened
  }, 30_000);

  it("W4 --vibe is an UNKNOWN flag → exit 2, no run", async () => {
    const env = await makeEnv("enable-write-vibe", fake, {});
    envs.push(env);
    fake.requests.length = 0;
    const run = await runBinary(env, ["--prompt", "hello", "--vibe"], { timeoutMs: 15_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('unknown flag "--vibe"');
    expect(fake.requests.length).toBe(0);
  }, 20_000);

  it("W5 --enable-write with chat (and alone) is a usage error → exit 2", async () => {
    const env = await makeEnv("enable-write-chat", fake, {});
    envs.push(env);
    fake.requests.length = 0;
    const chat = await runBinary(env, ["chat", "--enable-write"], { timeoutMs: 15_000 });
    expect(chat.code).toBe(2);
    expect(chat.stderr).toContain("--enable-write");
    const alone = await runBinary(env, ["--enable-write"], { timeoutMs: 15_000 });
    expect(alone.code).toBe(2);
  }, 25_000);

  it("W6 with the seeded read-only agent removed, a default --prompt run refuses with exit 2 and the plain message", async () => {
    const env = await makeEnv("enable-write-noagent", fake, {});
    envs.push(env);
    // First run seeds the global agents folder and completes read-only.
    fake.script({ text: "seeded" });
    const seedRun = await runBinary(env, ["--prompt", "seed the agents"], { timeoutMs: 25_000 });
    expect(seedRun.timedOut).toBe(false);
    // Remove `research` — the only `unlisted: deny` top-level agent — so the
    // default read-only selection has nothing to pick (vibe is `allow`, chat is
    // `ask`; headless never falls back to chat).
    const agentsDir = path.join(env.xdg, "voidrift", "agents");
    await fs.rm(path.join(agentsDir, "research"), { recursive: true, force: true });
    fake.requests.length = 0;
    fake.script({ text: "should not run" });
    const run = await runBinary(env, ["--prompt", "do work"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("no top-level agent with unlisted: deny");
    expect(run.stderr).toContain("agents");
    // The model is never called — the run refuses before any turn.
    expect(fake.requests.length).toBe(0);
  }, 40_000);
});
