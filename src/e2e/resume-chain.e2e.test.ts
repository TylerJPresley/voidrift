/**
 * Two-turn resume chain — end-to-end (core-blueprint.md §5.1, §5.4; cli §5.1),
 * against the BUILT `@voidrift/core` over the scriptable fake OpenAI SSE server.
 *
 * This is the path a `voidrift chat --resume` repaints: `session.loadMessages`
 * must return the FULL chronological chain `human1, ai1, human2, ai2`. The
 * committed fake (like Ollama/vLLM) reuses ONE completion id (`chatcmpl-fake`)
 * across turns; LangGraph's add-messages reducer dedups by id, so without a
 * per-message-unique id at ingestion turn-1's assistant message is silently
 * OVERWRITTEN by turn-2's and the restored chain collapses to `human1, ai2,
 * human2` (the resume defect). The core mints a unique assistant-message id at
 * the model-output seam so the durable chain stays correct against every
 * provider; this e2e proves it over real HTTP + SSE through the real createAgent
 * + checkpointer, across a shutdown/re-host (a separate process restoring state).
 *
 * Bounded + leak-free: the fake closes and every temp dir is removed in
 * afterEach/afterAll; the only temp roots are the per-run `<hermetic>/e2e-chain*`.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, hostCore, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const CFG = {
  models: { local: { model: "fake-model", protocol: "openai", baseUrl: "", contextLimit: 32_000 } },
  modelSelected: "local",
};

/** A render-ready persisted-chain message DTO (CoreAPI §5.4 `loadMessages`). */
interface MessageDTO {
  role: string;
  content: string;
}
/** The subset of the built CoreAPI this e2e reads back (not in the e2e wrapper type). */
interface ChainApi {
  session: {
    create: (opts: unknown) => Promise<{ ok: boolean; value?: { id: string } }>;
    send: (id: string, req: unknown) => Promise<{ ok: boolean; value?: { status: string; text: string } }>;
    loadMessages: (id?: string) => Promise<{ ok: boolean; value?: MessageDTO[] }>;
    shutdown: () => Promise<void>;
  };
}

describe("two-turn resume chain restores the full chronological chain (e2e)", () => {
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
    expect(await listE2eTmp("chain")).toHaveLength(0);
  });

  it("loadMessages returns human1, ai1, human2, ai2 after a shutdown/re-host, despite provider id reuse", async () => {
    const env = await makeEnv("chain-resume", fake, { ...CFG, models: { local: { ...CFG.models.local, baseUrl: fake.url } } });
    envs.push(env);
    // Both turns reply with plain text; the fake reuses `chatcmpl-fake` for both
    // completion ids — the real-world id-reuse condition the fix must survive.
    fake.script({ text: "the first assistant answer" }, { text: "the second assistant answer" });
    fake.requests.length = 0;

    // Process A: create the session and run two turns, then shut down fully so
    // the durable SQLite checkpoint is flushed.
    const sessionId = await (async (): Promise<string> => {
      const core = await hostCore(env);
      const api = core.api as unknown as ChainApi;
      const created = await api.session.create({});
      expect(created.ok).toBe(true);
      const id = created.value!.id;
      const t1 = await api.session.send(id, { input: "the first user question", approvalMode: "policy_only" });
      expect(t1.ok).toBe(true);
      expect(t1.value!.text).toBe("the first assistant answer");
      const t2 = await api.session.send(id, { input: "the second user question", approvalMode: "policy_only" });
      expect(t2.ok).toBe(true);
      expect(t2.value!.text).toBe("the second assistant answer");
      await core.shutdown();
      return id;
    })();

    // Process B: a fresh host over the SAME dirs restores the durable chain and
    // reads it back the way `chat --resume` repaints it.
    const resumeCore = await hostCore(env);
    cores.push(resumeCore);
    const api = resumeCore.api as unknown as ChainApi;
    const loaded = await api.session.loadMessages(sessionId);
    expect(loaded.ok).toBe(true);
    const chain = loaded.value ?? [];

    const roles = chain.map((m) => m.role);
    const texts = chain.map((m) => m.content);
    // The full chronological chain survives — no turn-1 assistant drop, no misorder.
    expect(roles).toEqual(["human", "ai", "human", "ai"]);
    expect(texts[0]).toContain("the first user question");
    expect(texts[1]).toContain("the first assistant answer");
    expect(texts[2]).toContain("the second user question");
    expect(texts[3]).toContain("the second assistant answer");
  }, 60_000);
});
