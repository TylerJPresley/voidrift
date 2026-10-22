/**
 * Exact-host allow LIFTS a web_fetch SSRF force-ask end-to-end (owner D2a),
 * against the BUILT `voidrift` binary and BUILT `@voidrift/core`.
 *
 * A loopback fixture on 127.0.0.1 records every request. web_fetch of that
 * loopback URL is normally a force-ask (§9.3) and, under a headless run (which
 * never asks), is denied-and-continue — the fixture gets ZERO requests. With an
 * EXACT `web_fetch` allow rule for the host `127.0.0.1` in the PROJECT config,
 * the force-ask is LIFTED even in a headless run (the rule is an allow-list
 * entry), so the SAME run fetches the loopback URL and the fixture gets exactly
 * ONE request. This is the one path unit tests cannot cover: the real
 * createAgent + HTTP model + the gated `web_fetch` tool over the wire.
 *
 * Bounded + leak-free: the fake model and the loopback fixture are closed; the
 * only temp roots are the per-run `<hermetic>/e2e-exacthost*` names.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, writeProjectAgent, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("exact-host allow lifts a web_fetch SSRF force-ask (e2e, owner D2a)", () => {
  let fake: FakeOpenAI;
  let fixture: http.Server;
  let port = 0;
  let fixtureHits = 0;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
    fixture = http.createServer((_req, res) => {
      fixtureHits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("internal ok");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", () => r()));
    port = (fixture.address() as AddressInfo).port;
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
    expect(await listE2eTmp("exacthost")).toHaveLength(0);
  });

  const fixtureUrl = (): string => `http://127.0.0.1:${port}/internal`;

  it("WITHOUT the exact rule the loopback fetch is denied-and-continue (fixture ZERO hits)", async () => {
    fixtureHits = 0;
    const env = await makeEnv("exacthost-off", fake, {
      // A BROAD (non-exact) allow cannot lift a force-ask.
      permissions: {
        "wf-broad": { tool: "web_fetch", pattern: "*", decision: "allow", priority: 100, source: "workspace" },
      },
    });
    envs.push(env);
    // The seeded `research` orchestrator holds no web_fetch (core §2.7); seed a
    // read-only TEST agent that binds it so the force-ask path is exercised (a
    // BROAD allow still cannot lift it).
    await writeProjectAgent(env, { tools: ["read_file", "web_fetch"] });
    fake.script({ toolCalls: [{ name: "web_fetch", args: { url: fixtureUrl() } }] }, { text: "done" });
    fake.requests.length = 0;
    const run = await runBinary(env, ["--prompt", "fetch the internal page"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(fixtureHits).toBe(0);
  }, 25_000);

  it("WITH an exact-host rule the headless run fetches it without asking (fixture ONE hit)", async () => {
    fixtureHits = 0;
    const env = await makeEnv("exacthost-on", fake, {
      // An EXACT allow rule for the loopback host lifts the SSRF force-ask.
      permissions: {
        "wf-exact": { tool: "web_fetch", pattern: "127.0.0.1", exact: true, decision: "allow", priority: 0, source: "workspace" },
      },
    });
    envs.push(env);
    await writeProjectAgent(env, { tools: ["read_file", "web_fetch"] });
    fake.script({ toolCalls: [{ name: "web_fetch", args: { url: fixtureUrl() } }] }, { text: "done" });
    fake.requests.length = 0;
    const run = await runBinary(env, ["--prompt", "fetch the internal page"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(fixtureHits).toBe(1);
  }, 25_000);
});
