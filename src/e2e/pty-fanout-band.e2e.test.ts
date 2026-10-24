/**
 * D1 (cli-blueprint §4.4) — PROVE the live fan-out gradient wave animates on a
 * RUNNING row IN THE BUILT BINARY, THROUGH A SLOW SINGLE TOOL CALL. A pty
 * capture (colour ON) runs the TUI, submits a prompt that fans out two workers
 * held `running` by the fake server holding each worker's single read_file turn
 * ~2 s before its first byte (NO further worker event for >1.5 s), and samples
 * time-stamped frames while the fan-out is live. The wave paints each title
 * character its own truecolor hue (`ESC[38;2;r;g;b m`); the test proves a frame
 * carries MANY distinct foreground colours and that the set shifts across frames
 * (the peak sweeps) EVEN WITH NO EVENT for seconds — which FAILS under the old
 * ~1.5 s recency gate (the regression guard) — and that under `reduceMotion` no
 * per-character wave is emitted (static text).
 *
 * python3 is OPTIONAL: without it the suite skips with a clear message (no new
 * devDependency). Deterministic and bounded: the harness waits on substrings,
 * samples for a fixed window, and hard-kills the child on timeout.
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

const HARNESS = path.resolve(fileURLToPath(new URL("./pty-fanout-capture.py", import.meta.url)));
const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));

/** A captured frame: a wall-clock ms and the raw bytes read since the last. */
interface Frame {
  t: number;
  raw: string;
}
interface Capture {
  ok: boolean;
  frames: Frame[];
  output: string;
}

/** Run the capture harness, returning its parsed result. */
async function runCapture(env: IsolatedEnv, prompt: string): Promise<Capture> {
  const spec = JSON.stringify({
    cli: CLI_DIST,
    cwd: env.workspace,
    env: { HOME: env.home, XDG_CONFIG_HOME: env.xdg },
    prompt,
    sampleMs: 60,
    windowMs: 2500,
    timeoutMs: 30_000,
  });
  return await new Promise<Capture>((resolve) => {
    const child = spawn("python3", [HARNESS, spec], { maxBuffer: 64 * 1024 * 1024 } as never);
    let stdout = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), 38_000);
    child.on("exit", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout) as Capture);
      } catch {
        resolve({ ok: false, frames: [], output: stdout });
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, frames: [], output: stdout });
    });
  });
}

/** The length of the longest RUN of per-character truecolor foreground spans in
 * a raw chunk — a `ESC[38;2;r;g;b m` SGR immediately followed by exactly ONE
 * printable character, repeated. The gradient wave emits its own colour before
 * every title character, so a generating title produces a long run (≥ a few
 * chars) of differing colours; ordinary coloured UI paints a whole word/segment
 * in one colour (run length ~1), so this isolates the wave from the rest of the
 * TUI. A run requires the colours to actually DIFFER, so a uniform colour (the
 * reduceMotion static title) is not counted as a wave. */
function maxPerCharWaveRun(raw: string): number {
  // Tokenise into SGR escapes, other escapes, and printable chars.
  // eslint-disable-next-line no-control-regex
  const token = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[a-zA-Z]|[\s\S]/g;
  let best = 0;
  let run = 0;
  let lastColor: string | null = null;
  let pendingColor: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = token.exec(raw)) !== null) {
    const t = m[0];
    if (t.startsWith("\x1b[") && t.endsWith("m")) {
      const codes = m[1]!.split(";");
      pendingColor = null;
      for (let i = 0; i < codes.length; i++) {
        if (codes[i] === "38" && codes[i + 1] === "2") {
          pendingColor = `${codes[i + 2]},${codes[i + 3]},${codes[i + 4]}`;
          break;
        }
      }
      continue;
    }
    if (t.startsWith("\x1b[")) {
      // A non-SGR escape (cursor move etc.) breaks the run.
      run = 0;
      lastColor = null;
      pendingColor = null;
      continue;
    }
    // A printable (or whitespace) character.
    if (pendingColor !== null && pendingColor !== lastColor) {
      run += 1;
      best = Math.max(best, run);
      lastColor = pendingColor;
    } else if (pendingColor === null) {
      run = 0;
      lastColor = null;
    }
    pendingColor = null;
  }
  return best;
}

const py3 = hasPython3();
const d = py3 ? describe : describe.skip;

