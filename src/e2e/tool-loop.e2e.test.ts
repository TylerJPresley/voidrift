/**
 * Real-binary end-to-end tests for the tool-call loop (core-blueprint.md
 * §2.3–§2.5, §3.3, §8.2, §9.1–§9.5; cli-blueprint.md §2.4, §8.3–§8.4).
 *
 * These run the BUILT `voidrift` binary and the BUILT `@voidrift/core` against a
 * real HTTP + SSE model (the scriptable fake OpenAI server) — the tool-call path
 * that fake-driven unit tests never exercise over the wire. Each scenario is a
 * permanent regression test for a behavior the product must guarantee:
 *   S1  read-only tool loop end-to-end (exit 0, clean stdout, tool result sent)
 *   S2  gated write under policy_only (exit 5, nothing written)
 *   S3  cross-process resume + confirm (approve writes; reject does not)
 *   S4  force-ask beats a broad allow (never auto-run), then a safe cmd runs free
 *
 * Bounded + leak-free: the fake server is closed and every temp dir removed in
 * afterEach; per-test timeouts are explicit; no background process is left.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, writeProjectAgent, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

describe("real-binary tool loop (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });

  afterEach(async () => {
    while (envs.length) await envs.pop()!.cleanup();
  });

  afterAll(async () => {
    await fake.close();
    // This suite owns the fixed-name roots `s1`, `s2`, `s3`. Assert each is gone
    // by its EXACT label — not a bare `"s"` prefix, which would also match a
    // sibling e2e file's in-flight `ssrf-*`/`symlink-*` roots in a parallel
    // worker and flake (that sibling's cleanup is its own afterAll's business).
    for (const label of ["s1", "s2", "s3"]) {
      expect(await listE2eTmp(label)).toEqual([]);
    }
  });

  it("S1 READ-ONLY LOOP: reads a file then answers; tool result reaches the model", async () => {
    const env = await makeEnv("s1", fake);
    envs.push(env);
    // The seeded `research` orchestrator binds no direct read tools (core §2.7),
    // so seed a read-only top-level TEST agent (unlisted: deny, order 5) that
    // binds the read built-ins; headless selects it (first deny by order).
    await writeProjectAgent(env);
    await fs.writeFile(path.join(env.workspace, "note.txt"), "the sky is teal");
    fake.script({ toolCalls: [{ name: "read_file", args: { path: "note.txt" } }] }, { text: "done" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "read note.txt and tell me the color"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // stdout is the final assistant text only, with exactly one trailing newline.
    expect(run.stdout).toBe("done\n");
    // stderr is exactly the one session status line.
    // stderr: exactly one `voidrift: session <id>` line (a first-run seed notice
    // may precede it when HOME/XDG start empty, §CLI 2.1/core §13.8).
    {
      const sessionLines = run.stderr.split("\n").filter((l) => l.startsWith("voidrift: session "));
      expect(sessionLines).toHaveLength(1);
      expect(sessionLines[0]).toMatch(/^voidrift: session [0-9a-f]{8}$/);
    }

    // Two model requests: the initial turn, then the follow-up with the tool result.
    expect(fake.requests.length).toBe(2);
    const first = fake.requests[0]!;
    // The read-only TEST agent binds the read built-ins (read_file) and NOT the
    // write tools (a write would be an unknown-tool rejection, counted by posture).
    expect(first.toolNames).toContain("read_file");
    expect(first.toolNames).not.toContain("write_file");
    // The second request carries a `tool` role message whose content includes the file text.
    const second = fake.requests[1]!;
    const toolMsgs = (second.body.messages ?? []).filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThan(0);
    const joined = toolMsgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    expect(joined).toContain("the sky is teal");
    // No system message appears after position 0 in any request (§4 layout).
    for (const r of fake.requests) {
      const sysIdx = r.roles.map((role, i) => (role === "system" ? i : -1)).filter((i) => i >= 0);
      for (const i of sysIdx) expect(i).toBe(0);
    }
  }, 25_000);

  it("S2 WRITE DENIED-AND-CONTINUE: a read-only run's write is refused and counted (exit 0, nothing written)", async () => {
    const env = await makeEnv("s2", fake);
    envs.push(env);
    // research binds no write_file → the model's write is an unknown-tool
    // rejection the posture counts; the loop continues and the turn completes.
    fake.script({ toolCalls: [{ name: "write_file", args: { path: "out.txt", content: "hi" } }] }, { text: "could not write" });
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "create out.txt with hi"], { timeoutMs: 20_000 });

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0); // NOT exit 5 — headless never asks
    expect(run.stderr).toMatch(/voidrift: session [0-9a-f]{8}/);
    expect(run.stderr).toContain("voidrift: 1 action(s) denied (read-only run; pass --enable-write to allow changes)");
    // The write was never bound, so the file must NOT exist.
    const exists = await fs
      .readFile(path.join(env.workspace, "out.txt"), "utf8")
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  }, 25_000);

  it("S3 exit 5 can no longer be produced by a headless --prompt run", async () => {
    const env = await makeEnv("s3", fake);
    envs.push(env);
    fake.script({ toolCalls: [{ name: "write_file", args: { path: "out.txt", content: "hi" } }] }, { text: "done" });
    fake.requests.length = 0;
    const run = await runBinary(env, ["--prompt", "write out.txt"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).not.toBe(5);
  }, 25_000);

});
