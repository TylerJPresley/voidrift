/**
 * End-to-end harness: spawn the BUILT `voidrift` binary and host the BUILT core.
 *
 * Both helpers run against compiled `dist/` output — never ts-node, never the
 * source — so the e2e tests exercise exactly what ships. If `dist/cli.js` is
 * missing the spawn fails fast with a clear "run npm run build first" message
 * rather than hanging. Every child is bounded by a hard timeout and killed on
 * expiry (reported as a failure), and every temp dir is created under a
 * per-run `<vr-hermetic-*>/e2e-<label>` root (inside the run's hermetic temp
 * root, removed by the vitest globalSetup teardown) so leak-checks are
 * deterministic and nothing persists in the shared system temp dir.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FakeOpenAI } from "./fake-openai.js";

/** The compiled CLI entry (resolved from this file's location, not cwd). */
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));
/**
 * `@voidrift/core` is imported as a BARE specifier (the CLI's declared
 * dependency), not by a relative path into the core package's build output — so
 * the e2e harness honours the split-readiness rule (a package reaches a sibling
 * only through its declared dependency, not the monorepo layout). Node resolves
 * it to the built core via the workspace symlink; a missing build surfaces as a
 * clear import error below.
 */
const CORE_SPECIFIER = "@voidrift/core";

/**
 * The base for this run's e2e temp-dir roots. It lives INSIDE the run's
 * `vr-hermetic-*` temp root (the parent of the redirected `HOME`), so the
 * vitest `globalSetup` teardown removes it with the rest of the root and no
 * fixed shared `/tmp/voidrift-*` path ever persists. Per-suite `label`s still
 * give each suite its own `…-e2e-<label>` subtree, keeping the existing
 * leak-assertion discipline (`listE2eTmp(label)`) intact.
 */
function e2eTmpPrefix(): string {
  const home = process.env["HOME"];
  if (home === undefined || !home.includes("vr-hermetic-")) {
    throw new Error(
      `e2e temp root: HOME (${String(home)}) is not inside a vr-hermetic-* root; ` +
        `the globalSetup (test-hermetic.global.ts) did not run or was not inherited.`,
    );
  }
  return path.join(path.dirname(home), "e2e");
}
export const E2E_TMP_PREFIX = e2eTmpPrefix();

/** The result of a bounded binary run. */
export interface BinaryRun {
  code: number | null;
  stdout: string;
  stderr: string;
  wallMs: number;
  timedOut: boolean;
}

/** An isolated environment: temp HOME + XDG + workspace with a project config. */
export interface IsolatedEnv {
  home: string;
  xdg: string;
  workspace: string;
  /** Remove every temp dir this env owns. Idempotent. */
  cleanup: () => Promise<void>;
}

/** Assert the build output exists; throw a clear, actionable error if not. */
function assertBuilt(): void {
  if (!existsSync(CLI_DIST)) {
    throw new Error(`built CLI not found at ${CLI_DIST} — run \`npm run build\` first`);
  }
}

/**
 * Create an isolated HOME + XDG_CONFIG_HOME + workspace under a per-run
 * `<E2E_TMP_PREFIX>-<label>` root, with a project `.voidrift/config.json`
 * pointing `models.local` at the fake server (openai protocol, baseUrl,
 * contextLimit). `configPatch` deep-merges onto the base config so a test can
 * add permission rules.
 */