d("live fan-out gradient wave animates in the built binary through a slow tool call (e2e, §4.4 D1)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    if (!py3) return;
    fake = await startFakeOpenAI();
  });
  afterEach(async () => {
    if (fake) {
      fake.clearAlways();
      fake.script();
      fake.requests.length = 0;
    }
    while (envs.length) await envs.pop()!.cleanup();
  });
  afterAll(async () => {
    if (fake) await fake.close();
    expect(await listE2eTmp("fanout-band")).toEqual([]);
  });

  /** Script a 2-worker batch fan-out whose workers are held `running` by a
   * SINGLE SLOW TOOL TURN: the orchestrator emits a `task` batch, then each
   * worker's model reply — the one that requests a single `read_file` — is
   * HELD ~2000 ms before its first byte. For that whole window the worker is
   * `running` and emits NO further worker event (no TOOL_STARTED until the
   * delayed reply lands), well past the old ~1.5 s recency gate. Under the old
   * gate the row would have gone SILENT (static) after 1.5 s; under the §4.4
   * state gate a `running` row keeps waving — this is the regression guard. A
   * short final turn then ends each worker. */
  function scriptBatch(): void {
    fake.script(
      // 1. orchestrator SSE emits the batch of two researcher tasks.
      { toolCalls: [{ name: "task", args: { tasks: [
        { id: "alpha", worker: "researcher", task: "survey alpha" },
        { id: "beta", worker: "researcher", task: "survey beta" },
      ] } }] },
      // 2-3. each worker: ONE slow read_file turn held ~2s (NO event >1.5s).
      { toolCalls: [{ name: "read_file", args: { path: "a.txt" } }], delayMs: 2000 },
      { toolCalls: [{ name: "read_file", args: { path: "b.txt" } }], delayMs: 2000 },
      // 4-5. each worker's short closing turn.
      { text: "alpha done", delayMs: 100 },
      { text: "beta done", delayMs: 100 },
      // 6. orchestrator finishes.
      { text: "fanned out two researchers", delayMs: 100 },
    );
    fake.requests.length = 0;
  }

  it("a RUNNING row's title emits per-character truecolor whose peak advances frame to frame THROUGH A SLOW SINGLE TOOL CALL (colour on)", async () => {
    const env = await makeEnv("fanout-band-motion", fake, {});
    envs.push(env);
    scriptBatch();
    const cap = await runCapture(env, "fan out two researchers");
    expect(cap.ok).toBe(true);
    // The live fan-out panel appeared and the orchestrator bound `task`.
    expect(cap.output).toContain("Orchestrating");
    expect(fake.requests.some((r) => r.toolNames.includes("task"))).toBe(true);
    // Gather the per-character wave runs per frame. The wave emits its own
    // truecolor before each title character, so a generating frame shows a long
    // run of DIFFERING per-character colours; the run's colours shift across
    // frames as the peak sweeps.
    let wavyFrames = 0;
    let bestRun = 0;
    for (const f of cap.frames) {
      const run = maxPerCharWaveRun(f.raw);
      if (run >= 3) wavyFrames += 1;
      bestRun = Math.max(bestRun, run);
    }
    // The wave was rendered (a per-character colour run on a title) AND it
    // repainted across several live frames — not a single static frame.
    expect(bestRun).toBeGreaterThanOrEqual(3); // per-character ramp on a title
    expect(wavyFrames).toBeGreaterThan(1); // the wave repainted across frames
  }, 45_000);

  it("under reduceMotion the built binary emits NO per-character wave on a running row", async () => {
    const env = await makeEnv("fanout-band-reduce", fake, { apps: { cli: { reduceMotion: true } } });
    envs.push(env);
    scriptBatch();
    const cap = await runCapture(env, "fan out two researchers");
    expect(cap.ok).toBe(true);
    expect(cap.output).toContain("Orchestrating");
    // Under reduceMotion the title renders static (bold two-weight, one colour),
    // so no frame carries a per-character colour RUN (the wave's signature —
    // SGR before every title character). Ordinary one-colour UI never produces a
    // ≥3 run of DIFFERING per-character colours.
    const anyWave = cap.frames.some((f) => maxPerCharWaveRun(f.raw) >= 3);
    expect(anyWave).toBe(false);
  }, 45_000);
});
