/**
 * Model failures are LEGIBLE end-to-end (cli-blueprint.md §10.1), against the
 * BUILT `voidrift` binary + BUILT `@voidrift/core` over the scriptable fake
 * OpenAI server. The real symptom this covers: a proxy in front of vLLM
 * answered HTTP 502 and the TUI/headless showed only `✗ model: 502 status code
 * (no body)` — no endpoint, no attempt count, no hint.
 *
 * Headless (`--prompt`) is the deterministic surface (stderr is the status
 * channel, §8.3), so it is driven here; the TUI is driven under a pty in
 * the model-error pty check quoted in the build report.
 *
 *  1. TRANSIENT 502 then success — one retry line on stderr, the answer on
 *     stdout, exit 0 (retry budget/behaviour unchanged).
 *  2. PERSISTENT 502 — exits non-zero with the legible `<model> @ <host>:
 *     <reason> after <n> attempt(s).` line, the attempt count, and the hint.
 *  3. 400 with a JSON error body — the server's own message is shown.
 *
 * A low `networkModelMaxRetries` keeps the backoff short and the test fast; it
 * only bounds the loop, it does not change the retry SHAPE. Bounded + leak-free:
 * the fake server closes and every temp dir is removed; the only temp roots are
 * the per-run `<hermetic>/e2e-modelerr*`.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** Host[:port] the config points at, extracted from the fake server url. */
function hostOf(url: string): string {
  return new URL(url).host;
}

describe("model failures are legible end-to-end (e2e, §10.1)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterEach(() => {
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
  });
  afterAll(async () => {
    await fake.close();
    while (envs.length) await envs.pop()!.cleanup();
    expect(await listE2eTmp("modelerr")).toHaveLength(0);
  });

  const lowRetry = (fakeUrl: string): Record<string, unknown> => ({
    models: { local: { model: "fake-model", protocol: "openai", baseUrl: fakeUrl, contextLimit: 32_000 } },
    modelSelected: "local",
    networkModelMaxRetries: 2,
  });

  it("transient 502 then success shows the retry line(s) on stderr and the answer on stdout, exit 0", async () => {
    const env = await makeEnv("modelerr-transient", fake, lowRetry(fake.url));
    envs.push(env);
    // First attempt 502, second attempt succeeds — the retry budget absorbs it.
    fake.script({ httpStatus: 502 }, { text: "recovered answer" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The answer reached stdout.
    expect(run.stdout).toContain("recovered answer");
    // At least one legible retry line reached stderr, naming the endpoint and the
    // attempt count — not a bare status code.
    expect(run.stderr).toContain(`local @ ${hostOf(fake.url)}`);
    expect(run.stderr).toMatch(/retrying \(1\/3\)/);
  }, 25_000);

  it("persistent 502 exits non-zero with the legible message, attempt count, and the server hint", async () => {
    const env = await makeEnv("modelerr-persistent", fake, lowRetry(fake.url));
    envs.push(env);
    fake.always({ httpStatus: 502 });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(0);
    // The legible final line: `<model> @ <host>: <reason> after <n> attempt(s).`
    expect(run.stderr).toContain(`local @ ${hostOf(fake.url)}`);
    // maxRetries=2 → 3 attempts total.
    expect(run.stderr).toMatch(/after 3 attempts\./);
    // The per-class hint for a 5xx.
    expect(run.stderr).toContain("the endpoint answered but its model server is not responding");
    // A bare, unlegible status-only line is NOT the whole story any more.
    expect(run.stderr).not.toMatch(/^model: 502/m);
  }, 25_000);

  it("a 400 with a JSON error body shows the server's own message and the modelKwargs hint", async () => {
    const env = await makeEnv("modelerr-400", fake, lowRetry(fake.url));
    envs.push(env);
    fake.always({
      httpStatus: 400,
      errorBody: { error: { message: "temperature must be <= 2", type: "invalid_request_error" } },
    });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain(`local @ ${hostOf(fake.url)}`);
    // The server's own 400 message is surfaced (first 200 chars, masked).
    expect(run.stderr).toContain("temperature must be <= 2");
    // The 400 hint points at modelKwargs; a 400 is non-retryable → 1 attempt.
    expect(run.stderr).toContain("check this model's modelKwargs");
    expect(run.stderr).toMatch(/after 1 attempt\./);
  }, 25_000);
});
