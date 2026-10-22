/**
 * SSRF force-ask end-to-end (core-blueprint.md §8.2, §9.3 last paragraph,
 * §15.1 invariant 5), against the BUILT `voidrift` binary and the BUILT
 * `@voidrift/core`.
 *
 * The model calls `web_fetch` on a LOOPBACK fixture URL under a BROAD
 * `web_fetch` allow rule in config. A loopback URL is force-asked regardless of
 * any allow rule, plan scope, or fan-out grant (§9.3), so under `policy_only`
 * (headless) the run suspends → exit 5, and the fixture server MUST receive ZERO
 * requests (the fetch never happened). This is the one path unit tests cannot
 * cover: the real createAgent + HTTP/SSE model + the gated `web_fetch` tool over
 * the wire, proving force-ask beats the allow BEFORE any network call.
 *
 * Bounded + leak-free: the fake model server and the loopback fixture are both
 * closed in afterEach/afterAll; the only temp roots are the fixed
 * `<hermetic>/e2e-ssrf*` names, asserted empty in afterAll.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("web_fetch SSRF force-ask (e2e)", () => {
  let fake: FakeOpenAI;
  let fixture: http.Server;
  let fixtureUrl: string;
  let fixtureHits = 0;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
    // A loopback fixture that records every request. web_fetch must NEVER reach
    // it: the loopback URL is force-asked before any network call.
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
    expect(await listE2eTmp("ssrf")).toHaveLength(0);
  });

  it("a loopback web_fetch is denied-and-continue (no exit 5) and the fixture gets ZERO requests (§9.3, §8)", async () => {
    fixtureHits = 0;
    const env = await makeEnv("ssrf-loopback", fake, {
      // A broad allow rule for web_fetch — it must NOT auto-run a force-ask URL.
      permissions: {
        "web_fetch:*": {
          tool: "web_fetch",
          pattern: "*",
          decision: "allow",
          priority: 100,
          source: "workspace",
        },
      },
    });
    envs.push(env);
    fake.script(
      { toolCalls: [{ name: "web_fetch", args: { url: fixtureUrl } }] },
      { text: "could not fetch" },
    );
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "fetch the internal page"], { timeoutMs: 20_000 });

    // Force-ask beats the broad allow (§9.3); a headless run NEVER asks, so the
    // loopback fetch is denied-and-continue: the run completes (no exit 5) and
    // the loopback fixture received no request.
    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(5);
    expect(fixtureHits).toBe(0);
  }, 25_000);
});
