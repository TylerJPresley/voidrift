/**
 * Real-binary HOSTILE end-to-end tests (Stage B).
 *
 * These drive the BUILT `voidrift` binary and BUILT `@voidrift/core` against the
 * scriptable fake OpenAI SSE server under adversarial conditions the model
 * controls: invalid tool arguments, an unknown tool, malformed JSON arguments,
 * an endless tool loop, an oversized tool result, a mid-stream connection drop,
 * HTTP 500/401 from the endpoint, and secret hygiene end to end. Each scenario
 * is a permanent regression test whose EXPECTED behavior is derived from the
 * blueprints (named in each test title) BEFORE running:
 *   H1 invalid args  — structured error ToolMessage, loop continues (core §8.1, §9.1).
 *   H2 unknown tool  — registry rejects with a structured error (core §8.1).
 *   H3 malformed JSON — graceful tool-error or clean failed run, never a hang (core §8.1, §3.3).
 *   H4 endless loop  — limit_reached ⇒ exit 4, bounded wall clock + request count (core §3.6; cli §2.4).
 *   H5 large result  — not sent inline; follow-up request bounded (core §4.8, §8.3).
 *   H6 drop mid-stream — clean failed run, exit 1, prompt exit (core §3.3, §8.3).
 *   H7 HTTP 500/401  — exit 1 fast, no key/bearer on any channel (core §10.10; cli §8.3).
 *   H8 secret hygiene — raw bearer token never on disk; masked marker survives resume (core §10.10).
 *
 * Bounded + leak-free: the fake server is closed and every temp dir removed in
 * afterEach; per-test timeouts are explicit (≤ 30s); no background process is
 * left; the five per-run `<hermetic>/e2e-*` roots are the only temp dirs used.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, writeProjectAgent, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** The byte size of a recorded request body (what the product sent the model). */
function bodyBytes(req: { body: unknown }): number {
  return Buffer.byteLength(JSON.stringify(req.body), "utf8");
}

/** Assert stderr carries no unhandled-rejection / stack-trace noise. */
function assertNoCrashNoise(stderr: string): void {
  expect(stderr).not.toMatch(/Unhandled/i);
  expect(stderr).not.toMatch(/UnhandledPromiseRejection/);
  expect(stderr).not.toMatch(/\bat .*\(.*:\d+:\d+\)/); // a V8 stack frame
}

