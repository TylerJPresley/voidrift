/**
 * Real-binary end-to-end test for the mutation journal (core-blueprint.md
 * §10.11). Runs the BUILT `voidrift` binary and BUILT `@voidrift/core` against
 * the scriptable fake OpenAI SSE server, over the default headless (research-
 * posture) agent. A read-only run that calls `researcher_save_notes` — the one
 * write a read-only research role may do — is the natural write path here
 * (a worker/`--enable-write` write loop is unnecessarily complex for this
 * assertion).
 *
 * After the run the session's journal exists at
 * `.voidrift/journal/<sessionId>/entries.jsonl` with mode 0600, holds the write
 * entry carrying the content's byte length + sha256 but NOT the content text,
 * and the content-addressed blob holds the RAW content.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { makeEnv, runBinary, listE2eTmp, type IsolatedEnv } from "./run-binary.js";

const NOTE_PATH = ".voidrift/research/journal-finding.md";
const NOTE_CONTENT = "# Finding\nraw-marker-UNIQUE-42\nsource https://x (2026-10-17)\n";

/** The `voidrift: session <id>` line the binary prints to stderr before output. */
function sessionIdFromStderr(stderr: string): string {
  const m = /voidrift: session (\S+)/.exec(stderr);
  if (!m) throw new Error(`no session id in stderr:\n${stderr}`);
  return m[1]!;
}

describe("real-binary mutation journal (e2e)", () => {
  let fake: FakeOpenAI;
  const envs: IsolatedEnv[] = [];

  beforeAll(async () => {
    fake = await startFakeOpenAI();
  });
  afterEach(async () => {
    fake.script();
    fake.requests.length = 0;
    while (envs.length) await envs.pop()!.cleanup();
  });
  afterAll(async () => {
    await fake.close();
    expect(await listE2eTmp("journal-j1")).toEqual([]);
  });

  it("J1 a research-notes write appends a journal entry with sha+bytes (not content); blob holds raw content", async () => {
    const env = await makeEnv("journal-j1", fake);
    envs.push(env);
    fake.script(
      { toolCalls: [{ name: "researcher_save_notes", args: { path: NOTE_PATH, content: NOTE_CONTENT } }] },
      { text: "recorded" },
    );
    fake.requests.length = 0;

    const run = await runBinary(env, ["--prompt", "investigate and record"], { timeoutMs: 20_000 });
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);

    // The note itself landed (the write executed before the journal entry).
    const written = await fs.readFile(path.join(env.workspace, NOTE_PATH), "utf8");
    expect(written).toContain("raw-marker-UNIQUE-42");

    const sessionId = sessionIdFromStderr(run.stderr);
    const journalDir = path.join(env.workspace, ".voidrift", "journal", sessionId);
    const entriesPath = path.join(journalDir, "entries.jsonl");

    // entries.jsonl exists, mode 0600.
    const raw = await fs.readFile(entriesPath, "utf8");
    expect(statSync(entriesPath).mode & 0o777).toBe(0o600);

    const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
    const notesEntry = lines.find((e) => e.tool === "researcher_save_notes");
    expect(notesEntry, "a researcher_save_notes journal entry").toBeTruthy();
    expect(notesEntry.target).toBe(NOTE_PATH);

    // The entry carries the content's byte length + sha256, NEVER the text.
    const sha = createHash("sha256").update(Buffer.from(NOTE_CONTENT, "utf8")).digest("hex");
    expect(notesEntry.call.content).toEqual({ bytes: Buffer.byteLength(NOTE_CONTENT), sha256: sha });
    // The raw marker must NOT appear anywhere in the entries metadata.
    expect(raw).not.toContain("raw-marker-UNIQUE-42");

    // The content-addressed blob holds the RAW content byte-for-byte.
    const afterSha = notesEntry.blobs?.after;
    expect(afterSha, "an after blob at `action` level").toBeTruthy();
    const blob = await fs.readFile(path.join(journalDir, "blobs", afterSha));
    expect(blob).toEqual(Buffer.from(NOTE_CONTENT, "utf8"));
  }, 30_000);
});
