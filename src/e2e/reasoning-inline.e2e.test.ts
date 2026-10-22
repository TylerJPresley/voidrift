/**
 * Inline <think> reasoning stripped at ingestion — end-to-end (core-blueprint.md
 * §3.7, §4.7, invariant 24), against the BUILT `voidrift` binary and the BUILT
 * `@voidrift/core` over the scriptable fake OpenAI SSE server.
 *
 * This is the one path unit tests cannot cover: a provider that echoes
 * chain-of-thought INLINE in streamed content chunks (DeepSeek-R1 / Qwen QwQ /
 * Ollama shape), over real HTTP + SSE, through the real createAgent + context
 * pipeline + checkpointer. The fake splits the content across 2–3 chunks, so the
 * `<think>…</think>` tag arrives across chunk boundaries — exactly the case the
 * streaming splitter must survive.
 *
 * Two assertions, both over the shipping product:
 *  1. The BUILT binary's `--prompt` stdout is the VISIBLE text only ("Hello"),
 *     never the reasoning ("secret plan").
 *  2. A FOLLOW-UP turn in the SAME session (hosted BUILT core) records a request
 *     whose message body contains NO reasoning text — the persisted chain holds
 *     final text only, so reasoning never re-enters context (invariant 24).
 *
 * Bounded + leak-free: the fake server closes and every temp dir is removed in
 * afterEach/afterAll; the only temp roots are the per-run `<hermetic>/e2e-think*`.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, hostCore, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const CFG = {
  models: { local: { model: "fake-model", protocol: "openai", baseUrl: "", contextLimit: 32_000 } },
  modelSelected: "local",
};

describe("inline <think> reasoning stripped at ingestion (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];
  const cores: { shutdown: () => Promise<void> }[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterEach(async () => {
    while (cores.length) await cores.pop()!.shutdown().catch(() => undefined);
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
  });
  afterAll(async () => {
    await fake.close();
    while (envs.length) await envs.pop()!.cleanup();
    expect(await listE2eTmp("think")).toHaveLength(0);
  });

  it("the BUILT binary streams only the VISIBLE text to stdout, never the inline reasoning (§4.7)", async () => {
    const env = await makeEnv("think-stdout", fake, { ...CFG, models: { local: { ...CFG.models.local, baseUrl: fake.url } } });
    envs.push(env);
    // The content arrives split across chunks, so '<think>…</think>' crosses
    // chunk boundaries — the streaming splitter must still strip it.
    fake.script({ text: "<think>secret plan</think>Hello" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "greet me"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // stdout shows the visible text and NOT the reasoning.
    expect(run.stdout).toContain("Hello");
    expect(run.stdout).not.toContain("secret plan");
  }, 25_000);

  it("a follow-up turn in the SAME session sends NO reasoning text (reasoning never re-enters context, invariant 24)", async () => {
    const env = await makeEnv("think-followup", fake, { ...CFG, models: { local: { ...CFG.models.local, baseUrl: fake.url } } });
    envs.push(env);
    // Turn 1 echoes inline reasoning; turn 2 is a plain reply.
    fake.script({ text: "<think>secret plan</think>Hello" }, { text: "second answer" });
    fake.requests.length = 0;

    const core = await hostCore(env);
    cores.push(core);
    const created = await core.api.session.create({});
    const id = (created as { ok: boolean; value?: { id: string } }).ok ? created.value!.id : "";
    expect(id).not.toBe("");

    const t1 = (await core.api.session.send(id, { input: "greet me", approvalMode: "policy_only" })) as {
      ok: boolean; value?: { status: string; text: string };
    };
    expect(t1.ok).toBe(true);
    expect(t1.value!.text).toBe("Hello"); // visible text only

    const t2 = (await core.api.session.send(id, { input: "again", approvalMode: "policy_only" })) as { ok: boolean };
    expect(t2.ok).toBe(true);

    // The SECOND request's body carries the turn-1 assistant message — it must
    // hold the final text only, never the stripped reasoning.
    expect(fake.requests.length).toBeGreaterThanOrEqual(2);
    const secondBody = JSON.stringify(fake.requests[1]!.body);
    expect(secondBody).toContain("Hello");
    expect(secondBody).not.toContain("secret plan");
  }, 60_000);
});
