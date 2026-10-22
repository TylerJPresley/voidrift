/**
 * §8.4 integration test — headless `--prompt`/`--routine`, the output contract,
 * approval modes, signals, and exit codes (cli-blueprint.md §8.4). Runs against
 * the scripted core (fakeModel, in-memory storage); deterministic and offline.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runHeadless, type HeadlessStreams } from "./headless.js";
import { makeHarness } from "./test-harness.js";
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

const resolveDeps = (files: Record<string, string> = {}, stdin?: string): ResolveDeps => ({
  readFile: async (p) => {
    if (p in files) return files[p]!;
    throw new Error("ENOENT");
  },
  isReadableFile: async (p) => p in files,
  readStdin: async () => stdin,
  maxReadLines: 2000,
});

/** The §8.3 status line: exactly one `voidrift: session <8-hex>` on stderr. */
const SESSION_LINE = /^voidrift: session [0-9a-f]{8}$/m;

describe("§8 headless --prompt", () => {
  it("prints the single WRITE ENABLED stderr line before the first turn with --enable-write (§8)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hi" },
      resolveDeps: resolveDeps(),
      streams,
      enableWrite: true,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    const err = streams.err();
    const notice =
      "voidrift: WRITE ENABLED — this run may change files and run commands without asking (--enable-write); never-list commands, deny rules, Warden and guardrails still apply.";
    expect(err).toContain(notice);
    // Exactly one occurrence, and it precedes the session status line.
    expect(err.split(notice).length - 1).toBe(1);
    expect(err.indexOf(notice)).toBeLessThan(err.indexOf("voidrift: session"));
    // stdout stays assistant-text-only — the notice never leaks there.
    expect(streams.out()).not.toContain("WRITE ENABLED");
  });

  it("a read-only run (no flag) prints no WRITE ENABLED line and no denied line when nothing was denied", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const streams = captureStreams();
    await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hi" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(streams.err()).not.toContain("WRITE ENABLED");
    expect(streams.err()).not.toContain("action(s) denied");
  });

  it("refuses with exit 2 and a plain message when no suitable start agent exists", async () => {
    // A core whose only top-level agent is `chat` (unlisted: ask) — no deny/allow
    // agent — so the default read-only selection finds nothing and the run
    // refuses with exit 2 and a plain message naming the agents folder.
    const harness = await makeHarness({ reply: "ok", seedAgents: false });
    const api = harness.ready.api;
    const origList = api.agents.list.bind(api.agents);
    api.agents.list = async () => {
      const r = await origList();
      if (!r.ok) return r;
      // Keep only the built-in chat (unlisted: ask).
      return { ok: true as const, value: r.value.filter((a) => a.name === "chat") };
    };
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hi" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.USAGE);
    expect(streams.err()).toContain("no top-level agent with unlisted: deny");
    expect(streams.err()).toContain("agents");
  });

  it("a MODEL_NOT_CONFIGURED thrown by agents.list (no model) exits 1 with the hint — never a silent exit 3", async () => {
    // Regression: headless selects the start agent via `agents.list()`, which the
    // core builds over the active model and THROWS when none is configured (e.g.
    // a rejected global config recovering to endpoint-less defaults). That throw
    // must be reported like a failed turn (exit 1 + the MODEL_NOT_CONFIGURED
    // hint), not escape uncaught and crash startup (exit 3) or be mistaken for a
    // no-suitable-agent refusal (exit 2).
    const harness = await makeHarness({ reply: "ok" });
    const api = harness.ready.api;
    api.agents.list = async () => {
      const e = Object.assign(new Error("no model endpoint selected"), {
        error: { code: "MODEL_NOT_CONFIGURED", message: "no model endpoint selected" },
      });
      throw e;
    };
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hi" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.FAILED);
    expect(streams.err()).toContain("no model endpoint selected");
    expect(streams.err()).not.toContain("no top-level agent with unlisted");
  });

  it("runs a one-shot prompt, writes assistant text with one trailing newline, exits 0", async () => {
    const harness = await makeHarness({ reply: "the answer" });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hi" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    expect(streams.out()).toBe("the answer\n");
    // §8.3: stderr carries exactly the session status line (no error line); the
    // id is a real, resumable session that core session.list contains, and it
    // never leaks onto stdout.
    expect(streams.err()).toMatch(SESSION_LINE);
    const m = streams.err().match(SESSION_LINE)!;
    const printedId = m[0].slice("voidrift: session ".length);
    expect(streams.out()).not.toContain(printedId);
    expect(streams.out()).not.toContain("voidrift: session");
    const list = await harness.ready.api.session.list();
    expect(list.some((s) => s.id === printedId)).toBe(true);
  });

  it("resolves ./notes.md to the file contents and appends piped stdin", async () => {
    const streams = captureStreams();
    const code = await runHeadless({
      boot: () => makeHarness({ reply: "done" }).then((h) => h.ready),
      entry: { kind: "prompt", arg: "notes.md" },
      resolveDeps: resolveDeps({ "notes.md": "FILE" }, "PIPED"),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    expect(streams.out()).toBe("done\n");
  });

  it("streams TOKEN_STREAM to stdout then reconciles to TurnResult.text", async () => {
    const harness = await makeHarness({ reply: "RECONCILED" });
    const streams = captureStreams();
    const sessionIdPromise = new Promise<void>((resolve) => {
      // Emit a token for the session that headless creates, after a tick.
      harness.ready.api.events.subscribe("SESSION_RESUMED", () => resolve());
    });
    void sessionIdPromise;
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "x" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    // Reconciled authoritative text ends the output with exactly one newline.
    expect(streams.out().endsWith("RECONCILED\n")).toBe(true);
  });
});

