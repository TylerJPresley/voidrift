/**
 * Headless output-format e2e (cli-blueprint.md §8.3).
 *
 * The TUI-look port changes only interactive rendering; the headless contract
 * must stay byte-stable: `stdout` carries the assistant text only (exactly one
 * trailing newline, no banner/tool feed/status), and `stderr` carries exactly
 * one `voidrift: session <id>` line. Run against the BUILT binary + the committed
 * fake OpenAI server so this proves the shipped artifact, not source.
 */
import { describe, it, expect, afterEach } from "vitest";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("§8.3 headless output format is unchanged by the TUI-look port", () => {
  let fake: FakeOpenAI | undefined;
  let env: IsolatedEnv | undefined;

  afterEach(async () => {
    await env?.cleanup();
    await fake?.close();
    env = undefined;
    fake = undefined;
  });

  it("--prompt streams only the assistant text to stdout and one session line to stderr", async () => {
    fake = await startFakeOpenAI([{ text: "Hello from the model." }]);
    env = await makeEnv("headless-format", fake);
    const run = await runBinary(env, ["--prompt", "say hi"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // stdout: assistant text only, exactly one trailing newline, no chrome.
    expect(run.stdout).toBe("Hello from the model.\n");
    expect(run.stdout).not.toContain("██"); // no banner
    expect(run.stdout).not.toContain("┃"); // no user echo
    expect(run.stdout).not.toContain("●"); // no tool feed
    expect(run.stdout).not.toContain("tok/s"); // no status footer
    // stderr: exactly one `voidrift: session <id>` line.
    const sessionLines = run.stderr.split("\n").filter((l) => l.startsWith("voidrift: session "));
    expect(sessionLines).toHaveLength(1);
    expect(sessionLines[0]).toMatch(/^voidrift: session [0-9a-f]{8}$/);

    const leaked = await listE2eTmp("headless-format");
    // only this env's own root exists until cleanup (afterEach removes it)
    expect(leaked.length).toBeLessThanOrEqual(1);
  });
});
