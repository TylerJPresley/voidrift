/**
 * Control-file protection end-to-end (owner S1; core §8.4, §9.4), against the
 * BUILT `voidrift` binary and BUILT `@voidrift/core`.
 *
 * A headless `--enable-write` run under an `unlisted: allow` agent that HOLDS
 * the direct write tools must STILL refuse to change a VoidRift control file:
 *   - `echo x > .voidrift/config.json` (a safe `echo` + redirect) is a
 *     control-file DENY (deny class) — never runs.
 *   - a `write_file` of `AGENTS.md` is a control-file FORCE-ASK; a headless run
 *     never asks, so it is denied-and-continue.
 * Both are refused and both files are UNCHANGED byte-for-byte. The run completes
 * (exit 0, read-only-style denial counting does not apply to a write run; the
 * refusals are posture-independent control-file blocks).
 *
 * Bounded + leak-free: per-run `<hermetic>/e2e-control-file*` roots, asserted
 * empty in afterAll.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** A project agent that is `unlisted: allow` (picked by a headless write run as
 * the first allow agent — order 5 beats seeded vibe at 30) and HOLDS the direct
 * write tools, so the control-file blocks are exercised at the gate (vibe has no
 * direct write tools). */
const WRITER_AGENT = {
  name: "writer",
  description: "writes directly for the control-file e2e",
  kind: "top-level",
  order: 5,
  unlisted: "allow",
  confirm: true,
  workers: "all",
  tools: ["read_file", "write_file", "edit_file", "execute_command", "task"],
};

describe("control-file protection (e2e)", () => {
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
    expect(await listE2eTmp("control-file")).toHaveLength(0);
  });

  it("refuses a shell write to .voidrift/config.json and a write_file of AGENTS.md; both files unchanged", async () => {
    const env = await makeEnv("control-file-block", fake, {});
    envs.push(env);

    // The custom allow+write agent lives in the PROJECT agents folder.
    const agentDir = path.join(env.workspace, ".voidrift", "agents", "writer");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "agent.json"), JSON.stringify(WRITER_AGENT, null, 2));
    await fs.writeFile(path.join(agentDir, "prompt.md"), "You write files.");

    // Seed AGENTS.md with known content and record the config bytes.
    const agentsMd = path.join(env.workspace, "AGENTS.md");
    await fs.writeFile(agentsMd, "ORIGINAL-AGENTS-CONTENT\n");
    const configPath = path.join(env.workspace, ".voidrift", "config.json");
    const configBefore = await fs.readFile(configPath);
    const agentsBefore = await fs.readFile(agentsMd);

    fake.script(
      { toolCalls: [{ name: "execute_command", args: { command: "echo x > .voidrift/config.json" } }] },
      { toolCalls: [{ name: "write_file", args: { path: "AGENTS.md", content: "HIJACKED" } }] },
      { text: "could not change the control files" },
    );

    const run = await runBinary(env, ["--prompt", "hijack the control files", "--enable-write"], {
      timeoutMs: 30_000,
    });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0); // not exit 5 — headless denies-and-continues

    // Both control files are byte-for-byte unchanged.
    expect(await fs.readFile(configPath)).toEqual(configBefore);
    expect(await fs.readFile(agentsMd)).toEqual(agentsBefore);
    // The model was told both actions were refused (a permission denial result).
    expect(fake.requests.length).toBeGreaterThanOrEqual(2);
  }, 40_000);
});
