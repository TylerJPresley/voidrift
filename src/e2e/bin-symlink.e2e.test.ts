/**
 * Real-binary end-to-end test for the npm bin SYMLINK install paths
 * (cli-blueprint.md §2; the `bin: { voidrift: ./dist/cli.js }` shape).
 *
 * The bug: invoked through an npm bin symlink (`node_modules/.bin/voidrift ->
 * …/dist/cli.js`), `voidrift --version` / `--prompt` printed NOTHING and exited
 * 0, because the entry guard string-compared `import.meta.url` (the realpath) to
 * `` `file://${process.argv[1]}` `` (the symlink path). These tests run the BUILT
 * binary THROUGH real symlinks — the exact shapes a user hits after `npm i -g`
 * or `npm link` — and assert real output and exit codes.
 *
 * Shapes covered: (a) a direct symlink to `dist/cli.js`; (b) a symlink pointing
 * at ANOTHER symlink (symlink-through-symlink); (c) a symlink whose own path
 * contains a space. Each runs `--version` (pure, no model) and one `--prompt`
 * against the scriptable fake OpenAI server through the symlink.
 *
 * Hermetic: HOME/XDG are isolated under the per-run `<hermetic>/e2e-symlink*`
 * roots and the real `~/.config/voidrift` is never touched; every temp dir and
 * the fake server are cleaned, and the leak check asserts no root remains.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinaryVia, cliDist, listE2eTmp, type IsolatedEnv } from "./run-binary.js";
import { CLI_VERSION } from "../version.js";

describe("real-binary runs through npm bin symlinks (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterEach(() => {
    fake.script();
    fake.requests.length = 0;
  });
  afterAll(async () => {
    await fake.close();
    while (envs.length) await envs.pop()!.cleanup();
    expect(await listE2eTmp("symlink")).toHaveLength(0);
  });

  /** Make an isolated env and a symlink to the given target under its root. */
  async function link(label: string, rel: string, target: string): Promise<{ env: IsolatedEnv; link: string }> {
    const env = await makeEnv(label, fake);
    envs.push(env);
    const linkPath = path.join(path.dirname(env.workspace), rel);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(target, linkPath);
    return { env, link: linkPath };
  }

  it("(a) a direct symlink -> dist/cli.js: --version prints, --prompt streams", async () => {
    const { env, link: bin } = await link("symlink-a", "node_modules/.bin/voidrift", cliDist());

    const version = await runBinaryVia(env, bin, ["--version"], { timeoutMs: 20_000 });
    expect(version.timedOut).toBe(false);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(CLI_VERSION); // NOT empty — the bug.

    fake.script({ text: "hi there" });
    fake.requests.length = 0;
    const prompt = await runBinaryVia(env, bin, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(prompt.timedOut).toBe(false);
    expect(prompt.code).toBe(0);
    expect(prompt.stdout).toContain("hi there");
    expect(fake.requests.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("(b) a symlink-through-symlink still runs", async () => {
    const { env, link: first } = await link("symlink-b", "stage/first", cliDist());
    const second = path.join(path.dirname(env.workspace), "bin", "voidrift");
    await mkdir(path.dirname(second), { recursive: true });
    await symlink(first, second);

    const version = await runBinaryVia(env, second, ["--version"], { timeoutMs: 20_000 });
    expect(version.timedOut).toBe(false);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(CLI_VERSION);
  }, 30_000);

  it("(c) a symlink whose path contains a space runs", async () => {
    const { env, link: bin } = await link("symlink-c", "a bin dir/voidrift cli", cliDist());

    const version = await runBinaryVia(env, bin, ["--version"], { timeoutMs: 20_000 });
    expect(version.timedOut).toBe(false);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(CLI_VERSION);

    fake.script({ text: "spaced ok" });
    fake.requests.length = 0;
    const prompt = await runBinaryVia(env, bin, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(prompt.timedOut).toBe(false);
    expect(prompt.code).toBe(0);
    expect(prompt.stdout).toContain("spaced ok");
  }, 30_000);
});