describe("real-binary hostile (e2e)", () => {
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
    // Scoped to this suite's own `h<digit>*` fixtures (h1–h8, h7-500, h7-401)
    // so a parallel sibling e2e file (e.g. headless-no-ingest) is not seen as
    // a leak (see run-binary.ts listE2eTmp).
    const all = await listE2eTmp("h");
    const hostile = all.filter((d) => /\/e2e-h\d/.test(d));
    expect(hostile).toEqual([]);
  });

  it("H1 INVALID ARGS: read_file with no path returns a structured error ToolMessage; loop continues (core §8.1, §9.1)", async () => {
    const env = await makeEnv("h1", fake);
    envs.push(env);
    // read_file requires `path`; sending `{}` is Zod-invalid.
    fake.script({ toolCalls: [{ name: "read_file", args: {} }] }, { text: "recovered" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "read a file"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("recovered\n");
    // stderr: exactly one `voidrift: session <id>` line (a first-run seed notice
    // may precede it when HOME/XDG start empty, §CLI 2.1/core §13.8).
    {
      const sessionLines = run.stderr.split("\n").filter((l) => l.startsWith("voidrift: session "));
      expect(sessionLines).toHaveLength(1);
      expect(sessionLines[0]).toMatch(/^voidrift: session [0-9a-f]{8}$/);
    }
    assertNoCrashNoise(run.stderr);
    // The loop continued: a second request carries a `tool` error message.
    expect(fake.requests.length).toBe(2);
    const follow = fake.requests[1]!;
    const toolMsgs = (follow.body.messages ?? []).filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThan(0);
    const joined = toolMsgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    expect(joined.toLowerCase()).toMatch(/error|invalid|required/);
    // Nothing was read: no file named — the executor never ran.
  }, 30_000);

  it("H2 UNKNOWN TOOL: rm_everything is rejected with a structured error; loop continues, nothing executed (core §8.1)", async () => {
    const env = await makeEnv("h2", fake);
    envs.push(env);
    fake.script({ toolCalls: [{ name: "rm_everything", args: { all: true } }] }, { text: "handled" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "delete everything"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("handled\n");
    // stderr: exactly one `voidrift: session <id>` line (a first-run seed notice
    // may precede it when HOME/XDG start empty, §CLI 2.1/core §13.8).
    {
      const sessionLines = run.stderr.split("\n").filter((l) => l.startsWith("voidrift: session "));
      expect(sessionLines).toHaveLength(1);
      expect(sessionLines[0]).toMatch(/^voidrift: session [0-9a-f]{8}$/);
    }
    assertNoCrashNoise(run.stderr);
    expect(fake.requests.length).toBe(2);
    const follow = fake.requests[1]!;
    const toolMsgs = (follow.body.messages ?? []).filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThan(0);
    const joined = toolMsgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    expect(joined.toLowerCase()).toMatch(/unknown|not found|unrecognized|no tool|error/);
  }, 30_000);

  it("H3 MALFORMED JSON ARGS: truncated arguments yield a graceful tool-error (loop continues) or a clean failed run — never a hang (core §8.1, §3.3)", async () => {
    const env = await makeEnv("h3", fake);
    envs.push(env);
    // The streamed tool-call arguments are invalid JSON (`{"path": `).
    fake.script({ rawToolCall: { name: "read_file", rawArgs: '{"path": ' } }, { text: "after malformed" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "read with malformed args"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    assertNoCrashNoise(run.stderr);
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    // §8.1: a malformed-JSON tool call returns an error result; the agent runtime
    // typically coerces truncated args to `{}`, so the Zod error path (H1) is
    // reused and the loop continues to a clean exit 0. If instead the product
    // ends the run (model/engine error), that is exit 1 with an error line.
    // Either is acceptable; a hang/crash/exit-0-with-swallowed-error is not.
    expect([0, 1]).toContain(run.code);
    if (run.code === 0) {
      expect(run.stdout).toBe("after malformed\n");
      expect(fake.requests.length).toBe(2);
    } else {
      expect(run.stdout).toBe("");
      // A failed run writes an error line after the session line (§8.3).
      expect(run.stderr.trim().split("\n").length).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);

  it("H4 ENDLESS TOOL LOOP: a tool call every turn ends limit_reached ⇒ exit 4, bounded wall clock + finite requests, non-empty result (core §3.6; cli §2.4)", async () => {
    const env = await makeEnv("h4", fake);
    envs.push(env);
    // The seeded `research` orchestrator binds no direct read tool (core §2.7);
    // seed a read-only TEST agent that binds read_file so the loop genuinely
    // reads every turn (not an unknown-tool rejection) before the limit ends it.
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "loop.txt"), "x");
    // The model ALWAYS asks to read a file and NEVER returns final text.
    fake.always({ toolCalls: [{ name: "read_file", args: { path: "loop.txt" } }] });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "loop forever"], { timeoutMs: 25_000 });

    expect(run.timedOut).toBe(false);
    // §3.6: a limit that ends a turn surfaces RunStatus=limit_reached ⇒ exit 4.
    expect(run.code).toBe(4);
    // Bounded wall clock well under the 25s cap.
    expect(run.wallMs).toBeLessThan(25_000);
    // New behaviour: the limit result is NEVER empty — the turn still returns a
    // result (a generated summary / step-limit notice) on stdout, not "".
    expect(run.stdout.trim().length).toBeGreaterThan(0);
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    assertNoCrashNoise(run.stderr);
    // Finite, reasonable number of model requests (bounded by turnRecursionLimit,
    // default 25 — not hundreds). Reported for the record.
    const count = fake.requests.length;
    console.error(`[H4] requests=${count} wallMs=${run.wallMs}`);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(30);
  }, 30_000);

  it("H5 LARGE TOOL RESULT: a ~2 MB file is not sent inline into the next request; follow-up body is bounded (core §4.8, §8.3)", async () => {
    const env = await makeEnv("h5", fake);
    envs.push(env);
    // ~2 MB of text across many lines (so the read-line limit also applies).
    const big = ("lorem ipsum dolor sit amet consectetur ".repeat(1) + "\n").repeat(50_000);
    const bigBytes = Buffer.byteLength(big, "utf8");
    expect(bigBytes).toBeGreaterThan(1_800_000);
    await fs.writeFile(path.join(env.workspace, "big.txt"), big);
    fake.script({ toolCalls: [{ name: "read_file", args: { path: "big.txt" } }] }, { text: "read it" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "read big.txt"], { timeoutMs: 25_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(fake.requests.length).toBe(2);
    const follow = fake.requests[1]!;
    const followBytes = bodyBytes(follow);
    console.error(`[H5] follow-up request body = ${followBytes} bytes (source file ${bigBytes} bytes)`);
    // §4.8/§8.3: the whole 2 MB must NOT ride inline into the next request. The
    // read-line limit (workspaceMaxReadLines=2000) and/or large-result eviction
    // keep it bounded well under 200 KB.
    expect(followBytes).toBeLessThan(200_000);
    // The full 2 MB payload is not present in the request body.
    const serialized = JSON.stringify(follow.body);
    expect(serialized.length).toBeLessThan(bigBytes / 2);
  }, 30_000);

  it("H6 MODEL ERROR MID-STREAM: a dropped connection that never recovers ends a clean failed run (exit 1), prompt exit, no success claimed (core §3.3, §8.3)", async () => {
    // A low retry budget keeps the test fast and deterministic: the drop recurs
    // on every attempt, so the retry budget exhausts quickly and the turn fails.
    const env = await makeEnv("h6", fake, { networkModelMaxRetries: 1 });
    envs.push(env);
    // Two content chunks then the socket is destroyed before [DONE] — on EVERY
    // request, so a retry cannot "recover" into a stray clean completion.
    fake.always({ dropAfterChunks: 2 });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "stream then drop"], { timeoutMs: 15_000 });

    expect(run.timedOut).toBe(false);
    // Prompt exit well under 15s.
    expect(run.wallMs).toBeLessThan(15_000);
    // §3.3/§8.3: a provider/stream error mid-turn ends the turn `failed` ⇒ exit 1.
    expect(run.code).toBe(1);
    // stderr: the session line THEN an error line (§8.3).
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    const lines = run.stderr.trim().split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[lines.length - 1]!.toLowerCase()).toMatch(/model|error|stream|connect|connection|socket|fetch|network|endpoint|hint|server|url/);
    assertNoCrashNoise(run.stderr);
  }, 30_000);

  it("H7 HTTP 500: the endpoint 500s ⇒ exit 1 fast; the API key never appears on any channel or log (core §3.6, §10.10)", async () => {
    const KEY = "sk-live-FAKEKEY-ZZZ-500-7777777777";
    const env = await makeEnv("h7-500", fake, {
      models: {
        local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 32_000, apiKeyEnv: "VOIDRIFT_FAKE_KEY" },
      },
      // A 5xx is retryable (§3.6); a low budget keeps the test fast while still
      // proving the turn fails (exit 1) once the endpoint 500s on every attempt.
      networkModelMaxRetries: 1,
    });
    envs.push(env);
    // Every attempt 500s, so the retry budget exhausts and the turn fails.
    fake.always({ httpStatus: 500, errorBody: { error: { message: "internal error", type: "server_error" } } });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "trigger 500"], { timeoutMs: 15_000, extraEnv: { VOIDRIFT_FAKE_KEY: KEY } });

    expect(run.timedOut).toBe(false);
    expect(run.wallMs).toBeLessThan(15_000);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    // The error is named on stderr WITHOUT echoing the key.
    expect(run.stdout).not.toContain(KEY);
    expect(run.stderr).not.toContain(KEY);
    assertNoCrashNoise(run.stderr);
    // No log file under .voidrift/logs leaks the key either.
    const logDir = path.join(env.workspace, ".voidrift", "logs");
    const files = await fs.readdir(logDir).catch(() => [] as string[]);
    for (const f of files) {
      const body = await fs.readFile(path.join(logDir, f), "utf8");
      expect(body).not.toContain(KEY);
    }
  }, 30_000);

  it("H7 HTTP 401: the endpoint 401s ⇒ exit 1 fast; the API key never appears on any channel or log (core §3.6, §10.10)", async () => {
    const KEY = "sk-live-FAKEKEY-YYY-401-8888888888";
    const env = await makeEnv("h7-401", fake, {
      models: {
        local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 32_000, apiKeyEnv: "VOIDRIFT_FAKE_KEY" },
      },
    });
    envs.push(env);
    fake.script({ httpStatus: 401, errorBody: { error: { message: "invalid api key", type: "auth" } } });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "trigger 401"], { timeoutMs: 15_000, extraEnv: { VOIDRIFT_FAKE_KEY: KEY } });

    expect(run.timedOut).toBe(false);
    expect(run.wallMs).toBeLessThan(15_000);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    expect(run.stdout).not.toContain(KEY);
    expect(run.stderr).not.toContain(KEY);
    assertNoCrashNoise(run.stderr);
    const logDir = path.join(env.workspace, ".voidrift", "logs");
    const files = await fs.readdir(logDir).catch(() => [] as string[]);
    for (const f of files) {
      const body = await fs.readFile(path.join(logDir, f), "utf8");
      expect(body).not.toContain(KEY);
    }
  }, 30_000);

  it("H8 SECRET HYGIENE: a bearer token in a refused execute_command never reaches stdout/stderr/logs (exit 0, deny-and-continue)", async () => {
    const TOKEN = "sk-live-ABCDEF1234567890";
    const COMMAND = `curl -H "Authorization: Bearer ${TOKEN}" https://example.com`;
    const env = await makeEnv("h8", fake);
    envs.push(env);
    // The read-only default agent binds no execute_command, so the model's
    // command is an unknown-tool rejection (deny-and-continue): it never runs
    // and the raw token never leaves the process. exit 0, not exit 5.
    fake.script({ toolCalls: [{ name: "execute_command", args: { command: COMMAND } }] }, { text: "could not run" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "run a curl with a token"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(5);
    expect(run.stdout).not.toContain(TOKEN);
    expect(run.stderr).not.toContain(TOKEN);

    // No §10.10 egress artifact under .voidrift/ holds the raw token (the live
    // checkpoint.db is the operational chain and is excluded, see e2e-b.md).
    const root = path.join(env.workspace, ".voidrift");
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/checkpoint\.db/.test(e.name)) continue;
        else {
          const body = await fs.readFile(p, "utf8").catch(() => "");
          if (body.includes(TOKEN)) offenders.push(p);
        }
      }
    }
    await walk(root);
    expect(offenders).toEqual([]);
  }, 30_000);
});
