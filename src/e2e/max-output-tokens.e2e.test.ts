/**
 * `maxOutputTokens` reaches the model as the response cap — end-to-end
 * (core-blueprint.md §11.3, §4.10), against the BUILT `voidrift` binary and the
 * BUILT `@voidrift/core` over the scriptable fake OpenAI server.
 *
 * The regression: a configured `maxOutputTokens` was dropped — the default
 * model factory spread every config key EXCEPT a known list (which excluded
 * `maxOutputTokens`) and nothing ever mapped it onto the request, so the model
 * never received `max_tokens`/`max_completion_tokens`. This test configures the
 * cap plus unknown vendor pass-through keys (`modelKwargs` carrying a nested
 * `chat_template_kwargs` and an unknown vendor key) and asserts, over real
 * HTTP, that the request body the PRODUCT sends carries BOTH:
 *  1. the cap (as `max_tokens` or `max_completion_tokens`, whichever LangChain
 *     emits), and
 *  2. the pass-through pocket's keys verbatim at the top level of the request
 *     body (LangChain spreads `modelKwargs` onto the wire).
 *
 * Bounded + leak-free: the fake server closes and every temp dir is removed in
 * afterEach/afterAll; the only temp roots are the per-run `<hermetic>/e2e-maxtok*`.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const MODEL_KWARGS = { chat_template_kwargs: { enable_thinking: false }, vendor_passthrough_key: "keep-me" };

describe("maxOutputTokens reaches the model as the response cap (e2e, §11.3)", () => {
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
    expect(await listE2eTmp("maxtok")).toHaveLength(0);
  });

  it("sends the cap AND the unknown vendor pass-through keys verbatim", async () => {
    const env = await makeEnv("maxtok", fake, {
      models: {
        local: {
          model: "fake-model",
          protocol: "openai",
          baseUrl: fake.url,
          contextLimit: 32_000,
          maxOutputTokens: 512,
          modelKwargs: MODEL_KWARGS,
        },
      },
      modelSelected: "local",
    });
    envs.push(env);
    fake.script({ text: "ok" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);

    expect(fake.requests.length).toBeGreaterThanOrEqual(1);
    const body = fake.requests[0]!.body as Record<string, unknown>;

    // 1. The response cap arrives, under whichever key LangChain emits.
    const cap = body["max_tokens"] ?? body["max_completion_tokens"];
    expect(cap).toBe(512);

    // 2. The pass-through pocket's keys arrive verbatim at the top level of the
    //    wire body (LangChain spreads `modelKwargs` into the request) — the cap
    //    did not displace or rewrite them.
    expect(body["vendor_passthrough_key"]).toBe("keep-me");
    expect(body["chat_template_kwargs"]).toEqual(MODEL_KWARGS.chat_template_kwargs);
  }, 25_000);
});
