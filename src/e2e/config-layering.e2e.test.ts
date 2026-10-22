/**
 * Config layering end-to-end (core-blueprint.md §13.1; handoff §0.2 item 3),
 * against the BUILT `voidrift` binary and BUILT `@voidrift/core`.
 *
 * The global config is the MINIMAL BASE (seeded on first run); the PROJECT
 * config (`<workdir>/.voidrift/config.json`) OVERRIDES AND EXTENDS it: records
 * (`permissions`) merge by id with the project adding new rules, array keys
 * UNION, and DENY ANYWHERE WINS (a project `deny` beats the global allow list).
 * This drives those semantics through a real headless run, not a unit fake.
 *
 *   L1 A read allowed by the SEEDED GLOBAL allow list runs in the project
 *      workspace (the global base extends into the project run): the file
 *      content flows back to the model and nothing is denied.
 *   L2 A project `deny` rule for one path beats the global `read_file` allow
 *      (deny-anywhere-wins): that read is refused — the model sees a permission
 *      error naming the project (workspace) rule and the secret never leaks —
 *      while the globally-allowed read still runs, proving the project rule
 *      merged ON TOP of the global base and a deny overrides an allow.
 *   L3 The project config also carries an extra `permissions` allow rule and an
 *      extra `findingsDirectories` array entry; the run loads it cleanly (no
 *      config rejection), proving the project extends — not replaces — the base.
 *
 * Bounded + leak-free: the fake server closes in afterAll; temp roots use the
 * per-run `<hermetic>/e2e-config-layering*` names, asserted empty.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, writeProjectAgent, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** The project config patch: extends the seeded global base with (a) a deny
 * rule that beats the global read allow for `secret.txt`, (b) an extra allow
 * rule, and (c) an extra findings directory (an array key that UNIONS). */
const PROJECT_PATCH = {
  permissions: {
    // Deny ANYWHERE wins: this beats the seeded global `allow-read_file`.
    "proj-deny-secret": {
      tool: "read_file",
      pattern: "secret.txt",
      decision: "deny",
      priority: 0,
      source: "workspace",
    },
    // An extra allow rule the global base does not carry (extends the record).
    "proj-allow-notes": {
      tool: "read_file",
      pattern: "notes.txt",
      decision: "allow",
      priority: 0,
      source: "workspace",
    },
  },
  // An extra array entry: unions with the global/default base, never replaces it.
  findingsDirectories: [".voidrift/research/", "docs/notes/"],
  // A project-layer webSearch endpoint — accepted in ANY layer now (the old
  // global/managed-only loosening rule was removed). A public https endpoint
  // loads cleanly and is not force-asked.
  webSearch: { provider: "searxng", endpoint: "https://searx.example" },
};

describe("config layering: project extends global + deny-anywhere-wins (e2e)", () => {
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
    expect(await listE2eTmp("config-layering")).toHaveLength(0);
  });

  it("L1 a globally-allowed read runs in the project workspace (global base extends in)", async () => {
    const env = await makeEnv("config-layering-extend", fake, PROJECT_PATCH);
    envs.push(env);
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "ok.txt"), "GLOBAL-ALLOWS-THIS-READ");
    fake.script(
      { toolCalls: [{ name: "read_file", args: { path: "ok.txt" } }] },
      { text: "read it" },
    );
    const run = await runBinary(env, ["--prompt", "read ok.txt"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The read executed (allowed by the SEEDED global allow list), not denied.
    expect(run.stderr).not.toContain("action(s) denied");
    const sawContent = fake.requests.some((r) => JSON.stringify(r).includes("GLOBAL-ALLOWS-THIS-READ"));
    expect(sawContent).toBe(true);
  }, 30_000);

  it("L2 a project deny beats the global read allow; the globally-allowed read still runs (deny-anywhere-wins)", async () => {
    const env = await makeEnv("config-layering-deny", fake, PROJECT_PATCH);
    envs.push(env);
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "secret.txt"), "TOP-SECRET-SHOULD-NOT-LEAK");
    await fs.writeFile(path.join(env.workspace, "ok.txt"), "PUBLIC-OK");
    // One turn reads the denied path, then the allowed one; the run completes.
    fake.script(
      { toolCalls: [{ name: "read_file", args: { path: "secret.txt" } }] },
      { toolCalls: [{ name: "read_file", args: { path: "ok.txt" } }] },
      { text: "done" },
    );
    const run = await runBinary(env, ["--prompt", "read both files"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The project deny beat the global allow: the denied read came back to the
    // model as a permission error naming the WORKSPACE (project-layer) rule.
    const allReq = JSON.stringify(fake.requests);
    expect(allReq).toContain("permission denied");
    expect(allReq).toContain("workspace rule");
    // The secret content NEVER reached the model (the read was denied).
    expect(allReq.includes("TOP-SECRET-SHOULD-NOT-LEAK")).toBe(false);
    // The globally-allowed read still ran — its content flowed back.
    expect(allReq.includes("PUBLIC-OK")).toBe(true);
  }, 30_000);

  it("L3 the extended project config (extra allow rule + extra array entry) loads cleanly", async () => {
    const env = await makeEnv("config-layering-load", fake, PROJECT_PATCH);
    envs.push(env);
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "notes.txt"), "NOTES-CONTENT");
    fake.script(
      { toolCalls: [{ name: "read_file", args: { path: "notes.txt" } }] },
      { text: "read notes" },
    );
    const run = await runBinary(env, ["--prompt", "read notes.txt"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The project config validated and extended the base (no rejection notice).
    expect(run.stderr).not.toContain("config.json.rejected");
    expect(run.stderr).not.toContain("CONFIG_INVALID");
    // The extra project allow rule + global base both resolved: the read ran.
    expect(run.stderr).not.toContain("action(s) denied");
    const sawNotes = fake.requests.some((r) => JSON.stringify(r).includes("NOTES-CONTENT"));
    expect(sawNotes).toBe(true);
  }, 30_000);

  it("L4 a project-layer webSearch endpoint loads cleanly (no global/managed-only rule)", async () => {
    const env = await makeEnv("config-layering-websearch", fake, PROJECT_PATCH);
    envs.push(env);
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "ok.txt"), "WS-OK");
    fake.script(
      { toolCalls: [{ name: "read_file", args: { path: "ok.txt" } }] },
      { text: "done" },
    );
    const run = await runBinary(env, ["--prompt", "read ok.txt"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The project webSearch endpoint validated and loaded — no rejection and no
    // "ignored (honored only from the global/managed layers)" notice.
    expect(run.stderr).not.toContain("config.json.rejected");
    expect(run.stderr).not.toContain("CONFIG_INVALID");
    expect(run.stderr).not.toContain("honored only from the global/managed");
  }, 30_000);
});
