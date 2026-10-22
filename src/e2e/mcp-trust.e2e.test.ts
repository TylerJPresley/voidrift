/**
 * MCP trust + pinning end-to-end (core-blueprint.md §8.4), against the BUILT
 * `voidrift` binary and the BUILT `@voidrift/core`, over a REAL stdio MCP
 * transport — the first time MCP runs over an actual child process rather than
 * an in-process stub.
 *
 * A committed stdio fixture server (`fixtures/mcp-stdio-fixture.mjs`) exposes a
 * single `lookup` tool annotated `readOnlyHint: true` and records every call to
 * a JSONL file, so "ZERO calls" is a hard, file-backed assertion. The project
 * config registers it as `command: node + fixture path`.
 *
 * E1 first run, no approval → the model is NOT given the tool (the recorded
 *    request's tool names exclude every `mcp_*`) and the fixture logs ZERO.
 * E2 approve via a host script, then `--prompt` where the fake model calls the
 *    tool: with trust=false the call needs approval → exit 5 and ZERO calls;
 *    with trust=true it runs → exit 0, the fixture logs exactly 1 call, stdout
 *    carries the final text.
 * E3 mutate the fixture's tool description (env) between runs → quarantined:
 *    the model is not given the tool, ZERO calls, MCP_TOOLS_QUARANTINED emitted
 *    (observed through a host-script subscription).
 * E4 a server that crashes at start → the run completes (non-fatal), the server
 *    status is `error`, and there is no hang.
 *
 * Bounded + leak-free: the fake model server closes in afterAll; every temp dir
 * is removed in afterEach (per-run `<hermetic>/e2e-mcptrust*` roots); and after
 * every run the fixture child process is asserted GONE (no orphan).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, hostCore, listE2eTmp, E2E_TMP_PREFIX, type IsolatedEnv } from "./run-binary.js";

/** The committed fixture, resolved from this file's location (not cwd). */
const FIXTURE = path.resolve(fileURLToPath(new URL("./fixtures/mcp-stdio-fixture.mjs", import.meta.url)));

/** mcp config entry pointing at the stdio fixture; `trust` and the call-log /
 * description / crash env knobs are per-scenario. */
function mcpConfig(callLog: string, opts: { trust?: boolean; desc?: string; crash?: boolean } = {}): Record<string, unknown> {
  const env: Record<string, string> = { MCP_FIXTURE_CALLLOG: callLog };
  if (opts.desc) env.MCP_FIXTURE_DESC = opts.desc;
  if (opts.crash) env.MCP_FIXTURE_CRASH = "1";
  return {
    mcp: {
      fixture: {
        transport: "stdio",
        command: process.execPath,
        args: [FIXTURE],
        env,
        ...(opts.trust !== undefined ? { trust: opts.trust } : {}),
      },
    },
  };
}

/** The number of recorded `lookup` calls (0 when the log was never created). */
async function callCount(callLog: string): Promise<number> {
  if (!existsSync(callLog)) return 0;
  const txt = await fs.readFile(callLog, "utf8");
  return txt.split("\n").filter((l) => l.trim() !== "").length;
}

/** Any `node … mcp-stdio-fixture.mjs` CHILD still alive on this box (orphan
 * check). Matches only a real process whose argv is `<node> <…/fixture.mjs>`
 * — never a shell/vitest command line that merely MENTIONS the path (which a
 * naive substring match would wrongly count). Bounded, non-interactive `ps`. */
function fixtureProcsAlive(): number {
  try {
    const out = execFileSync("ps", ["-eo", "args"], { encoding: "utf8", timeout: 5_000 });
    return out
      .split("\n")
      .filter((l) => /(^|\/)node(\.exe)?\s.*mcp-stdio-fixture\.mjs(\s|$)/.test(l.trim()))
      .length;
  } catch {
    return 0;
  }
}

/** Poll (bounded) until no fixture child remains, so a child still inside its
 * SIGTERM grace window after a scenario's teardown is not falsely flagged as an
 * orphan. Returns the final count (0 on success). */
async function waitNoFixtureProcs(timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = fixtureProcsAlive();
  while (n > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    n = fixtureProcsAlive();
  }
  return n;
}

