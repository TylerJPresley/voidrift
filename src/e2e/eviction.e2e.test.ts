/**
 * Large-result eviction end-to-end (core-blueprint.md §8.3), against the BUILT
 * `voidrift` binary + BUILT `@voidrift/core` and the scriptable fake OpenAI SSE
 * server. This exercises the ONE path 1143 fake-driven unit tests cannot: an
 * `execute_command` result that is NOT line-bounded riding through the real
 * createAgent tool-call path. With a small `contextLimit` the result crosses the
 * `contextToolResultPct` threshold and must be EVICTED — the model's follow-up
 * request carries only the SHORT HANDLE, the FULL body is cached on disk under
 * `.voidrift/cache/session/<id>/`, and the model can then `read_file` it.
 *
 * Bounded + leak-free: the fake server closes and every temp dir is removed in
 * afterEach; the hard per-test timeout kills a hung child; the only temp roots
 * are the per-run `<hermetic>/e2e-evict*` names this suite owns.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, writeProjectAgent, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

/** The 8-hex session id from the `voidrift: session <id>` stderr line. */
function sessionIdFrom(stderr: string): string {
  const m = stderr.match(/voidrift: session ([0-9a-f]{8})/);
  if (!m) throw new Error(`no session line in stderr:\n${stderr}`);
  return m[1]!;
}

/** The byte size of a recorded request body (what the product sent the model). */
function bodyBytes(req: { body: unknown }): number {
  return Buffer.byteLength(JSON.stringify(req.body), "utf8");
}

/** A bounded large-output command using only coreutils (no `node` on the
 * child PATH): ~300k bytes of 'x' to stdout, then exit 0. A NARROW allow rule
 * covers THIS exact command only — never a broad glob. */
const BIG_CMD = `head -c 300000 /dev/zero | tr '\\0' x`;

describe("large-result eviction (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterEach(async () => {
    fake.clearAlways();
    fake.script();
    fake.requests.length = 0;
    while (envs.length) await envs.pop()!.cleanup();
  });
  afterAll(async () => {
    await fake.close();
    // No temp root this suite owns is left behind.
    expect(await listE2eTmp("evict")).toHaveLength(0);
  });

  it("E1 an oversized execute_command result is EVICTED: follow-up body is a short handle, full body cached on disk, read_file returns a slice, exit 0 (§8.3)", async () => {
    const env = await makeEnv("evict-e1", fake, {
      // A small window so the eviction threshold is tiny (10% ⇒ ~800 tokens).
      models: { local: { model: "fake-model", protocol: "openai", baseUrl: fake.url, contextLimit: 8_000 } },
      modelSelected: "local",
      // A NARROW allow rule for the EXACT large-output command (not a broad glob).
      permissions: {
        "allow-big": { tool: "execute_command", pattern: BIG_CMD, decision: "allow", priority: 300, source: "workspace" },
      },
    });
    envs.push(env);

    // The default headless agents (research/vibe) bind no execute_command, so
    // seed a PROJECT top-level WRITE agent (unlisted: allow, order 1) that binds
    // it, and select it with --enable-write (first allow by order). This is the
    // one path that rides a non-line-bounded result through the real tool loop.
    const agentDir = path.join(env.workspace, ".voidrift", "agents", "writer");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "agent.json"),
      JSON.stringify({
        name: "writer",
        description: "a write agent that binds execute_command for the eviction e2e",
        kind: "top-level",
        order: 1,
        unlisted: "allow",
        confirm: true,
        workers: "all",
        prompt: "You run commands when asked.",
        tools: ["read_file", "glob_files", "search_contents", "execute_command", "write_file", "edit_file"],
      }),
    );

    // The model calls the big command, then finishes (it would normally inspect
    // the handle; the inspect step is exercised as a second bounded run below,
    // once the hash-derived cache path is known from disk).
    fake.script(
      { toolCalls: [{ name: "execute_command", args: { command: BIG_CMD } }] },
      { text: "evicted; will inspect the cache file" },
    );

    const run = await runBinary(env, ["--prompt", "run the big command", "--enable-write"], { timeoutMs: 25_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);

    const id = sessionIdFrom(run.stderr);
    const cacheDir = path.join(env.workspace, ".voidrift", "cache", "session", id);
    const cacheFiles = (await fs.readdir(cacheDir)).filter((f) => f.startsWith("tool-"));
    // The FULL result was cached on disk under the session cache dir.
    expect(cacheFiles).toHaveLength(1);
    const relCachePath = path.posix.join(".voidrift", "cache", "session", id, cacheFiles[0]!);
    const onDisk = await fs.readFile(path.join(cacheDir, cacheFiles[0]!), "utf8");
    // The FULL (large) result survived to disk — a long run of 'x' well beyond
    // the eviction threshold, not a truncated handle.
    expect(onDisk.length).toBeGreaterThan(50_000);
    expect(onDisk).toMatch(/x{50000,}/);

    // The follow-up request (the one AFTER the execute_command tool result) must
    // carry the SHORT HANDLE, not the 300k payload. Find the tool message.
    const followWithToolResult = fake.requests.find((r) =>
      (r.body.messages ?? []).some((m) => m.role === "tool" && typeof m.content === "string"),
    );
    expect(followWithToolResult).toBeDefined();
    const toolMsg = (followWithToolResult!.body.messages ?? []).find((m) => m.role === "tool")!;
    const toolBody = String(toolMsg.content);
    // The handle is bounded (well under 8 KB) and names the cache path + read_file.
    expect(Buffer.byteLength(toolBody, "utf8")).toBeLessThan(8_192);
    expect(toolBody).toContain(".voidrift/cache/session/");
    expect(toolBody).toMatch(/read_file/);
    // The 300k payload never rode inline into ANY request body.
    for (const r of fake.requests) {
      expect(bodyBytes(r)).toBeLessThan(50_000);
    }
    console.error(`[E1] follow-up tool message = ${Buffer.byteLength(toolBody, "utf8")} bytes (full result ${onDisk.length} chars cached)`);

    // Second bounded run: the model read_files the DISCOVERED cache path (a free
    // read inside the workspace). read_file is line-bounded, so the returned
    // slice is small even though the file is 300k chars on one line. This run is
    // a DEFAULT headless (read-only) run; the seeded `research` holds no direct
    // read tool (core §2.7), so seed a read-only TEST agent that binds read_file
    // (order 5, below research at 20) for headless to select.
    await writeProjectAgent(env);
    fake.requests.length = 0;
    fake.script(
      { toolCalls: [{ name: "read_file", args: { path: relCachePath } }] },
      { text: "inspected the slice" },
    );
    const run2 = await runBinary(env, ["--prompt", "inspect the cache file"], { timeoutMs: 25_000 });
    expect(run2.timedOut).toBe(false);
    expect(run2.code).toBe(0);
    const readFollow = fake.requests.find((r) =>
      (r.body.messages ?? []).some((m) => m.role === "tool" && typeof m.content === "string"),
    );
    expect(readFollow).toBeDefined();
    const readBody = String((readFollow!.body.messages ?? []).find((m) => m.role === "tool")!.content);
    // The read result is NOT the full 300k payload — read_file bounds it, and a
    // single oversized line is itself truncated at the read limit.
    expect(readBody).toContain(relCachePath); // the `<path> (N lines)` header
    expect(Buffer.byteLength(readBody, "utf8")).toBeLessThan(300_000);
  }, 60_000);
});
