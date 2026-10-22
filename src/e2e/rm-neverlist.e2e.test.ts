/**
 * `rm -rf` never-list + within-workdir refinement, end-to-end (core §9.3, §13.10;
 * owner D1.4), against the BUILT `voidrift` binary and BUILT `@voidrift/core`.
 *
 *   R1 headless `--enable-write`, the model proposes `rm -rf build` INSIDE a temp
 *      workspace → it flows normally under an `unlisted: allow` agent and removes
 *      the directory for real (the directory is gone, exit 0).
 *   R2 headless `--enable-write`, the model proposes `rm -rf /` → the NEVER LIST
 *      denies it BEFORE execution (nothing is touched); the deny reason carries
 *      the never-list sentence; exit 0 (denied-and-continue). A root-deleting
 *      command is NEVER executed for real — the Guardian denies first.
 *
 * A project top-level agent `doer` (`unlisted: allow`, `confirm`, binds
 * `execute_command`) is seeded so the headless write selection picks it and the
 * `rm` runs through the real shell under the auto-approve posture — proving the
 * end-to-end path, not a worker loop. Only a temp workspace is used; the
 * dangerous command relies on the Guardian denying before execution.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** Seed a project top-level `unlisted: allow` agent that binds execute_command,
 * ordered first so the headless `--enable-write` selection picks it. */
async function seedDoer(env: IsolatedEnv): Promise<void> {
  const dir = path.join(env.workspace, ".voidrift", "agents", "doer");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "agent.json"),
    JSON.stringify(
      {
        name: "doer",
        description: "runs commands directly for the e2e",
        kind: "top-level",
        order: 5,
        unlisted: "allow",
        confirm: true,
        workers: "all",
        tools: ["read_file", "glob_files", "execute_command"],
      },
      null,
      2,
    ),
  );
  await fs.writeFile(path.join(dir, "prompt.md"), "You run the requested command.");
}

describe("rm -rf never-list + within-workdir (e2e)", () => {
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
    expect(await listE2eTmp("rm-neverlist")).toHaveLength(0);
  });

  it("R1 `rm -rf build` inside the workspace executes and removes the directory (exit 0)", async () => {
    const env = await makeEnv("rm-neverlist-inside", fake, {});
    envs.push(env);
    await seedDoer(env);
    const buildDir = path.join(env.workspace, "build");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, "artifact.txt"), "x");
    expect(existsSync(buildDir)).toBe(true);

    fake.script(
      { toolCalls: [{ name: "execute_command", args: { command: "rm -rf build" } }] },
      { text: "removed build" },
    );
    const run = await runBinary(env, ["--prompt", "clean the build dir", "--enable-write"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // The directory is actually gone — the inside-workdir rm flowed and ran.
    expect(existsSync(buildDir)).toBe(false);
  }, 30_000);

  it("R2 `rm -rf /` is denied by the NEVER LIST before execution; nothing is touched (exit 0)", async () => {
    const env = await makeEnv("rm-neverlist-root", fake, {});
    envs.push(env);
    await seedDoer(env);
    // A sentinel file in the workspace proves nothing was deleted.
    const sentinel = path.join(env.workspace, "keep.txt");
    await fs.writeFile(sentinel, "KEEP");

    fake.script(
      { toolCalls: [{ name: "execute_command", args: { command: "rm -rf /" } }] },
      { text: "could not remove" },
    );
    const run = await runBinary(env, ["--prompt", "wipe everything", "--enable-write"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0); // denied-and-continue, not a crash / not exit 5
    // The Guardian denied the never-list command BEFORE the shell ran: the
    // sentinel is intact and the model saw the never-list refusal fed back.
    expect(existsSync(sentinel)).toBe(true);
    const sawNever = fake.requests.some((r) => JSON.stringify(r).includes("never list: delete-system-dirs"));
    expect(sawNever, "the model received the never-list deny reason").toBe(true);
  }, 30_000);
});
