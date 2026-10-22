/**
 * Built-binary e2e for `voidrift init` and the one first-run stderr line
 * (cli-blueprint.md §2.1, §2.6; core §13.8, §13.9.1).
 *
 * Runs the SHIPPED `dist/cli.js` with isolated HOME/XDG/workspace under the
 * per-run `<hermetic>/e2e-init*` roots, so it exercises exactly what ships and
 * NEVER touches the ambient HOME/XDG or the real `~/.config/voidrift`. Each case
 * owns its temp dirs and cleans them; the leak check asserts none remain.
 *
 * `init` needs no model and no network — these cases run it with no config and
 * no server reachable. The first-run cases use the committed fake OpenAI server.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createHash as hash } from "node:crypto";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, runBinaryVia, cliDist, listE2eTmp, E2E_TMP_PREFIX, type IsolatedEnv } from "./run-binary.js";

/** An isolated env with an EMPTY home/xdg and a bare workspace (NO project
 * config pre-written), under a per-run `<hermetic>/e2e-<label>` root. */
async function makeBareEnv(label: string): Promise<IsolatedEnv> {
  const root = `${E2E_TMP_PREFIX}-${label}`;
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  const workspace = path.join(root, "ws");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(xdg, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  return {
    home,
    xdg,
    workspace,
    cleanup: async () => void (await fs.rm(root, { recursive: true, force: true })),
  };
}

/** The resolved global config dir for an isolated env (XDG_CONFIG_HOME/voidrift). */
function globalDir(env: IsolatedEnv): string {
  return path.join(env.xdg, "voidrift");
}

/** Read the single backup-tree copy of `rel` under `<globalDir>/backups/<ts>/`
 * (§13.9.1); throws unless exactly one set holds it. */
async function readGlobalBackup(env: IsolatedEnv, rel: string): Promise<string> {
  const backupsDir = path.join(globalDir(env), "backups");
  const sets = (await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const hits: string[] = [];
  for (const s of sets) {
    const abs = path.join(backupsDir, s, rel);
    if (existsSync(abs)) hits.push(await fs.readFile(abs, "utf8"));
  }
  if (hits.length !== 1) throw new Error(`expected one backup of ${rel}, found ${hits.length}`);
  return hits[0]!;
}

/** A stable hash of the whole global tree (relative path + content), for the
 * "nothing changed on the second run" assertion. */
async function hashTree(dir: string): Promise<string> {
  const h = hash("sha256");
  const walk = async (d: string, rel: string): Promise<void> => {
    const entries = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) await walk(abs, r);
      else h.update(`${r}\0${await fs.readFile(abs, "utf8")}\0`);
    }
  };
  await walk(dir, "");
  return h.digest("hex");
}

