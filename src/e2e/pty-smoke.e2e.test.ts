/**
 * Interactive-pty smoke test for the BUILT `voidrift` TUI (cli-blueprint §5.2,
 * §6.3, §3.5, §3.9, §11). Pipe-based e2e tests never start the TUI (it needs a
 * real TTY); this harness allocates a pty via python3's `pty` module, execs the
 * built binary interactively against the scriptable fake OpenAI server in a
 * hermetic HOME/XDG, drives a scripted keystroke sequence and a window resize,
 * and asserts the streamed reply, the mode bracket change (Shift+Tab), the
 * agent monitor open/close (Ctrl+G), a clean SIGWINCH reflow at 40 columns (no
 * duplicated status rule / overlap), and a clean exit (double Ctrl+C, /quit).
 *
 * python3 is OPTIONAL: CI without it skips with a clear message (no new
 * devDependency — the task forbids adding node-pty). Deterministic and bounded
 * well under 60s: the harness waits on substrings, not sleeps, and hard-kills
 * the child on timeout.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** Whether a usable `python3` with the stdlib `pty` module is on PATH. */
function hasPython3(): boolean {
  const r = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { stdio: "ignore" });
  return r.status === 0;
}

const HARNESS = path.resolve(fileURLToPath(new URL("./pty-harness.py", import.meta.url)));
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));

/** Strip ANSI/CSI/charset escapes and carriage returns for plain assertions. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][AB012]|\x1b[=><]|\r/g, "");
}

const py3 = hasPython3();
const d = py3 ? describe : describe.skip;

d("interactive pty smoke (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    if (!py3) return;
    fake = await startFakeOpenAI();
  });

  afterEach(async () => {
    while (envs.length) await envs.pop()!.cleanup();
  });

  afterAll(async () => {
    if (fake) await fake.close();
    expect(await listE2eTmp("pty")).toEqual([]);
  });

  it("boots the TUI, streams a reply, cycles mode, toggles the monitor, reflows at 40 cols, and exits", async () => {
    if (!py3) return; // belt-and-suspenders; describe.skip already guards this
    const env = await makeEnv("pty", fake);
    envs.push(env);
    // Seed the on-disk global config so Shift+Tab has a `research` agent to
    // cycle into (the headless seed is only created on first boot; the TUI reads
    // whatever agents exist). `voidrift init` would do this, but we only need the
    // default cycle, which the core seeds on first boot via createCore.
    fake.script({ text: "THE-REPLY-TOKEN" });
    fake.requests.length = 0;

    const spec = JSON.stringify({
      cli: CLI_DIST,
      cwd: env.workspace,
      env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
      prompt: "say hi",
      reply: "THE-REPLY-TOKEN",
      timeoutMs: 45_000,
    });

    // Spawn the pty harness ASYNCHRONOUSLY: the fake OpenAI server runs in THIS
    // process's event loop, so a synchronous `spawnSync` would block it and the
    // child's model request would never be served. Capture stdout and bound the
    // whole run with a kill-on-timeout so the suite never hangs.
    const run = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn("python3", [HARNESS, spec], { maxBuffer: 16 * 1024 * 1024 } as never);
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
        child.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
        const timer = setTimeout(() => child.kill("SIGKILL"), 52_000);
        child.on("exit", (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal, stdout, stderr });
        });
        child.on("error", () => {
          clearTimeout(timer);
          resolve({ status: null, signal: null, stdout, stderr });
        });
      },
    );

    expect(run.signal).toBeNull(); // not killed by the timeout
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; tail: string; output: string };
    const plain = stripAnsi(parsed.output);

    // The TUI booted (input placeholder) and streamed the scripted reply.
    expect(plain).toContain("ask a question");
    expect(plain).toContain("THE-REPLY-TOKEN");

    // Shift+Tab cycled to the next top-level agent: the bracket shows [Research]
    // at some point (the default cycle chat → research → vibe).
    expect(plain).toContain("[Research]");

    // The agent monitor opened on Ctrl+G at least once (its header text).
    expect(plain.toLowerCase()).toContain("workers");

    // SIGWINCH reflow: after the resize to 40 columns, the status rule repaints
    // at the NEW width with NO duplicated/overlapping rule. Inspect the
    // post-resize tail and assert there is a 40-wide rule and NO rule wider than
    // 40 (the defect produced 100-wide fragments overlapping a 40-wide frame).
    const tail = stripAnsi(parsed.tail);
    const tailLines = tail.split("\n").map((l) => l.replace(/\s+$/, ""));
    const ruleLines = tailLines.filter((l) => /^─+$/.test(l) && l.length > 1);
    // At least one rule was repainted after the resize.
    expect(ruleLines.length).toBeGreaterThan(0);
    // Every repainted rule fits the new 40-column width — no 100-wide leftover.
    for (const rule of ruleLines) expect(rule.length).toBeLessThanOrEqual(40);
    // A rule at exactly the new width was drawn (the status bar reflowed).
    expect(ruleLines.some((r) => r.length === 40)).toBe(true);

    // The child exited on its own (double Ctrl+C / /quit) — the harness returned
    // a status, so it did not hang; a timeout would have set `run.signal`.
    expect(run.signal).toBeNull();
  }, 58_000);
});
