/**
 * Worker decision-point gate end-to-end (core-blueprint.md §9.1, §9.5, §7.5,
 * §15.1#4), against the BUILT `@voidrift/core` and the scriptable fake OpenAI
 * SSE server. This exercises the ONE path the unit tests cannot: a dispatched
 * fan-out WORKER's tool call riding the real createAgent + HTTP + SSE path, and
 * proves the worker passes the SAME single decision point the orchestrator does.
 *
 * Two cases: (1) a session/config DENY rule on `write_file` binds the worker
 * even under the fan-out grant (deny > grant) — the file is NOT written in the
 * worker's tree; (2) a force-ask `git push --force` is immune to the fan-out
 * grant and, under a non-interactive run, fails fast — never executed. On the
 * old (ungated) worker both would have run.
 *
 * The orchestrator engine now binds a model-callable `task` tool (§7); these
 * cases dispatch the fan-out directly through `subagents.dispatch` to isolate the
 * WORKER gate without a full orchestrator loop. The end-to-end model-driven
 * `task` path is covered in `task-dispatch.e2e.test.ts`. The worker's model is
 * the SAME fake HTTP endpoint, consumed in request order.
 *
 * Bounded + leak-free: the fake server closes and every temp dir is removed in
 * afterEach; the only temp roots are the per-run `<hermetic>/e2e-wgate*` names.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, hostCore, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const coder = {
  name: "coder",
  description: "writes code",
  systemPrompt: "code",
  tools: ["read_file", "write_file", "execute_command"],
};

describe("worker decision-point gate (e2e)", () => {
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
    while (envs.length) await envs.pop()!.cleanup();
  });
  afterAll(async () => {
    await fake.close();
    expect(await listE2eTmp("wgate")).toHaveLength(0);
  });

  it("W1 a config DENY on write_file binds a dispatched worker even under the fan-out grant — the write never lands (§15.1#4)", async () => {
    const env = await makeEnv("wgate-w1", fake, {
      models: { local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 32_000 } },
      modelSelected: "local",
      // A deny rule outranks the fan-out grant (deny > ask > allow); it binds the
      // worker exactly as it would bind the orchestrator.
      permissions: {
        "deny-writes": { tool: "write_file", pattern: "*", decision: "deny", priority: 900, source: "workspace" },
      },
    });
    envs.push(env);
    // The worker's model (first request) calls write_file, then replies done;
    // the reviewer's model (second request) replies PASS.
    fake.script(
      { toolCalls: [{ name: "write_file", args: { path: "pwned.txt", content: "x" } }] },
      { text: "done" },
      { text: "PASS: ok" },
    );

    const core = await hostCore(env);
    cores.push(core);
    const denied: { reason?: string }[] = [];
    core.api.events.subscribe("PERMISSION_DENIED", (e) => denied.push((e as { payload: { reason?: string } }).payload));
    const reg = core.api.register.agent(coder);
    expect(reg).toBeUndefined();
    // Make a session active (no-op send sets it active + policy_only).
    const created = await core.api.session.create({});
    const id = created.ok ? created.value!.id : "";
    expect(id).not.toBe("");

    const res = await core.api.subagents.dispatch([{ agent: "coder", task: "write pwned" }]);
    expect(res.ok).toBe(true);

    // The write was denied by the rule and never hit the worker's tree.
    expect(denied.some((p) => (p.reason ?? "").includes("denied"))).toBe(true);
    const wtDir = path.join(env.workspace, ".voidrift", "worktrees");
    const leaked = existsSync(wtDir)
      ? (await fs.readdir(wtDir, { recursive: true })).some((f) => String(f).endsWith("pwned.txt"))
      : false;
    expect(leaked).toBe(false);
    expect(existsSync(path.join(env.workspace, "pwned.txt"))).toBe(false);
  }, 60_000);

  it("W2 a force-ask (git push --force) is immune to the fan-out grant and fails fast non-interactively — never executed (§9.3/§9.5)", async () => {
    const env = await makeEnv("wgate-w2", fake, {
      models: { local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 32_000 } },
      modelSelected: "local",
    });
    envs.push(env);
    fake.script(
      { toolCalls: [{ name: "execute_command", args: { command: "git push --force origin main" } }] },
      { text: "done" },
      { text: "PASS: ok" },
    );

    const core = await hostCore(env);
    cores.push(core);
    const started: string[] = [];
    const denied: { reason?: string }[] = [];
    core.api.events.subscribe("TOOL_STARTED", (e) => started.push((e as { payload: { name: string } }).payload.name));
    core.api.events.subscribe("PERMISSION_DENIED", (e) => denied.push((e as { payload: { reason?: string } }).payload));
    core.api.register.agent(coder);
    const created = await core.api.session.create({});
    expect(created.ok).toBe(true);

    const res = await core.api.subagents.dispatch([{ agent: "coder", task: "push" }]);
    expect(res.ok).toBe(true);

    // The force-ask resolved to reject (fail fast) and execute_command never ran.
    expect(denied.some((p) => (p.reason ?? "") === "rejected")).toBe(true);
    expect(started).not.toContain("execute_command");
  }, 60_000);
});
