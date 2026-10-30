/**
 * Resize-leftover regression (owner-reported, real session, cli-blueprint §5.2).
 * After the terminal is resized NARROWER while the `⠠ Thinking · N s` spinner is
 * live, several stale spinner lines and duplicate dim rules are left on screen:
 * Ink's `resized()` clears `previousLineCount` LOGICAL lines, but the terminal
 * has already rewrapped the old full-width frame (rules, status line) into MORE
 * physical rows, so too few rows are erased and the old frame survives.
 *
 * This boots the BUILT TUI in a real pty against a HANGING fake model (live
 * spinner), resizes 100→40 and 100→60, then replays the captured bytes into a
 * headless terminal emulator at the matching widths and asserts the VISIBLE
 * screen holds exactly ONE spinner line and ONE status/footer block. Before the
 * fix the emulator shows several — it reproduces the leftover the user saw.
 *
 * python3 is OPTIONAL: without it the suite skips with a clear message (no new
 * devDependency beyond `@xterm/headless`, the CLI's MIT emulator dep).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, listE2eTmp, type IsolatedEnv } from "./run-binary.js";
import { replayWithResize, screenLines, type ResizeCapture } from "./terminal-emulator.js";

function hasPython3(): boolean {
  const r = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { stdio: "ignore" });
  return r.status === 0;
}

const HARNESS = path.resolve(fileURLToPath(new URL("./pty-resize-capture.py", import.meta.url)));
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));

const py3 = hasPython3();
const d = py3 ? describe : describe.skip;

/** Run the capture harness for one start→target resize; returns the raw capture. */
async function capture(env: IsolatedEnv, startCols: number, targetCols: number): Promise<ResizeCapture> {
  const spec = JSON.stringify({
    cli: CLI_DIST,
    cwd: env.workspace,
    env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
    prompt: "say hi",
    startCols,
    targetCols,
    rows: 40,
    timeoutMs: 30_000,
  });
  const run = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string }>(
    (resolve) => {
      const child = spawn("python3", [HARNESS, spec], { maxBuffer: 32 * 1024 * 1024 } as never);
      let stdout = "";
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
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
  expect(run.signal).toBeNull();
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout) as ResizeCapture;
}

d("resize-leftover: one spinner + one status block after a narrower resize (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    if (!py3) return;
    fake = await startFakeOpenAI();
    // The model HANGS (a long delay) so the spinner stays live across the resize.
    fake.always({ text: "never-sent", delayMs: 60_000 });
  });

  afterEach(async () => {
    while (envs.length) await envs.pop()!.cleanup();
  });

  afterAll(async () => {
    if (fake) await fake.close();
    expect(await listE2eTmp("resize")).toEqual([]);
  });

  for (const targetCols of [40, 60]) {
    it(`100→${targetCols}: exactly one spinner line and one status/footer block`, async () => {
      if (!py3) return;
      const env = await makeEnv("resize", fake);
      envs.push(env);
      const cap = await capture(env, 100, targetCols);
      expect(cap.ok).toBe(true);
      expect(cap.resizeIndex).toBeGreaterThan(0);

      const term = await replayWithResize(cap);
      const visible = screenLines(term);

      // The live spinner verb appears on exactly ONE visible row (no stale
      // `Thinking` copies left behind by the under-erased reflow).
      const spinnerRows = visible.filter((l) => l.includes("Thinking"));
      expect(spinnerRows.length).toBe(1);

      // The status/footer identity segment (`voidrift ·`) appears on exactly ONE
      // visible row (no duplicated status line / overlapping rule fragments).
      const footerRows = visible.filter((l) => /voidrift ·/.test(l));
      expect(footerRows.length).toBe(1);

      // Every dim rule on screen fits the new width — no leftover wide rule.
      const ruleRows = visible.filter((l) => /^─+$/.test(l.trim()) && l.trim().length > 1);
      for (const r of ruleRows) expect(r.trim().length).toBeLessThanOrEqual(targetCols);
    }, 50_000);
  }
});
