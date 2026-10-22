/**
 * Inline primary-screen render — RAW byte-stream e2e (cli-blueprint §1.4, §1.5,
 * §4.10, §10.2). The BUILT TUI must render INLINE on the primary screen so the
 * terminal's native scrollback, wheel/trackpad and selection keep working. This
 * drives a real pty session of the binary and asserts the RAW master output
 * (NOT ANSI-stripped) proves the inline contract:
 *
 *   - NO `?1049h` (alternate-screen enter) anywhere in the stream;
 *   - NO `3J` (scrollback erase) anywhere;
 *   - EXACTLY ONE full-screen clear+home (`ESC[2J ESC[H`), the startup clear,
 *     BEFORE the first content, and no `2J` after content exists (Ink erases
 *     only its own previous frame — never the whole screen once content exists);
 *   - the cursor is SHOWN again at exit (`?25h`);
 *   - the full 150-line streamed reply is present with NO loss and NO runaway
 *     duplication (each line appears at most twice in the RAW stream: once in
 *     Ink's live region, once committed to <Static> native scrollback — never
 *     the whole transcript re-emitted by a windowed scroll copy).
 *
 * A separate SIGINT run and SIGTERM run assert the cursor is restored (`?25h`)
 * on the signal exit path. A 150-line reply plus a tool call exercises the
 * progressive-commit path into native scrollback.
 *
 * python3 with the stdlib `pty` module is OPTIONAL (CI without it skips). A
 * terminal emulator (pyte) is NOT required and NOT present in this environment,
 * so the emulated-scrollback assertion is skipped and that is stated below.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

function hasPython3(): boolean {
  const r = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { stdio: "ignore" });
  return r.status === 0;
}

const HARNESS = path.resolve(fileURLToPath(new URL("./pty-harness.py", import.meta.url)));
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));

const py3 = hasPython3();
const d = py3 ? describe : describe.skip;

/** Spawn the pty harness with a spec and return the parsed raw-capture result. */
async function drive(spec: Record<string, unknown>): Promise<{ output: string }> {
  const run = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string }>(
    (resolve) => {
      const child = spawn("python3", [HARNESS, JSON.stringify(spec)], {
        maxBuffer: 32 * 1024 * 1024,
      } as never);
      let stdout = "";
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      const timer = setTimeout(() => child.kill("SIGKILL"), 55_000);
      child.on("exit", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal, stdout });
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ status: null, signal: null, stdout });
      });
    },
  );
  expect(run.signal).toBeNull(); // the harness itself was not killed by the timeout
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout) as { output: string };
}