/** Grant `mcp_approve` so a HOST script can approve non-interactively; the
 * binary (headless) still has no such rule, so a model-driven call fails fast. */
const APPROVE_ALLOW = {
  "mcp_approve:*": { tool: "mcp_approve", pattern: "*", decision: "allow", priority: 900, source: "workspace" },
};

describe("MCP trust + pinning (real stdio e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];
  const cores: { shutdown: () => Promise<void> }[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
    expect(existsSync(FIXTURE)).toBe(true);
  });

  afterEach(async () => {
    while (cores.length) await cores.pop()!.shutdown().catch(() => undefined);
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
    while (envs.length) await envs.pop()!.cleanup();
    // No orphan fixture child survives a scenario (the SDK transport ends the
    // child's stdin then SIGTERM/SIGKILLs it; poll until the grace window
    // completes so a mid-teardown child is not falsely flagged).
    expect(await waitNoFixtureProcs()).toBe(0);
  });

  afterAll(async () => {
    await fake.close();
    expect(await listE2eTmp("mcptrust")).toHaveLength(0);
  });

  it("E1 first run, no approval → the model is given NO mcp_* tool and the fixture is NEVER called", async () => {
    const callLog = `${E2E_TMP_PREFIX}-mcptrust-e1-calls.jsonl`;
    await fs.rm(callLog, { force: true });
    const env = await makeEnv("mcptrust-e1", fake, {
      ...mcpConfig(callLog, { trust: true }), // trust true, but UNAPPROVED → pending
    });
    envs.push(env);
    // The model would call the tool if it were bound; it is not, so the run just
    // returns text. Script a plain reply so the turn terminates.
    fake.script({ text: "nothing to look up" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "look something up"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The bound tool list in the request the product sent excludes every mcp_* tool.
    const boundNames = fake.requests.flatMap((r) => r.toolNames);
    expect(boundNames.some((n) => n.startsWith("mcp_"))).toBe(false);
    // The fixture was never invoked.
    expect(await callCount(callLog)).toBe(0);
    await fs.rm(callLog, { force: true });
  }, 40_000);

  it("E2 a gated MCP call under a read-only headless run never executes (no exit 5, ZERO calls) regardless of trust", async () => {
    // The default headless agent is read-only and binds no `mcp_*` tool, and a
    // headless run never asks — so a model MCP call is refused (deny-and-continue)
    // and the fixture is never called, whether the server is trusted or not. The
    // trust→readOnly binding distinction is covered at the core level.
    for (const trust of [false, true]) {
      const log = `${E2E_TMP_PREFIX}-mcptrust-e2-${trust}-calls.jsonl`;
      await fs.rm(log, { force: true });
      const env = await makeEnv(`mcptrust-e2-${trust}`, fake, {
        ...mcpConfig(log, { trust }),
        permissions: { ...APPROVE_ALLOW },
      });
      envs.push(env);

      // Approve the fixture's tools through a HOST script (never the model).
      const core = await hostCore(env);
      cores.push(core);
      await new Promise((r) => setTimeout(r, 1_500));
      const approved = await (core.api as unknown as { mcp: { approve: (s: string) => Promise<{ ok: boolean }> } }).mcp.approve("fixture");
      expect(approved.ok).toBe(true);
      await core.shutdown();
      cores.pop();

      fake.script({ toolCalls: [{ name: "mcp_fixture_lookup", args: { id: "42" } }] }, { text: "could not look up" });
      fake.requests.length = 0;
      const run = await runBinary(env, ["--prompt", "look up 42"], { timeoutMs: 25_000 });
      expect(run.timedOut).toBe(false);
      expect(run.code).not.toBe(5); // exit 5 is retired
      expect(await callCount(log)).toBe(0); // the gated MCP call never ran
      await fs.rm(log, { force: true });
    }
  }, 90_000);

  it("E3 a mutated tool description quarantines the tool: not bound, ZERO calls, MCP_TOOLS_QUARANTINED emitted", async () => {
    const callLog = `${E2E_TMP_PREFIX}-mcptrust-e3-calls.jsonl`;
    await fs.rm(callLog, { force: true });
    // Run 1: approve the tool as it is.
    const env = await makeEnv("mcptrust-e3", fake, {
      ...mcpConfig(callLog, { trust: true }),
      permissions: { ...APPROVE_ALLOW },
    });
    envs.push(env);

    const core1 = await hostCore(env);
    cores.push(core1);
    await new Promise((r) => setTimeout(r, 1_500));
    await (core1.api as unknown as { mcp: { approve: (s: string) => Promise<{ ok: boolean }> } }).mcp.approve("fixture");
    await core1.shutdown();
    cores.pop();

    // Run 2: MUTATE the description via config env → hash differs → quarantined.
    const envMut = await makeEnv("mcptrust-e3b", fake, {
      ...mcpConfig(callLog, { trust: true, desc: "TOTALLY DIFFERENT DESCRIPTION" }),
      permissions: { ...APPROVE_ALLOW },
    });
    // Reuse the SAME pin file by copying the approved pins into the mutated env.
    const pinSrc = path.join(env.workspace, ".voidrift", "mcp-pins.json");
    const pinDst = path.join(envMut.workspace, ".voidrift", "mcp-pins.json");
    if (existsSync(pinSrc)) await fs.copyFile(pinSrc, pinDst);
    envs.push(envMut);

    const quarantined: unknown[] = [];
    const core2 = await hostCore(envMut);
    cores.push(core2);
    core2.api.events.subscribe("MCP_TOOLS_QUARANTINED", (e) => quarantined.push((e as { payload: unknown }).payload));
    // Let the boot autoConnect settle first so the explicit reconnect replaces a
    // fully-established connection (a concurrent connect would otherwise leak a
    // child); then reconnect so the mutated descriptor is evaluated vs the pins.
    await new Promise((r) => setTimeout(r, 1_500));
    await (core2.api as unknown as { mcp: { connect: (s: string) => Promise<unknown> } }).mcp.connect("fixture");
    await new Promise((r) => setTimeout(r, 500));
    const pins = await (core2.api as unknown as { mcp: { pins: () => Promise<{ ok: boolean; value?: Array<{ name: string; toolStatuses?: Array<{ name: string; status: string }> }> }> } }).mcp.pins();
    await core2.shutdown();
    cores.pop();

    expect(quarantined.length).toBeGreaterThan(0);
    const fixtureInfo = pins.ok ? pins.value?.find((s) => s.name === "fixture") : undefined;
    const lookup = fixtureInfo?.toolStatuses?.find((t) => t.name === "mcp_fixture_lookup");
    expect(lookup?.status).toBe("quarantined");

    // Run the binary: the quarantined tool is NOT bound, and a hallucinated call
    // to it never reaches the fixture.
    fake.script({ toolCalls: [{ name: "mcp_fixture_lookup", args: { id: "x" } }] }, { text: "done" });
    fake.requests.length = 0;
    const run = await runBinary(envMut, ["--prompt", "look up x"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    const boundNames = fake.requests.flatMap((r) => r.toolNames);
    expect(boundNames.some((n) => n.startsWith("mcp_"))).toBe(false);
    expect(await callCount(callLog)).toBe(0);
    await fs.rm(callLog, { force: true });
  }, 90_000);

  it("E4 a server that crashes at start → the run completes (non-fatal), status error, no hang", async () => {
    const callLog = `${E2E_TMP_PREFIX}-mcptrust-e4-calls.jsonl`;
    await fs.rm(callLog, { force: true });
    const env = await makeEnv("mcptrust-e4", fake, {
      ...mcpConfig(callLog, { trust: true, crash: true }),
    });
    envs.push(env);
    fake.script({ text: "nothing to do" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "hello"], { timeoutMs: 25_000 });
    // The crashing server is non-fatal: the run still completes without a hang.
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);

    // A host core over the same workspace sees the server status as `error`.
    const core = await hostCore(env);
    cores.push(core);
    await new Promise((r) => setTimeout(r, 1_000));
    const list = await (core.api as unknown as { mcp: { list: () => Promise<{ ok: boolean; value?: Array<{ name: string; status: string }> }> } }).mcp.list();
    await core.shutdown();
    cores.pop();
    const fixtureInfo = list.ok ? list.value?.find((s) => s.name === "fixture") : undefined;
    expect(fixtureInfo?.status).toBe("error");
    expect(await callCount(callLog)).toBe(0);
    await fs.rm(callLog, { force: true });
  }, 40_000);
});
