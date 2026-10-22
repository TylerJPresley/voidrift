/**
 * ING-E2E — the model-callable `ingest` tool bound and reachable on the BUILT
 * binary (core-blueprint.md §8.7). This is the production gap the REAL-ROUTER
 * verification found: with the seeded `research` agent (and `chat`), a forced
 * `ingest` call yielded guardian `permission_denied tool:ingest
 * reason:'unknown tool: ingest' cause:unknown_tool` and no fan-out — because the
 * decision point's known-tool set (the `ToolRegistry`, seeded from
 * `builtinToolDefinitions`) listed `task` but NOT `ingest`. The unit/engine
 * tests bound the tool correctly, so only an end-to-end run over real HTTP+SSE
 * catches the registry gap.
 *
 * The run: a read-only `research` turn whose scripted model calls
 * `ingest {path:'big.md', purpose}` on an oversized markdown file (a small
 * contextLimit forces a digest). The ingest fans out `summarizer` workers
 * (served in request order off the SAME fake endpoint, as `.invoke()` =
 * non-stream JSON), a reduce worker, then the orchestrator answers using the
 * digest. A signed digest lands under `.voidrift/cache/ingest/`. A SECOND
 * identical run is served from that cache with ZERO new summarizer (non-stream)
 * worker requests.
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

/** A markdown doc with `sections` headed sections of `charsPerSection` chars —
 * large enough (with a small contextLimit + chunkTargetTokens) to require a
 * digest fan-out rather than a whole load. */
function bigMarkdown(sections: number, charsPerSection: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sections; i++) parts.push(`# Section ${i}\n` + "x".repeat(charsPerSection) + "\n");
  return parts.join("\n");
}

describe("model-callable ingest fan-out (e2e)", () => {
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
    expect(await listE2eTmp("ingest-fanout")).toHaveLength(0);
  });

  it("research calls `ingest`; it fans out summarizers, caches a signed digest, and a 2nd run hits the cache (0 workers)", async () => {
    // A small contextLimit + chunkTargetTokens forces a 2-chunk digest fan-out
    // on a ~3.2k-char file (well over fitFraction × budget).
    const env = await makeEnv("ingest-fanout", fake, {
      models: {
        local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 8000 },
      },
      modelSelected: "local",
      limits: { ingest: { fitFraction: 0.05, chunkTargetTokens: 300 } },
    });
    envs.push(env);
    await fs.writeFile(path.join(env.workspace, "big.md"), bigMarkdown(2, 1200));

    // RUN 1 — request order (consumed by arrival):
    //   (1) orchestrator SSE emits `ingest {path:'big.md', purpose}`;
    //   (2..) summarizer map workers (one per chunk) return a chunk summary;
    //   (reduce) the reduce worker returns the merged digest;
    //   (last) orchestrator SSE answers using the digest.
    // Extra unconsumed summary replies are harmless; we script generously so a
    // small variation in chunk count still lands a reduce + final.
    fake.script(
      { toolCalls: [{ name: "ingest", args: { path: "big.md", purpose: "summarize the sections" } }] },
      { text: "SUMMARY of section 0" },
      { text: "SUMMARY of section 1" },
      { text: "SUMMARY of section 2" },
      { text: "SUMMARY of section 3" },
      { text: "lines 1-2: section summaries merged into a digest" },
      { text: "I read big.md via ingest: it covers two sections." },
    );
    const run1 = await runBinary(env, ["--prompt", "ingest big.md and tell me what it covers"], { timeoutMs: 60_000 });
    expect(run1.timedOut).toBe(false);
    // The run completed (read-only, nothing written) — NOT the old
    // "unknown tool: ingest" rejection.
    expect(run1.code).toBe(0);
    expect(run1.stderr).not.toContain("unknown tool: ingest");
    // The orchestrator actually bound and called `ingest`.
    expect(fake.requests.some((r) => r.toolNames.includes("ingest"))).toBe(true);
    // The fan-out ran: more than the orchestrator's two turns (ingest call +
    // final) — the extra requests are the summarizer map + reduce workers.
    const run1Requests = fake.requests.length;
    expect(run1Requests).toBeGreaterThan(2);
    // A signed digest landed in the ingest cache.
    const cacheDir = path.join(env.workspace, ".voidrift", "cache", "ingest");
    expect(existsSync(cacheDir)).toBe(true);
    const cached = await fs.readdir(cacheDir);
    expect(cached.length).toBeGreaterThan(0);
    // The cached digest is HMAC-signed (the rollback integrity signer stamps an
    // `hmac` field); never a plaintext content dump without it.
    const firstDigest = await fs.readFile(path.join(cacheDir, cached[0]!), "utf8");
    expect(firstDigest).toMatch(/"hmac"\s*:/);

    // RUN 2 — identical prompt; the digest is cached, so `ingest` returns it with
    // NO fan-out. Script only the orchestrator call + final; the run makes
    // exactly those two requests (ingest served from cache, zero worker turns).
    fake.requests.length = 0;
    fake.script(
      { toolCalls: [{ name: "ingest", args: { path: "big.md", purpose: "summarize the sections" } }] },
      { text: "I read big.md via ingest (cached): it covers two sections." },
    );
    const run2 = await runBinary(env, ["--prompt", "ingest big.md and tell me what it covers"], { timeoutMs: 60_000 });
    expect(run2.timedOut).toBe(false);
    expect(run2.code).toBe(0);
    expect(fake.requests.some((r) => r.toolNames.includes("ingest"))).toBe(true);
    // Served from the cache: ONLY the orchestrator's two turns, no fan-out.
    expect(fake.requests.length).toBe(2);
  }, 140_000);
});
