/**
 * Built-binary e2e for `voidrift doctor` (cli-blueprint.md §2.1, §2.6; core
 * §13.9.2).
 *
 * Runs the SHIPPED `dist/cli.js` with isolated HOME/XDG/workspace under the
 * per-run `<hermetic>/e2e-doctor*` roots, so it exercises exactly what ships
 * and NEVER touches the ambient HOME/XDG or the real `~/.config/voidrift`.
 *
 * `doctor` needs no model and no session. A healthy seeded install (`init` then
 * `doctor --offline`) exits 0; a broken config exits 1 with fixes; `--offline`
 * sends ZERO requests to the fake server.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { runBinary, E2E_TMP_PREFIX, type IsolatedEnv } from "./run-binary.js";

async function makeBareEnv(label: string): Promise<IsolatedEnv> {
  const root = `${E2E_TMP_PREFIX}-${label}`;
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  const workspace = path.join(root, "ws");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(xdg, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  return { home, xdg, workspace, cleanup: async () => void (await fs.rm(root, { recursive: true, force: true })) };
}

describe("voidrift doctor (e2e)", () => {
  const envs: IsolatedEnv[] = [];
  let fake: FakeOpenAI;

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterAll(async () => {
    await fake.close();
    while (envs.length) await envs.pop()!.cleanup();
  });

  it("a healthy seeded install exits 0 (offline) and prints the summary", async () => {
    const env = await makeBareEnv("doctor-healthy");
    envs.push(env);
    const init = await runBinary(env, ["init"]);
    expect(init.code).toBe(0);
    const r = await runBinary(env, ["doctor", "--offline"]);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\d+ ok, \d+ warn, \d+ fail/);
  });

  it("--offline sends ZERO requests to the model server", async () => {
    const env = await makeBareEnv("doctor-offline");
    envs.push(env);
    // A config pointing at the fake server; offline must not probe it.
    await fs.mkdir(path.join(env.xdg, "voidrift"), { recursive: true });
    await fs.writeFile(
      path.join(env.xdg, "voidrift", "config.json"),
      JSON.stringify({ models: { local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 32000 } }, modelSelected: "local" }),
    );
    fake.requests.length = 0;
    const r = await runBinary(env, ["doctor", "--offline", "--json"]);
    expect(r.code).toBe(0);
    expect(fake.requests.length).toBe(0);
    // --json emits exactly one parseable document.
    const parsed = JSON.parse(r.stdout.trim()) as { exitCode: number };
    expect(parsed.exitCode).toBe(0);
  });

  it("a broken config exits 1 with a fix in the findings", async () => {
    const env = await makeBareEnv("doctor-broken");
    envs.push(env);
    await fs.mkdir(path.join(env.xdg, "voidrift"), { recursive: true });
    await fs.writeFile(path.join(env.xdg, "voidrift", "config.json"), "{ broken json");
    const r = await runBinary(env, ["doctor", "--offline"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("fix:");
  });
});
