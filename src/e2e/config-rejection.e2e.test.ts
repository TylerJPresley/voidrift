/**
 * Real-binary end-to-end test for Part B: a rejected config must NOT be silent
 * (core-blueprint §13.2–§13.3; cli-blueprint §2.1, §8.3).
 *
 * The user's real-world global config used the OLD implementation's format
 * (`editor`, `approvalTimeout`, …) which the new strict schema rejects as
 * unknown top-level keys. The core sets the layer aside as `.rejected`, recovers
 * to defaults (which have no model endpoint), and keeps running — but before
 * this fix the CLI only said "no model endpoint selected" and never said WHY.
 *
 * This runs the BUILT binary with an isolated XDG_CONFIG_HOME holding a global
 * config with unknown keys and asserts: the startup stderr line names the file,
 * the invalid keys (names only), and the `.rejected` backup; the
 * MODEL_NOT_CONFIGURED hint points at the reason; exit code is 1; and the real
 * user HOME/XDG are untouched (the run is fully isolated).
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { E2E_TMP_PREFIX } from "./run-binary.js";

const CLI_DIST = path.resolve(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));
/** This suite's single temp root, under the run's hermetic e2e base. */
const ROOT = `${E2E_TMP_PREFIX}-config`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function runBinary(cwd: string, xdg: string, home: string, args: string[]): Promise<Run> {
  if (!existsSync(CLI_DIST)) throw new Error(`built CLI not found at ${CLI_DIST} — run \`npm run build\` first`);
  const child = spawn(process.execPath, [CLI_DIST, ...args], {
    cwd,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
  child.stdin.end();
  let timedOut = false;
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60_000);
    child.on("exit", (c) => {
      clearTimeout(t);
      resolve(c);
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve(null);
    });
  });
  return { code, stdout, stderr, timedOut };
}

describe("real-binary rejected config is reported, not silent (e2e, Part B)", () => {
  afterEach(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
  });

  it("names the file, invalid keys, and backup; hints the reason; exits 1; real home untouched", async () => {
    const xdg = path.join(ROOT, "xdg");
    const home = path.join(ROOT, "home");
    const ws = path.join(ROOT, "ws");
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(xdg, "voidrift"), { recursive: true });
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(ws, { recursive: true });

    // The real-world OLD-format global config: unknown top-level keys only.
    const oldFormat = {
      editor: "vim",
      approvalTimeout: 30,
      contextLookbackTurns: 5,
      maxConcurrentAgents: 3,
      toolLoopReminderInterval: 10,
      modelUtility: "x",
      modelEscalation: "y",
    };
    const globalConfig = path.join(xdg, "voidrift", "config.json");
    await fs.writeFile(globalConfig, JSON.stringify(oldFormat, null, 2));

    const run = await runBinary(ws, xdg, home, ["--prompt", "hello"]);

    expect(run.timedOut).toBe(false);
    // Defaults have no model endpoint → MODEL_NOT_CONFIGURED → exit 1 (§8.1).
    expect(run.code).toBe(1);

    // The startup rejection line names the file, the invalid keys, and backup.
    expect(run.stderr).toContain(globalConfig);
    expect(run.stderr).toContain("was rejected");
    expect(run.stderr).toContain("editor");
    expect(run.stderr).toContain(`${globalConfig}.rejected`);
    expect(run.stderr).toContain("running on defaults");
    // The MODEL_NOT_CONFIGURED hint points at the rejection reason.
    expect(run.stderr).toContain("hint:");
    expect(run.stderr).toMatch(/rejected|config/i);
    // No config VALUE ever appears in stderr (keys only).
    expect(run.stderr).not.toContain("vim");

    // The `.rejected` backup landed under the ISOLATED xdg, not the real home.
    expect(existsSync(`${globalConfig}.rejected`)).toBe(true);

    // (The user's REAL config dir is guarded by the main-process hermetic globalSetup, which fails the whole run if it changes;
    // the ambient config dir here is the run's SHARED temp root, so a per-test before/after check of it would race other test files.)
  }, 90_000);

  it("an UNPARSEABLE project config (trailing comma) is reported and set aside .rejected, never silently absent", async () => {
    const xdg = path.join(ROOT, "xdg");
    const home = path.join(ROOT, "home");
    const ws = path.join(ROOT, "ws");
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(xdg, "voidrift"), { recursive: true });
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(path.join(ws, ".voidrift"), { recursive: true });

    // A hand-edited project config with a trailing comma — valid intent, invalid
    // JSON. It must NOT be treated as absent (the data-loss defect): the exact
    // bytes are set aside as `.rejected` and a notice names the file.
    const projectConfig = path.join(ws, ".voidrift", "config.json");
    const original = '{\n  "permissions": {},\n}\n'; // trailing comma
    await fs.writeFile(projectConfig, original);

    const run = await runBinary(ws, xdg, home, ["--prompt", "hello"]);

    expect(run.timedOut).toBe(false);
    // Exit code is unchanged from the other rejection path: defaults have no
    // model endpoint → MODEL_NOT_CONFIGURED → exit 1.
    expect(run.code).toBe(1);
    // The startup rejection line names the PROJECT file and says it is not valid
    // JSON (value-free), and names the `.rejected` backup.
    expect(run.stderr).toContain(projectConfig);
    expect(run.stderr).toContain("was rejected");
    expect(run.stderr).toMatch(/not valid JSON/i);
    expect(run.stderr).toContain(`${projectConfig}.rejected`);
    // The `.rejected` sibling exists and holds the EXACT original bytes.
    expect(existsSync(`${projectConfig}.rejected`)).toBe(true);
    expect(await fs.readFile(`${projectConfig}.rejected`, "utf8")).toBe(original);
  }, 90_000);
});
