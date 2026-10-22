/**
 * Headless production-path test (cli-blueprint.md §2.4, §8.3; core §3.6, §11.9).
 *
 * The first genuine production-default run in a CLI test: boot the REAL core
 * (no injected configStore, no injected chatModelFactory) against a temp
 * HOME/XDG + temp workspace whose project config points the OpenAI-protocol
 * default at a bind-then-closed localhost port (a guaranteed-refused connect,
 * deterministic and offline). A refused connection must fail FAST — exit 1, an
 * ERROR_OCCURRED line on stderr, empty stdout.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import net from "node:net";
import { createCore } from "@voidrift/core";
import { runHeadless, type HeadlessStreams } from "./headless.js";
import { EXIT } from "./exit-codes.js";
import type { ResolveDeps } from "./prompt-resolve.js";

function captureStreams(): HeadlessStreams & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    out: () => out,
    err: () => err,
  };
}

const resolveDeps: ResolveDeps = {
  readFile: async () => {
    throw new Error("ENOENT");
  },
  isReadableFile: async () => false,
  readStdin: async () => undefined,
  maxReadLines: 2000,
};

async function refusedPort(): Promise<number> {
  const srv = net.createServer();
  const port = await new Promise<number>((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve((srv.address() as net.AddressInfo).port));
  });
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

describe("§8 headless — production refused-endpoint fails fast with exit 1", () => {
  let ws: string;
  let home: string;
  let prevXdg: string | undefined;

  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "vr-cli-ws-"));
    home = await fs.mkdtemp(path.join(os.tmpdir(), "vr-cli-xdg-"));
    prevXdg = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = home;
  });

  afterEach(async () => {
    if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = prevXdg;
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it("exits 1 with an error line on stderr and empty stdout", async () => {
    const port = await refusedPort();
    await fs.mkdir(path.join(ws, ".voidrift"), { recursive: true });
    await fs.writeFile(
      path.join(ws, ".voidrift", "config.json"),
      JSON.stringify({
        models: {
          local: { model: "m", protocol: "openai", baseUrl: `http://127.0.0.1:${port}/v1`, contextLimit: 8000 },
        },
        modelSelected: "local",
      }),
    );

    const streams = captureStreams();
    const start = Date.now();
    const code = await runHeadless({
      boot: () => createCore({ workspaceRoot: ws, installSignalHandlers: false }),
      entry: { kind: "prompt", arg: "say hi" },
      resolveDeps,
      streams,
      installSignals: false,
    });
    const elapsed = Date.now() - start;

    expect(code).toBe(EXIT.FAILED);
    expect(streams.out()).toBe("");
    // §8.3: the session status line precedes the error line on stderr; stdout
    // stays clean on failure. The id is a real resumable 8-hex handle.
    expect(streams.err()).toMatch(/^voidrift: session [0-9a-f]{8}$/m);
    // §10.1: a model failure is legible — the endpoint, the human reason, the
    // attempt count, and a hint — not a bare `model: <status>` line. A refused
    // connect is non-retryable, so it is a single attempt.
    expect(streams.err()).toContain("local @ 127.0.0.1:");
    expect(streams.err()).toMatch(/after 1 attempt\./);
    expect(streams.err()).toContain("cannot connect to 127.0.0.1:");
    expect(streams.err().indexOf("voidrift: session")).toBeLessThan(streams.err().indexOf("local @"));
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);
});