describe("voidrift init + first-run line (e2e)", () => {
  const envs: IsolatedEnv[] = [];
  let fake: FakeOpenAI;

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
    expect(await listE2eTmp("init")).toHaveLength(0);
  });

  it("empty home: `voidrift init` creates the global tree and <cwd>/.voidrift/ and prints the summary; needs no model/network", async () => {
    const env = await makeBareEnv("init-create");
    envs.push(env);
    const run = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // Global base created.
    const g = globalDir(env);
    expect(existsSync(path.join(g, "config.json"))).toBe(true);
    expect(existsSync(path.join(g, "agents", "research", "agent.json"))).toBe(true);
    expect(existsSync(path.join(g, "agents", "reviewer", "prompt.md"))).toBe(true);
    // Private modes.
    expect(statSync(g).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(g, "config.json")).mode & 0o777).toBe(0o600);
    // Project skeleton created in cwd.
    expect(existsSync(path.join(env.workspace, ".voidrift", "config.json"))).toBe(true);
    expect(existsSync(path.join(env.workspace, ".voidrift", "agents"))).toBe(true);
    // Summary to stdout; it is NOT the first-run line (init reports its own).
    expect(run.stdout).toContain("created: ");
    expect(run.stdout).toContain("~/.config/voidrift/config.json");
    expect(run.stdout).toContain("~/.config/voidrift/agents/research/agent.json");
    expect(run.stdout).toContain(".voidrift/config.json"); // the project skeleton
    expect(run.stderr).not.toContain("(first run)");
  }, 30_000);

  it("second run prints `left alone` only and the tree is byte-identical", async () => {
    const env = await makeBareEnv("init-idempotent");
    envs.push(env);
    const first = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(first.code).toBe(0);
    const before = await hashTree(globalDir(env));
    const second = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(second.code).toBe(0);
    const after = await hashTree(globalDir(env));
    expect(after).toBe(before);
    expect(second.stdout).toContain("left alone:");
    expect(second.stdout).not.toContain("created: ~/.config/voidrift");
    expect(second.stdout).not.toContain("repaired:");
  }, 40_000);

  it("a deleted seeded agent dir is recreated (only it)", async () => {
    const env = await makeBareEnv("init-redelete");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const planner = path.join(globalDir(env), "agents", "planner");
    await fs.rm(planner, { recursive: true, force: true });
    const run = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(run.code).toBe(0);
    expect(existsSync(path.join(planner, "agent.json"))).toBe(true);
    expect(run.stdout).toContain("created: ~/.config/voidrift/agents/planner/agent.json");
    // Other agents untouched → mostly left alone.
    expect(run.stdout).toContain("left alone:");
  }, 40_000);

  it("a corrupted agent.json is reported `repaired` with its old content moved to the backup tree", async () => {
    const env = await makeBareEnv("init-repair");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const agent = path.join(globalDir(env), "agents", "reviewer", "agent.json");
    const broken = "{ not valid json at all";
    await fs.writeFile(agent, broken);
    const run = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("repaired: ~/.config/voidrift/agents/reviewer/agent.json");
    expect(run.stdout).toContain("backups/");
    expect(await readGlobalBackup(env, "agents/reviewer/agent.json")).toBe(broken);
    expect(existsSync(agent + ".rejected")).toBe(false);
    // Replaced with a valid default.
    const agentJson = await fs.readFile(agent, "utf8");
    expect(() => JSON.parse(agentJson)).not.toThrow();
  }, 40_000);

  it("a customized valid prompt.md is left untouched", async () => {
    const env = await makeBareEnv("init-custom");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const prompt = path.join(globalDir(env), "agents", "vibe", "prompt.md");
    const custom = "# My own vibe prompt\nStay out of my file.\n";
    await fs.writeFile(prompt, custom);
    const run = await runBinary(env, ["init"], { timeoutMs: 20_000 });
    expect(run.code).toBe(0);
    expect(await fs.readFile(prompt, "utf8")).toBe(custom);
  }, 40_000);

  it("`init --reset <name>` non-interactively refuses (exit 2) and changes nothing", async () => {
    const env = await makeBareEnv("init-reset-refuse");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const prompt = path.join(globalDir(env), "agents", "researcher", "prompt.md");
    const custom = "custom researcher\n";
    await fs.writeFile(prompt, custom);
    const run = await runBinary(env, ["init", "--reset", "researcher"], { timeoutMs: 20_000 });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("not a TTY");
    expect(await fs.readFile(prompt, "utf8")).toBe(custom);
    expect(existsSync(prompt + ".rejected")).toBe(false);
  }, 40_000);

  it("`init --reset <name> --yes` restores the default and moves the old into the backup tree", async () => {
    const env = await makeBareEnv("init-reset-yes");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const prompt = path.join(globalDir(env), "agents", "researcher", "prompt.md");
    const seeded = await fs.readFile(prompt, "utf8");
    const custom = "custom researcher\n";
    await fs.writeFile(prompt, custom);
    const run = await runBinary(env, ["init", "--reset", "researcher", "--yes"], { timeoutMs: 20_000 });
    expect(run.code).toBe(0);
    expect(await fs.readFile(prompt, "utf8")).toBe(seeded);
    expect(await readGlobalBackup(env, "agents/researcher/prompt.md")).toBe(custom);
    expect(existsSync(prompt + ".rejected")).toBe(false);
    // The diff was shown.
    expect(run.stdout).toContain("- custom researcher");
  }, 40_000);

  it("an unknown reset name exits 2 and lists the valid names", async () => {
    const env = await makeBareEnv("init-reset-unknown");
    envs.push(env);
    await runBinary(env, ["init"], { timeoutMs: 20_000 });
    const run = await runBinary(env, ["init", "--reset", "nope"], { timeoutMs: 20_000 });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('unknown reset target "nope"');
    expect(run.stderr).toContain("config");
  }, 40_000);

  it("first `--prompt` in an empty home prints the first-run line once; the second run does not", async () => {
    // makeEnv seeds a PROJECT config pointing at the fake, but leaves HOME/XDG
    // empty, so the first run seeds the global base and prints the line once.
    const env = await makeEnv("init-firstrun-prompt", fake);
    envs.push(env);
    fake.script({ text: "ok" });
    const first = await runBinary(env, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(first.code).toBe(0);
    const firstRunLines = first.stderr.split("\n").filter((l) => l.includes("(first run)"));
    expect(firstRunLines).toHaveLength(1);
    expect(firstRunLines[0]).toBe("voidrift: created ~/.config/voidrift (first run)");

    fake.script({ text: "ok2" });
    fake.requests.length = 0;
    const second = await runBinary(env, ["--prompt", "hi again"], { timeoutMs: 20_000 });
    expect(second.code).toBe(0);
    expect(second.stderr).not.toContain("(first run)");
  }, 40_000);

  it("`--version` and `--help` never print the first-run line (even in an empty home)", async () => {
    const env = await makeBareEnv("init-firstrun-none");
    envs.push(env);
    const version = await runBinaryVia(env, cliDist(), ["--version"], { timeoutMs: 20_000 });
    expect(version.code).toBe(0);
    expect(version.stderr).not.toContain("(first run)");
    // Global dir was NOT created by --version.
    expect(existsSync(globalDir(env))).toBe(false);
    const help = await runBinaryVia(env, cliDist(), ["--help"], { timeoutMs: 20_000 });
    expect(help.code).toBe(0);
    expect(help.stderr).not.toContain("(first run)");
    expect(existsSync(globalDir(env))).toBe(false);
  }, 40_000);
});