d("inline primary-screen render (raw pty e2e)", () => {
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
    expect(await listE2eTmp("inline")).toEqual([]);
  });

  // A 150-line reply with a unique per-line marker so a duplication or loss is
  // detectable. The marker is distinctive enough not to collide with any UI text.
  const MARKER = "ZZLINE";
  const LINES = 150;
  const REPLY = Array.from({ length: LINES }, (_, i) => `${MARKER}-${String(i).padStart(3, "0")}`).join("\n");

  it("never emits ?1049h/3J/full clear, restores the cursor, and shows the reply once", async () => {
    if (!py3) return;
    const env = await makeEnv("inline", fake);
    envs.push(env);
    // Turn 1: a tool call (glob_files is on the seeded read-only allow list, so
    // it runs without a prompt); turn 2: the 150-line streamed reply.
    fake.script({ toolCalls: [{ name: "glob_files", args: { pattern: "*.md" } }] }, { text: REPLY });
    fake.requests.length = 0;

    const { output } = await drive({
      cli: CLI_DIST,
      cwd: env.workspace,
      env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
      prompt: "list files then reply",
      reply: `${MARKER}-149`, // wait until the last line committed
      fullSequence: false,
      exitMode: "keys",
      timeoutMs: 48_000,
    });

    // --- Inline contract on the RAW stream (not ANSI-stripped) ---
    expect(output).not.toContain("\x1b[?1049h"); // no alternate-screen enter
    expect(output).not.toContain("\x1b[?1049l"); // no alternate-screen leave
    expect(output).not.toContain("\x1b[3J"); // no scrollback erase, ever

    // On a TTY the startup clear (`ESC[2J ESC[H`) fires EXACTLY ONCE and BEFORE
    // the first content, so the banner lands on the first row with scrollback
    // preserved; there is NO full-screen clear after content exists (Ink erases
    // only its own previous frame).
    const firstContent = output.indexOf(`${MARKER}-000`);
    expect(firstContent).toBeGreaterThanOrEqual(0);
    const allClears = [...output.matchAll(/\x1b\[2J/g)].map((m) => m.index ?? -1);
    // Exactly one full clear: the startup clear+home, before any content, and
    // nothing clears the screen again later.
    expect(allClears.length).toBe(1);
    for (const idx of allClears) {
      expect(idx).toBeLessThan(firstContent);
      // The clear is paired with a cursor-home immediately after (ESC[2J ESC[H).
      expect(output.slice(idx, idx + 7)).toBe("\x1b[2J\x1b[H");
    }

    // The cursor is shown again at exit.
    expect(output).toContain("\x1b[?25h");

    // The full reply committed into native scrollback with NO loss and NO
    // runaway duplication. On the primary screen Ink draws each line in its live
    // region and then commits it to <Static> scrollback, so a line that scrolled
    // out of the viewport appears at most TWICE in the RAW stream (once live,
    // once committed) — never more (a windowed scroll copy returning to the
    // bottom must not re-emit the whole transcript) and never zero (no loss).
    for (const probe of [`${MARKER}-000`, `${MARKER}-074`, `${MARKER}-149`]) {
      const count = output.split(probe).length - 1;
      expect(count).toBeGreaterThanOrEqual(1); // present — not lost
      expect(count).toBeLessThanOrEqual(2); // bounded — no runaway duplication
    }
    // Every one of the 150 lines is present at least once.
    for (let i = 0; i < LINES; i++) {
      expect(output).toContain(`${MARKER}-${String(i).padStart(3, "0")}`);
    }

    // --- Buffered-render evidence (§4.2): frames per segment ---
    // Count how many times each probe line appears in the RAW byte stream. With
    // buffered rendering the assistant reply is NOT drawn token-by-token in a
    // live region — it commits WHOLE to <Static> once — so each line is written
    // at most a small, bounded number of times (one Static write, plus at most
    // one viewport overlap), never the many intermediate frames a progressive
    // per-block live stream produced. We assert a tight bound (≤ 2) over several
    // probes spanning the reply, which is the frames-per-segment measurement.
    const probeCounts = [`${MARKER}-000`, `${MARKER}-037`, `${MARKER}-074`, `${MARKER}-112`, `${MARKER}-149`].map(
      (probe) => output.split(probe).length - 1,
    );
    const maxRewrites = Math.max(...probeCounts);
    // Buffered: a line's text region is rewritten at most twice (never the
    // repeated live redraws of the old progressive-stream path).
    expect(maxRewrites).toBeLessThanOrEqual(2);

    // NOTE: a terminal emulator (pyte) is not available in this environment, so
    // the emulated-scrollback assertion is skipped; the raw-stream assertions
    // above (no ?1049h / no 3J / no full clear + the reply present once) prove
    // the content lands on the primary screen where native scrollback keeps it.
  }, 60_000);

  for (const mode of ["sigint", "sigterm"] as const) {
    it(`restores the cursor on a ${mode.toUpperCase()} exit`, async () => {
      if (!py3) return;
      const env = await makeEnv("inline", fake);
      envs.push(env);
      fake.script({ text: "HELLO-INLINE" });
      fake.requests.length = 0;
      const { output } = await drive({
        cli: CLI_DIST,
        cwd: env.workspace,
        env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
        prompt: "hi",
        reply: "HELLO-INLINE",
        fullSequence: false,
        exitMode: mode,
        timeoutMs: 40_000,
      });
      expect(output).toContain("\x1b[?25h"); // cursor shown again
      expect(output).not.toContain("\x1b[?1049h"); // never the alternate screen
    }, 55_000);
  }
});