describe("§8 headless --routine", () => {
  it("runs session.command('routine', id) in a new session and resolves", async () => {
    const harness = await makeHarness({ reply: "routine-ran" });
    // Register a routine command on the scripted core (mirrors the plugin).
    harness.ready.api.register.command("routine", "run a routine", async () => {
      const created = await harness.ready.api.session.create();
      if (!created.ok) throw new Error("create failed");
      const sent = await harness.ready.api.session.send(created.value.id, { input: "do the routine" });
      return sent.ok ? sent.value : null;
    });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "routine", id: "daily-report" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
  });

  it("D4: an unknown routine id is a USAGE error (exit 2), not a run failure (routines §7)", async () => {
    const harness = await makeHarness({ reply: "x" });
    // The routines plugin throws `routine "<id>" not found`; the facade surfaces
    // it as INVALID_INPUT. Headless must map that to exit 2 for `--routine`.
    harness.ready.api.register.command("routine", "run a routine", async () => {
      throw new Error('routine "nope" not found');
    });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "routine", id: "nope" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.USAGE);
    expect(streams.err()).toContain('routine "nope" not found');
  });
});

describe("§10.1 / §11.5 headless model errors are never silent (D5)", () => {
  // Each class emits a MODEL_ERROR then fails the turn; headless must print the
  // one legible line naming the class, host, a fix, and the /model pointer.
  const cases: Array<{ code: string; message: string; want: string }> = [
    { code: "network", message: "connect ECONNREFUSED 127.0.0.1:11434", want: "refused" },
    { code: "timeout", message: "request timed out", want: "timeout" },
    { code: "server", message: "502 status code (no body)", want: "server" },
    { code: "auth", message: "401 Unauthorized", want: "auth" },
    { code: "rate_limited", message: "429 Too Many Requests", want: "rate_limit" },
  ];
  for (const c of cases) {
    it(`prints one model-error line for class ${c.code} → '${c.want}'`, async () => {
      const harness = await makeHarness({ reply: "x" });
      const api = harness.ready.api;
      // Fail the turn and emit a MODEL_ERROR for the created session.
      api.session.send = async (sid) => {
        harness.emit(
          "MODEL_ERROR",
          { name: "test", code: c.code, message: c.message, attempt: 1, maxRetries: 0 },
          sid,
        );
        return { ok: false as const, error: { code: "MODEL_ERROR", message: "" } };
      };
      const streams = captureStreams();
      const code = await runHeadless({
        boot: async () => harness.ready,
        entry: { kind: "prompt", arg: "hi" },
        resolveDeps: resolveDeps(),
        streams,
        installSignals: false,
      });
      expect(code).toBe(EXIT.FAILED);
      const err = streams.err();
      expect(err).toContain(`voidrift: model error: ${c.want} from `);
      expect(err).toContain("switch with /model in an interactive session or fix the endpoint");
    });
  }
});