describe("clean-live-directory startup gate + init --sweep (e2e §13.9.1)", () => {
  const envs: IsolatedEnv[] = [];
  let fake: FakeOpenAI;

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
    expect(await listE2eTmp("sweep")).toHaveLength(0);
  });

  it("a `.bak` in a global agents/<name>/ dir makes chat/--prompt FAIL (exit 3) listing it; doctor/init/--help still run; --sweep fixes it", async () => {
    // A project config pointing at the fake so a post-sweep --prompt can run.
    const env = await makeEnv("sweep-startup", fake);
    envs.push(env);
    // Seed the global base, then drop a leftover inside a live resource dir.
    expect((await runBinary(env, ["init"], { timeoutMs: 20_000 })).code).toBe(0);
    const reviewer = path.join(globalDir(env), "agents", "reviewer");
    const leftover = path.join(reviewer, "agent.json.bak");
    await fs.writeFile(leftover, "stale");

    // chat refuses with exit 3, lists the file (home shortened), names the fix.
    const chat = await runBinary(env, ["chat"], { timeoutMs: 20_000 });
    expect(chat.code).toBe(3);
    expect(chat.stderr).toContain("agent.json.bak");
    expect(chat.stderr).toContain("voidrift init --sweep");

    // --prompt also refuses (exit 3) and never calls the model.
    fake.script({ text: "should-not-run" });
    fake.requests.length = 0;
    const prompt = await runBinary(env, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(prompt.code).toBe(3);
    expect(fake.requests.length).toBe(0);

    // The diagnosis/cure commands still RUN while the leftover exists (they are
    // not blocked by the startup gate). `doctor` runs and reports the leftover
    // as a FAIL (exit 1, not the exit-3 startup refusal); `--help` exits 0.
    const doctor = await runBinary(env, ["doctor", "--offline"], { timeoutMs: 20_000 });
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain("voidrift init --sweep");
    expect((await runBinary(env, ["--help"], { timeoutMs: 20_000 })).code).toBe(0);
    // `init` itself runs too (it is the cure).
    expect((await runBinary(env, ["init"], { timeoutMs: 20_000 })).code).toBe(0);

    // --sweep moves exactly the leftover, leaving the canonical files.
    const sweep = await runBinary(env, ["init", "--sweep"], { timeoutMs: 20_000 });
    expect(sweep.code).toBe(0);
    expect(sweep.stdout).toContain("moved:");
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(path.join(reviewer, "agent.json"))).toBe(true);
    expect(existsSync(path.join(reviewer, "prompt.md"))).toBe(true);

    // A following --prompt now starts (exit 0) and reaches the model.
    fake.script({ text: "ok" });
    fake.requests.length = 0;
    const after = await runBinary(env, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(after.code).toBe(0);
  }, 90_000);

  it("a config-ROOT `config.json.bak-*` alone never blocks startup (doctor warns, startup runs)", async () => {
    const env = await makeEnv("sweep-rootonly", fake);
    envs.push(env);
    expect((await runBinary(env, ["init"], { timeoutMs: 20_000 })).code).toBe(0);
    await fs.writeFile(path.join(globalDir(env), "config.json.bak-20261020"), "old");

    // Startup is NOT blocked.
    fake.script({ text: "ok" });
    const after = await runBinary(env, ["--prompt", "hi"], { timeoutMs: 20_000 });
    expect(after.code).toBe(0);

    // doctor still exits 0 (a warn, not a fail) and names the sweep fix.
    const doctor = await runBinary(env, ["doctor", "--offline"], { timeoutMs: 20_000 });
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain("voidrift init --sweep");
  }, 90_000);
});