export async function makeEnv(
  label: string,
  fake: FakeOpenAI,
  configPatch: Record<string, unknown> = {},
): Promise<IsolatedEnv> {
  assertBuilt();
  const root = `${E2E_TMP_PREFIX}-${label}`;
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  const workspace = path.join(root, "ws");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(xdg, { recursive: true });
  await fs.mkdir(path.join(workspace, ".voidrift"), { recursive: true });

  const config = {
    models: {
      local: {
        model: "fake-model",
        protocol: "openai",
        baseUrl: fake.url,
        contextLimit: 32_000,
      },
    },
    modelSelected: "local",
    ...configPatch,
  };
  await fs.writeFile(
    path.join(workspace, ".voidrift", "config.json"),
    JSON.stringify(config, null, 2),
  );

  return {
    home,
    xdg,
    workspace,
    cleanup: async (): Promise<void> => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** The read-class built-in tools a read-only top-level test agent binds by
 * default (mirrors the seeded read allow list, §13.8). */
const READ_BUILTINS: string[] = [
  "read_file",
  "glob_files",
  "search_contents",
  "workspace_map",
  "list_skills",
  "load_skill",
];

/**
 * Write a read-only TOP-LEVEL project agent into `<workspace>/.voidrift/agents/`
 * so a headless `--prompt` run (which selects the first `unlisted: deny`
 * top-level agent by `order`) picks it instead of the seeded `research`
 * orchestrator — the seeded `research` holds no direct read/search/web tools
 * (core-blueprint §2.7), so a scenario whose point is "a read-only run calls a
 * read/web/exec tool directly" needs a test agent that binds those tools.
 *
 * `order` defaults to 5 (below the seeded `research` at 20), `unlisted` to
 * `deny` (so it is the headless read-only selection). `tools` defaults to the
 * read-class built-ins; a scenario adds whatever it exercises (e.g. `web_fetch`,
 * `execute_command`).
 */
export async function writeProjectAgent(
  env: IsolatedEnv,
  opts: { name?: string; tools?: string[]; order?: number; unlisted?: "deny" | "ask" | "allow" } = {},
): Promise<void> {
  const name = opts.name ?? "reader";
  const dir = path.join(env.workspace, ".voidrift", "agents", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "agent.json"),
    JSON.stringify(
      {
        name,
        description: `a read-only top-level test agent for e2e (${name})`,
        kind: "top-level",
        order: opts.order ?? 5,
        unlisted: opts.unlisted ?? "deny",
        prompt: "You read and inspect when asked.",
        tools: opts.tools ?? READ_BUILTINS,
      },
      null,
      2,
    ),
  );
}

/**
 * Spawn the built binary in `env.workspace` with isolated HOME/XDG and a hard
 * timeout. On timeout the child is SIGKILLed and the run is reported with
 * `timedOut: true` (a test failure) rather than hanging the suite.
 */
export async function runBinary(
  env: IsolatedEnv,
  args: string[],
  opts: { timeoutMs?: number; input?: string; extraEnv?: Record<string, string> } = {},
): Promise<BinaryRun> {
  assertBuilt();
  return runBinaryVia(env, CLI_DIST, args, opts);
}

/** The compiled CLI entry, exposed so symlink tests can link to the real file. */
export function cliDist(): string {
  return CLI_DIST;
}

/**
 * Like {@link runBinary} but spawns an ARBITRARY entry path (`entry`) instead of
 * the compiled `dist/cli.js` directly — so a test can prove the real install
 * shapes: run through `node_modules/.bin/voidrift` (a symlink to `dist/cli.js`),
 * a symlink-to-a-symlink, or a symlink whose own path contains a space. The
 * isolation, hard timeout, and offline env match `runBinary` exactly.
 */
export async function runBinaryVia(
  env: IsolatedEnv,
  entry: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; extraEnv?: Record<string, string> } = {},
): Promise<BinaryRun> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: env.workspace,
    env: {
      ...process.env,
      HOME: env.home,
      XDG_CONFIG_HOME: env.xdg,
      // Keep the child offline except for the fake server; no inherited keys.
      NO_COLOR: "1",
      ...(opts.extraEnv ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
  if (opts.input !== undefined) {
    child.stdin.write(opts.input);
  }
  child.stdin.end();

  let timedOut = false;
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  return { code, stdout, stderr, wallMs: Date.now() - start, timedOut };
}

/** The subset of the built CoreAPI an e2e cross-process step uses. */
export interface HostedCore {
  api: {
    session: {
      resume: (id: string) => Promise<unknown>;
      confirm: (id: string, response: unknown) => Promise<unknown>;
      send: (id: string, req: unknown) => Promise<unknown>;
      create: (opts: unknown) => Promise<{ ok: boolean; value?: { id: string }; error?: unknown }>;
      shutdown: () => Promise<void>;
    };
    register: { agent: (manifest: unknown) => unknown };
    subagents: {
      dispatch: (requests: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
    };
    events: { subscribe: (type: string, handler: (e: unknown) => void) => () => void };
  };
  shutdown: () => Promise<void>;
}

/**
 * Host the BUILT `@voidrift/core` the way a separate OS process would: a fresh
 * `createCore` over the SAME workspace + HOME/XDG the binary used, so the real
 * SQLite checkpointer and filesystem session repository restore the durable
 * state. Returns a thin wrapper plus a `shutdown` that drains and closes.
 */
export async function hostCore(env: IsolatedEnv): Promise<HostedCore> {
  assertBuilt();
  // Point this process at the same global config home the child used, so the
  // config cascade and all global-scope roots resolve identically.
  const prevHome = process.env["HOME"];
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  process.env["HOME"] = env.home;
  process.env["XDG_CONFIG_HOME"] = env.xdg;
  const mod = (await import(CORE_SPECIFIER).catch((e: unknown) => {
    throw new Error(
      `could not import ${CORE_SPECIFIER} — run \`npm run build\` first (${String(e)})`,
    );
  })) as {
    createCore: (opts: Record<string, unknown>) => Promise<{ api: HostedCore["api"] }>;
  };
  const ready = await mod.createCore({ workspaceRoot: env.workspace, installSignalHandlers: false });
  return {
    api: ready.api,
    shutdown: async (): Promise<void> => {
      await ready.api.session.shutdown();
      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
      if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = prevXdg;
    },
  };
}

/** List any leftover e2e temp roots (for leak assertions). */
/**
 * List leftover e2e temp roots (for leak assertions). An optional
 * `labelPrefix` scopes the result to one suite's own fixtures
 * (`<E2E_TMP_PREFIX>-<labelPrefix>…`), so two e2e files running in parallel
 * workers each assert their OWN dirs are cleaned without racing on the other's
 * in-flight dirs. With no argument it lists every e2e root (back-compat).
 */
export async function listE2eTmp(labelPrefix?: string): Promise<string[]> {
  const parent = path.dirname(E2E_TMP_PREFIX);
  const base = path.basename(E2E_TMP_PREFIX) + (labelPrefix ? `-${labelPrefix}` : "");
  const entries = await fs.readdir(parent).catch(() => [] as string[]);
  return entries.filter((e) => e.startsWith(base)).map((e) => path.join(parent, e));
}
