/**
 * §8 headless never asks — deny-and-continue (cli-blueprint.md §8). Exit 5 and
 * the approval-required block are RETIRED: a headless run picks a read-only
 * (`unlisted: deny`) or, with `--enable-write`, a write (`unlisted: allow`)
 * start agent, runs with `approvalMode: "headless"`, and any call that would ASK
 * is DENIED-AND-CONTINUE — the model gets a rejection tool result and the run
 * finishes with the usual exit codes, never `waiting_for_approval`.
 */
import { hermeticTmp } from "./test-hermetic.js";
import { describe, it, expect } from "vitest";
import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import { createCore, InMemorySessionRepository, type Config, type CoreReady } from "@voidrift/core";
import { runHeadless, type HeadlessStreams } from "./headless.js";
import { EXIT } from "./exit-codes.js";
import type { ResolveDeps } from "./prompt-resolve.js";

const resolveDeps: ResolveDeps = {
  readFile: async () => "",
  isReadableFile: async () => false,
  readStdin: async () => undefined,
  maxReadLines: 2000,
};

function streams(): HeadlessStreams & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    out: () => out,
    err: () => err,
  };
}

const SEED: Partial<Config> = {
  models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000 } },
  modelSelected: "test",
};

/** Build a core and seed the standard research (deny) and vibe (allow) agents. */
async function makeCore(factory: () => ReturnType<typeof fakeModel>): Promise<CoreReady> {
  const ready = await createCore({
    workspaceRoot: hermeticTmp("approval"),
    configOverrides: SEED,
    chatModelFactory: factory,
    sessionRepository: new InMemorySessionRepository(),
    installSignalHandlers: false,
  });
  await ready.api.agents.create({ name: "research", description: "read-only", kind: "top-level", systemPrompt: "r", tools: ["read_file", "glob_files", "search_contents"], workers: "all", unlisted: "deny", order: 20 });
  await ready.api.agents.create({ name: "vibe", description: "write", kind: "top-level", systemPrompt: "v", tools: ["*"], workers: "all", unlisted: "allow", confirm: true, order: 30 });
  return ready;
}

describe("§8 headless deny-and-continue (no exit 5)", () => {
  it("a read-only --prompt run whose model attempts write_file completes (exit 0) and prints the denied line", async () => {
    // research binds no write_file, so the model's write is an unknown-tool
    // rejection the posture counts; the loop continues and the turn completes.
    const factory = (): ReturnType<typeof fakeModel> =>
      fakeModel()
        .respondWithTools([{ name: "write_file", args: { path: "x.ts", content: "hi" } }])
        .respond(new AIMessage("done"));
    const io = streams();
    const code = await runHeadless({
      boot: async () => makeCore(factory),
      entry: { kind: "prompt", arg: "write the file" },
      resolveDeps,
      streams: io,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED); // NOT exit 5
    expect(io.err()).toMatch(/^voidrift: session [0-9a-f]{8}$/m);
    expect(io.err()).toContain("voidrift: 1 action(s) denied (read-only run; pass --enable-write to allow changes)");
    // stdout stays assistant-text-only.
    expect(io.out()).not.toContain("action(s) denied");
    expect(io.out()).not.toContain("voidrift: session");
  });

  it("the denied line is NOT printed on a --enable-write run (only the WRITE ENABLED line)", async () => {
    const factory = (): ReturnType<typeof fakeModel> => fakeModel().respond(new AIMessage("done"));
    const io = streams();
    const code = await runHeadless({
      boot: async () => makeCore(factory),
      entry: { kind: "prompt", arg: "do it" },
      resolveDeps,
      streams: io,
      enableWrite: true,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    expect(io.err()).toContain("WRITE ENABLED");
    expect(io.err()).not.toContain("action(s) denied");
  });

  it("exit 5 can no longer be produced by a headless run", async () => {
    const factory = (): ReturnType<typeof fakeModel> =>
      fakeModel()
        .respondWithTools([{ name: "write_file", args: { path: "x.ts", content: "hi" } }])
        .respond(new AIMessage("done"));
    const io = streams();
    const code = await runHeadless({
      boot: async () => makeCore(factory),
      entry: { kind: "prompt", arg: "write" },
      resolveDeps,
      streams: io,
      installSignals: false,
    });
    expect(code).not.toBe(EXIT.WAITING_FOR_APPROVAL);
    expect(io.err()).not.toContain("approval required");
  });
});
