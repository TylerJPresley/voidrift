/**
 * `voidrift export` — arg parsing + command behaviour (cli-blueprint.md §2.1,
 * core §10.13).
 *
 * The parser accepts `<id|last> [--format md|json] [--out <path>]
 * [--no-tool-results]` and rejects a missing id / bad format / unknown flag with
 * a usage error. `runExportCommand` boots a read-only core, calls the HOST-ONLY
 * `session.export`, prints the sanitized content to stdout (or the written path
 * to stderr), and maps the result to an exit code (0 / 2). Deterministic and
 * offline: a `fakeModel()` core over a hermetic workspace, injected as `boot`.
 */
import { hermeticTmp } from "./test-hermetic.js";
import { describe, it, expect, afterEach } from "vitest";
import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import path from "node:path";
import fs from "node:fs/promises";
import { parseArgs } from "./args.js";
import { runExportCommand } from "./export-command.js";
import { EXIT } from "./exit-codes.js";
import {
  createCore,
  InMemorySessionRepository,
  type Config,
  type CoreReady,
} from "@voidrift/core";

const SEED: Partial<Config> = {
  models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000 } },
  modelSelected: "test",
};

function sink() {
  const buf: string[] = [];
  return { write: (s: string) => void buf.push(s), text: () => buf.join("") };
}

const tracked: CoreReady[] = [];
afterEach(async () => {
  for (const r of tracked.splice(0)) await r.api.session.shutdown().catch(() => undefined);
});

/** A boot that builds a fakeModel core and seeds one completed turn. The shared
 * in-memory repository means a second boot (the command's own) sees the seeded
 * session. */
async function bootWithSession(input: string): Promise<{ boot: (o: { workspaceRoot: string }) => Promise<CoreReady>; ws: string }> {
  const ws = hermeticTmp("cli-export");
  await fs.mkdir(path.join(ws, ".voidrift"), { recursive: true });
  const sharedRepo = new InMemorySessionRepository();
  const boot = async (): Promise<CoreReady> => {
    const r = await createCore({
      workspaceRoot: ws,
      configOverrides: SEED,
      sessionRepository: sharedRepo,
      chatModelFactory: () => fakeModel({ responses: [new AIMessage("done")] }),
      installSignalHandlers: false,
    });
    tracked.push(r);
    return r;
  };
  const r = await boot();
  const created = await r.api.session.create();
  if (created.ok) await r.api.session.send(created.value.id, { input });
  return { boot: () => boot(), ws };
}

describe("voidrift export — arg parsing (§2.1)", () => {
  it("parses <id|last> with defaults", () => {
    const r = parseArgs(["export", "last"]);
    expect(r.ok && r.mode.kind).toBe("export");
    if (r.ok && r.mode.kind === "export") expect(r.mode.id).toBe("last");
  });

  it("parses --format, --out, and --no-tool-results", () => {
    const r = parseArgs(["export", "abcd1234", "--format", "md", "--out", "x.md", "--no-tool-results"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode.kind === "export") {
      expect(r.mode.format).toBe("md");
      expect(r.mode.out).toBe("x.md");
      expect(r.mode.noToolResults).toBe(true);
    }
  });

  it("rejects a missing id", () => {
    const r = parseArgs(["export"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("session-id");
  });

  it("rejects a bad format and an unknown flag", () => {
    expect(parseArgs(["export", "last", "--format", "xml"]).ok).toBe(false);
    expect(parseArgs(["export", "last", "--nope"]).ok).toBe(false);
  });
});

describe("voidrift export — command behaviour (core §10.13)", () => {
  it("prints sanitized JSON to stdout and exits 0", async () => {
    const { boot } = await bootWithSession("read token ghp_0123456789abcdefghijklmnopqrstuvwxyz");
    const stdout = sink();
    const stderr = sink();
    const code = await runExportCommand({ id: "last", format: "json" }, { stdout, stderr, cwd: "/", boot });
    expect(code).toBe(EXIT.COMPLETED);
    expect(stdout.text()).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
    expect(stdout.text()).toContain("«redacted:");
  });

  it("writes a 0600 file with --out and reports the path", async () => {
    const { boot, ws } = await bootWithSession("hello");
    const out = path.join(ws, "session.md");
    const stdout = sink();
    const stderr = sink();
    const code = await runExportCommand({ id: "last", format: "md", out }, { stdout, stderr, cwd: ws, boot });
    expect(code).toBe(EXIT.COMPLETED);
    const st = await fs.stat(out);
    expect(st.mode & 0o777).toBe(0o600);
    expect(stderr.text()).toContain(out);
  });

  it("an unknown session exits 2 (usage) and writes no stdout", async () => {
    const { boot } = await bootWithSession("hello");
    const stdout = sink();
    const stderr = sink();
    const code = await runExportCommand({ id: "ffffffff" }, { stdout, stderr, cwd: "/", boot });
    expect(code).toBe(EXIT.USAGE);
    expect(stdout.text()).toBe("");
  });

  it("export to an existing file exits 2 and writes no file", async () => {
    const { boot, ws } = await bootWithSession("hello");
    const out = path.join(ws, "exists.json");
    await fs.writeFile(out, "{}");
    const stdout = sink();
    const stderr = sink();
    const code = await runExportCommand({ id: "last", out }, { stdout, stderr, cwd: ws, boot });
    expect(code).toBe(EXIT.USAGE);
    expect(await fs.readFile(out, "utf8")).toBe("{}");
  });
});