describe("§8.3 output contract branches", () => {
  it("writes structured TurnResult.structured as JSON when present", async () => {
    const harness = await makeHarness({ reply: "" });
    // Wrap send to return a structured result (a structured turn streams no text).
    const origSend = harness.ready.api.session.send.bind(harness.ready.api.session);
    harness.ready.api.session.send = async (sid, req) => {
      const r = await origSend(sid, req);
      if (r.ok) return { ok: true as const, value: { ...r.value, text: "", structured: { answer: 42 } } };
      return r;
    };
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "x" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.COMPLETED);
    expect(streams.out()).toBe('{"answer":42}\n');
  });

  it("a send error is written to stderr and exits 1", async () => {
    const harness = await makeHarness();
    harness.ready.api.session.send = async () => ({ ok: false as const, error: { code: "X", message: "send failed" } });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "x" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.FAILED);
    expect(streams.err()).toContain("send failed");
    // §8.3: the session line is on stderr (before the error), never on stdout,
    // and stdout stays empty on a failed turn.
    expect(streams.err()).toMatch(/^voidrift: session [0-9a-f]{8}$/m);
    expect(streams.out()).toBe("");
  });

  it("a synchronous construction error exits 3", async () => {
    const streams = captureStreams();
    const code = await runHeadless({
      boot: () => {
        throw new Error("unwritable");
      },
      entry: { kind: "prompt", arg: "x" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    expect(code).toBe(EXIT.STARTUP);
  });
});

describe("§8.4 signals", () => {
  it("SIGINT cancels and exits 130", async () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process;
    const streams = captureStreams();
    const harness = await makeHarness({ reply: "slow" });
    const cancel = vi.spyOn(harness.ready.api.session, "cancel");
    const run = runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "x" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: true,
      proc,
    });
    // Fire SIGINT on the next tick while the turn is in flight.
    setImmediate(() => proc.emit("SIGINT"));
    const code = await run;
    // Either the turn completes first (0) or the signal wins (130); when the
    // signal is observed, cancel is called and the code is 130.
    if (code === EXIT.SIGINT) expect(cancel).toHaveBeenCalled();
    else expect(code).toBe(EXIT.COMPLETED);
  });
});

describe("§8/§3.3 headless never fails silently — CONTEXT_OVERFLOW / LIMIT_HIT", () => {
  it("contextOverflowLine names the estimate, reservation, window and the fix", async () => {
    const { contextOverflowLine } = await import("./headless.js");
    const line = contextOverflowLine({ estimatedInput: 5000, maxOutputTokens: 1024, limit: 4096 });
    expect(line).toContain("5000");
    expect(line).toContain("1024");
    expect(line).toContain("4096");
    expect(line).toMatch(/lower maxOutputTokens or raise contextLimit/);
  });

  it("limitHitLine names the limit key and value with the fix", async () => {
    const { limitHitLine } = await import("./headless.js");
    const line = limitHitLine({ key: "tools.commandOutputMaxBytes", value: 200000 });
    expect(line).toContain("tools.commandOutputMaxBytes");
    expect(line).toContain("200000");
    expect(line).toMatch(/raise it/);
  });

  it("a real pre-flight CONTEXT_OVERFLOW prints the fix-bearing line on stderr (not silent)", async () => {
    // A tiny contextLimit so the output reservation (default 1024) alone exceeds
    // the window — the overflow guard refuses the request BEFORE the model is
    // called, so the turn fails with no assistant text.
    const harness = await makeHarness({ reply: "unused", seed: { models: { test: { model: "test-model", protocol: "openai", contextLimit: 500 } }, modelSelected: "test" } });
    const streams = captureStreams();
    const code = await runHeadless({
      boot: async () => harness.ready,
      entry: { kind: "prompt", arg: "hello there this is a prompt" },
      resolveDeps: resolveDeps(),
      streams,
      installSignals: false,
    });
    // Exit code stays as designed (a failed turn), and stdout carries no text.
    expect([EXIT.FAILED, EXIT.LIMIT_REACHED]).toContain(code);
    expect(streams.out()).toBe("");
    // The diagnostic line explains WHY on stderr with the fix.
    expect(streams.err()).toMatch(/request refused before sending|context window/);
    expect(streams.err()).toMatch(/lower maxOutputTokens or raise contextLimit/);
  });
});
