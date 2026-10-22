/**
 * Headless mode (cli-blueprint.md §8).
 *
 * `voidrift --prompt` and `voidrift --routine` run without a TUI and NEVER ask
 * (§8). The run picks a start agent from `agents.list()` (core §2.7): by default
 * the FIRST top-level agent by `order` whose `unlisted` is `deny` (read-only);
 * with `--enable-write`, the FIRST whose `unlisted` is `allow`. If no such agent
 * exists the run refuses with exit 2 and a plain message naming the agents
 * folder and what to add. The chosen agent is entered with `session.setMode(…,
 * { confirmed: true })` — the host passed the flag, so a `confirm: true` start
 * agent counts as confirmed. The session runs with `approvalMode: "headless"`:
 * any call that would ASK (an SSRF-range fetch or a plugin install under an
 * `allow` agent) is DENIED-AND-CONTINUE, so the run never ends
 * `waiting_for_approval` and exit 5 can no longer be produced.
 *
 * Two stderr lines (§8): at startup under `--enable-write`, the WRITE ENABLED
 * notice; at the end of a READ-ONLY (no flag) run that had at least one action
 * denied by the posture, the "N action(s) denied" line. `stdout` carries the
 * assistant text (or `structured` JSON); `stderr` carries the one
 * `voidrift: session <id>` line and (on failure) an error line. Signals: SIGINT
 * → cancel → 130, SIGTERM → shutdown → 143 (§8.4).
 */
import type { CoreError, CoreReady, EventEnvelope, TurnResult } from "@voidrift/core";
import { EXIT, exitCodeFor } from "./exit-codes.js";
import { resolvePrompt, type ResolveDeps } from "./prompt-resolve.js";
import { sanitize } from "./render/theme.js";
import { formatRetryLine, formatModelFailure, formatHeadlessModelError, type ModelErrorInfo } from "./render/model-error.js";
import { writeConfigNotice, modelNotConfiguredHint } from "./config-notice.js";

export interface HeadlessStreams {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}

export interface HeadlessOptions {
  /** Boot a ready core in the selected start agent; injected so tests pass a
   * scripted core. The selected top-level agent name is passed as `startAgent`. */
  boot: (startAgent?: string) => Promise<CoreReady>;
  /** The resolved entry: a one-shot prompt arg or a routine id. */
  entry: { kind: "prompt"; arg: string } | { kind: "routine"; id: string };
  /** Prompt-resolution dependencies (file/stdin reads, bound). */
  resolveDeps: ResolveDeps;
  streams: HeadlessStreams;
  /** `--enable-write` (§2.2, §8): run the first `unlisted: allow` agent and
   * print the WRITE ENABLED notice; otherwise run the first `unlisted: deny`
   * agent (read-only) and, if any action was posture-denied, print the
   * "N action(s) denied" line at the end. */
  enableWrite?: boolean;
  /** Install signal handlers that own SIGINT/SIGTERM (default true in prod). */
  installSignals?: boolean;
  proc?: NodeJS.Process;
}

/** The verbatim startup notice for a `--enable-write` run (§8). */
export const WRITE_ENABLED_NOTICE =
  "voidrift: WRITE ENABLED — this run may change files and run commands without asking (--enable-write); never-list commands, deny rules, Warden and guardrails still apply.";

/** The verbatim end-of-run line for a read-only run with at least one denial
 * (§8). `n` is the count of posture-denied calls. */
export function deniedLine(n: number): string {
  return `voidrift: ${n} action(s) denied (read-only run; pass --enable-write to allow changes)`;
}

/** The verbatim refusal when no suitable start agent exists (§8). `which` names
 * the posture, `folder` the agents directory. */
export function noAgentMessage(which: "deny" | "allow", folder: string): string {
  const posture = which === "deny" ? "unlisted: deny (read-only)" : "unlisted: allow (write)";
  return `voidrift: no top-level agent with ${posture} exists — run \`voidrift init\` to restore the default agents, or add one under ${folder} (an agent.json with "kind": "top-level" and "unlisted": "${which}")`;
}

/** Write exactly one trailing newline after `text` (§8.3). */
function withOneNewline(text: string): string {
  return text.replace(/\n+$/, "") + "\n";
}

/** §8/§3.3 — a headless run must never fail silently. A pre-flight
 * CONTEXT_OVERFLOW (core §4.10) is refused BEFORE the request is sent; the line
 * names the estimate, the output reservation, the window and the fix. */
export function contextOverflowLine(p: { estimatedInput?: number; maxOutputTokens?: number; limit?: number }): string {
  const input = Number(p.estimatedInput ?? 0);
  const out = Number(p.maxOutputTokens ?? 0);
  const win = Number(p.limit ?? 0);
  return `voidrift: request refused before sending: estimated input ${input} + output reservation ${out} > context window ${win}; lower maxOutputTokens or raise contextLimit`;
}

/** §8/§13.11 — a LIMIT_HIT in a headless run names the limit key and value so a
 * truncation/block is visible rather than silent. */
export function limitHitLine(p: { key?: string; value?: number }): string {
  return `voidrift: limit reached: ${String(p.key ?? "unknown")} (${Number(p.value ?? 0)}); raise it under limits.<area>.<name> in your config`;
}

interface TopAgentLite {
  name: string;
  kind?: string;
  unlisted?: "deny" | "ask" | "allow";
  order?: number;
}

/** The first top-level agent by `order` (tie: name) with the wanted posture. */
function selectAgent(agents: readonly TopAgentLite[], want: "deny" | "allow"): string | undefined {
  return agents
    .filter((a) => a.kind === "top-level" && a.unlisted === want)
    .slice()
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name))[0]?.name;
}

/**
 * Run a headless request and return the process exit code (§8). The caller
 * (`cli.ts`) applies the code to `process.exit`.
 */
export async function runHeadless(opts: HeadlessOptions): Promise<number> {
  const enableWrite = opts.enableWrite === true;
  const want: "deny" | "allow" = enableWrite ? "allow" : "deny";

  // Boot the core in `chat` first so `agents.list()` is readable, then select
  // the start agent and enter it with setMode before the turn (a `confirm: true`
  // start agent counts as confirmed because the host passed the flag). This
  // avoids a double boot while keeping agent selection data-driven.
  let ready: CoreReady;
  try {
    ready = await opts.boot();
  } catch {
    return EXIT.STARTUP;
  }
  const api = ready.api;

  // Resolve the agents folder for the refusal message and select the agent.
  let agentsFolder = "~/.config/voidrift/agents";
  try {
    const paths = (await api.config.paths()) as { ok?: boolean; value?: { global?: { path?: string } } };
    const gp = paths?.ok ? paths.value?.global?.path : undefined;
    if (gp) {
      // `<config home>/config.json` → `<config home>/agents`.
      const dir = gp.replace(/[/\\][^/\\]*$/, "");
      agentsFolder = `${dir}/agents`;
    }
  } catch {
    /* fall back to the display default */
  }
  let startAgent: string | undefined;
  // `agents.list()` resolves the top-level agent definitions, which the core
  // builds over the active model. When NO model is configured (e.g. the global
  // config was rejected and defaults have no endpoint) this THROWS
  // MODEL_NOT_CONFIGURED rather than returning a Result. That is not a
  // no-suitable-agent case (exit 2): the run has no usable model and must end
  // like a failed turn — the rejection notice, the MODEL_NOT_CONFIGURED line and
  // its hint, exit 1 (§13.2–§13.3, §8.1) — never a silent startup crash (exit 3)
  // and never the "no top-level agent" refusal. So catch it, report it the same
  // way a failed `send` would, and exit 1.
  let listThrew: CoreError | null = null;
  try {
    const list = await api.agents.list();
    if (list.ok) startAgent = selectAgent(list.value as TopAgentLite[], want);
  } catch (e) {
    const err = (e as { error?: CoreError })?.error;
    listThrew = err ?? { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
  }
  if (listThrew) {
    // §8 — a `--enable-write` run still prints its notice; then report the model
    // error and the rejection hint exactly as the send path would, and exit 1.
    if (enableWrite) opts.streams.stderr.write(`${WRITE_ENABLED_NOTICE}\n`);
    const { rejections } = await writeConfigNotice(api, opts.streams.stderr);
    let globalConfigPath = "~/.config/voidrift/config.json";
    try {
      const paths = (await api.config.paths()) as { ok?: boolean; value?: { global?: { path?: string } } };
      if (paths?.ok && paths.value?.global?.path) globalConfigPath = paths.value.global.path;
    } catch {
      /* fall back to the display default */
    }
    opts.streams.stderr.write(`${listThrew.message}\n`);
    if (listThrew.code === "MODEL_NOT_CONFIGURED") {
      opts.streams.stderr.write(`${modelNotConfiguredHint(rejections, globalConfigPath)}\n`);
    }
    await api.session.shutdown();
    return EXIT.FAILED;
  }
  if (startAgent === undefined) {
    opts.streams.stderr.write(`${noAgentMessage(want, agentsFolder)}\n`);
    await api.session.shutdown();
    return EXIT.USAGE;
  }

  // §8 — a `--enable-write` run prints exactly one WRITE ENABLED line to stderr
  // before the first turn.
  if (enableWrite) opts.streams.stderr.write(`${WRITE_ENABLED_NOTICE}\n`);

  // §13.2–§13.3 — report any rejected config layer, then any ignored-key warning
  // (one `voidrift: warning:` stderr line each), before the session line.
  const { rejections } = await writeConfigNotice(api, opts.streams.stderr);
  let globalConfigPath = "~/.config/voidrift/config.json";
  try {
    const paths = (await api.config.paths()) as { ok?: boolean; value?: { global?: { path?: string } } };
    if (paths?.ok && paths.value?.global?.path) globalConfigPath = paths.value.global.path;
  } catch {
    /* fall back to the display default */
  }

  const created = await api.session.create();
  if (!created.ok) {
    opts.streams.stderr.write(`${created.error.message}\n`);
    await api.session.shutdown();
    return EXIT.FAILED;
  }
  const sessionId = created.value.id;

  // §8.3: one status line, before any model output, for every run.
  opts.streams.stderr.write(`voidrift: session ${sessionId}\n`);

  // Enter the selected start agent (core §2.7); the host passed the flag, so a
  // `confirm: true` agent counts as confirmed. An `unlisted: allow` agent the
  // managed layer forbids refuses here.
  const setMode = await api.session.setMode(sessionId, startAgent, { confirmed: true });
  if (!setMode.ok) {
    opts.streams.stderr.write(`${setMode.error.message}\n`);
    await api.session.shutdown();
    return EXIT.FAILED;
  }

  // §8 — a `--routine` run starts a SEPARATE session via the routines plugin's
  // `runInNewSession`. Without this, that session would be born in `chat` with
  // `approvalMode: "interactive"` and reach `waiting_for_approval`/exit 5 on the
  // first write — the opposite of a headless run. Record the launch defaults so
  // every new session the run creates inherits the SELECTED start agent (first
  // `unlisted: deny`, or first `allow` under `--enable-write`) and the never-ask
  // headless posture, exactly like the `--prompt` session above.
  api.session.setLaunchDefaults({ agent: startAgent, approvalMode: "headless" });

  // §8 — count calls refused by the active agent's posture for the read-only
  // "N action(s) denied" line: a `read_only_posture` deny (an `unlisted: deny`
  // agent refusing a non-read/non-safe call) or an `unknown_tool` rejection (a
  // tool that exists in the harness but is not in the active agent's tool list).
  // The core marks both with a `cause` on PERMISSION_DENIED so the count is
  // exact, never guessed from a message.
  let deniedByPosture = 0;
  const unsubDenied = api.events.subscribe(
    "PERMISSION_DENIED",
    (ev: EventEnvelope) => {
      const cause = (ev.payload as { cause?: string }).cause;
      if (cause === "read_only_posture" || cause === "unknown_tool") deniedByPosture += 1;
    },
    // Unscoped: a `--routine` run denies inside a SEPARATE session the routines
    // plugin creates (runInNewSession), so scoping to the launch session would
    // miss every routine denial and print "0 action(s) denied". A headless run
    // is one logical operation per process, so counting process-wide is exact.
  );

  // Stream assistant tokens to stdout; capture an error line for stderr (§8.3).
  let errored: string | null = null;
  let erroredSource: string | null = null;
  let streamed = "";
  const unsubToken = api.events.subscribe(
    "TOKEN_STREAM",
    (ev: EventEnvelope) => {
      const p = ev.payload as { token?: string };
      if (p.token) {
        streamed += p.token;
        opts.streams.stdout.write(sanitize(p.token));
      }
    },
    { scope: { session: sessionId } },
  );
  const unsubError = api.events.subscribe(
    "ERROR_OCCURRED",
    (ev: EventEnvelope) => {
      const p = ev.payload as { source?: string; message?: string };
      errored = `${p.source ?? "engine"}: ${sanitize(p.message ?? "")}`;
      erroredSource = p.source ?? "engine";
    },
    { scope: { session: sessionId } },
  );

  // §10.1: make a model failure legible on stderr.
  const endpoints = new Map<string, { baseUrl?: string | undefined; modelId?: string | undefined }>();
  try {
    const mlist = await api.models.list();
    if (mlist.ok) {
      for (const m of mlist.value as Array<{ name: string; model?: string; baseUrl?: string }>) {
        endpoints.set(m.name, { baseUrl: m.baseUrl, modelId: m.model });
      }
    }
  } catch {
    /* an endpoint table we cannot read just omits <host> */
  }
  let lastModelError: ModelErrorInfo | null = null;
  const unsubModelError = api.events.subscribe(
    "MODEL_ERROR",
    (ev: EventEnvelope) => {
      const p = ev.payload as { name?: string; code?: string; message?: string; attempt?: number; maxRetries?: number; willRetry?: boolean };
      const ep = endpoints.get(String(p.name ?? "")) ?? {};
      const info: ModelErrorInfo = {
        name: String(p.name ?? "model"),
        code: String(p.code ?? "unknown"),
        message: String(p.message ?? ""),
        attempt: Number(p.attempt ?? 1),
        maxRetries: Number(p.maxRetries ?? 0),
        baseUrl: ep.baseUrl,
        modelId: ep.modelId,
      };
      lastModelError = info;
      if (p.willRetry) opts.streams.stderr.write(`${sanitize(formatRetryLine(info))}\n`);
    },
    { scope: { session: sessionId } },
  );

  // §8/§3.3 — a headless run must never fail silently. Capture the FIRST
  // pre-flight CONTEXT_OVERFLOW (core §4.10) and LIMIT_HIT (§13.11) so a run that
  // ends with no assistant text can still explain WHY on stderr with the fix. A
  // CONTEXT_OVERFLOW refuses the request before it is sent, so it is the cause of
  // an empty terminal turn; it takes precedence over a plain limit line.
  let diagnostic: string | null = null;
  const unsubOverflow = api.events.subscribe(
    "CONTEXT_OVERFLOW",
    (ev: EventEnvelope) => {
      diagnostic = contextOverflowLine(ev.payload as { estimatedInput?: number; maxOutputTokens?: number; limit?: number });
    },
    { scope: { session: sessionId } },
  );
  const unsubLimit = api.events.subscribe(
    "LIMIT_HIT",
    (ev: EventEnvelope) => {
      // A CONTEXT_OVERFLOW line, once set, wins (it is the refusal cause).
      if (diagnostic === null) diagnostic = limitHitLine(ev.payload as { key?: string; value?: number });
    },
    // Unscoped: a worker/ingest fan-out may hit a limit in a child session
    // (like the denial counter), so count process-wide for a headless run.
  );
  const proc = opts.proc ?? process;
  let signalCode: number | null = null;
  const onSigint = (): void => {
    signalCode = EXIT.SIGINT;
    void api.session.cancel(sessionId);
  };
  const onSigterm = (): void => {
    signalCode = EXIT.SIGTERM;
    void api.session.shutdown();
  };
  const install = opts.installSignals ?? true;
  if (install) {
    proc.once("SIGINT", onSigint);
    proc.once("SIGTERM", onSigterm);
  }

  let result: TurnResult | null = null;
  let opError: string | null = null;
  let opErrorCode: string | null = null;
  try {
    if (opts.entry.kind === "routine") {
      const res = await api.session.command("routine", opts.entry.id);
      if (res.ok) result = (res.value as { status?: string }).status ? (res.value as TurnResult) : null;
      else {
        opError = res.error.message;
        opErrorCode = (res.error as CoreError).code;
      }
    } else {
      const resolved = await resolvePrompt(opts.entry.arg, opts.resolveDeps);
      if (!resolved.ok) {
        opError = resolved.usageError;
      } else {
        // §8 — a headless run NEVER asks: an `ask` is denied-and-continue.
        const res = await api.session.send(sessionId, { input: resolved.prompt, approvalMode: "headless" });
        if (res.ok) result = res.value;
        else {
          opError = res.error.message;
          opErrorCode = (res.error as CoreError).code;
        }
      }
    }
  } finally {
    unsubToken();
    unsubError();
    unsubModelError();
    unsubDenied();
    unsubOverflow();
    unsubLimit();
    if (install) {
      proc.off("SIGINT", onSigint);
      proc.off("SIGTERM", onSigterm);
    }
  }

  // §8/§3.3 — surface a captured diagnostic (CONTEXT_OVERFLOW/LIMIT_HIT) on
  // stderr when the turn produced NO assistant text, so a refused or limited run
  // is never silent. The exit code is unchanged (set by the turn status below).
  const writeDiagnostic = (): void => {
    if (diagnostic !== null && result?.structured === undefined && (result?.text ?? "") === "" && streamed === "") {
      opts.streams.stderr.write(`${diagnostic}\n`);
    }
  };

  // The end-of-run "N action(s) denied" line for a READ-ONLY (no flag) run that
  // had at least one posture denial (§8). Printed before the exit, after the
  // turn, to stderr; stdout and the exit code are unchanged.
  const writeDeniedLine = (): void => {
    if (!enableWrite && deniedByPosture > 0) {
      opts.streams.stderr.write(`${deniedLine(deniedByPosture)}\n`);
    }
  };

  // A signal that already decided the outcome wins (§8.4).
  if (signalCode !== null) {
    await api.session.shutdown();
    return signalCode;
  }

  if ((opError || lastModelError) && !result) {
    // D4 (routines §7) — an unknown or malformed routine id is a USAGE error
    // (exit 2), not a run failure (exit 1). The routines plugin throws
    // `routine "<id>" not found` / `routine requires an id`; the core surfaces
    // it as NOT_FOUND / INVALID_INPUT. Map those to exit 2 for the `--routine`
    // entry so a scheduler can tell a bad id from a mid-run failure.
    const isRoutineUsage =
      opts.entry.kind === "routine" &&
      (opErrorCode === "NOT_FOUND" ||
        opErrorCode === "INVALID_INPUT" ||
        /routine\s+("[^"]*"\s+not found|requires an id)/i.test(opError ?? ""));
    // D5 (cli §10.1, core §11.5) — a model failure must never be silent. When
    // the turn failed and a MODEL_ERROR was seen, print the one legible line
    // (class, host, fix, and the /model pointer). This covers the model-down
    // case where the CoreError message is empty/opaque — otherwise the run
    // would exit 1 printing nothing.
    if (!isRoutineUsage && lastModelError) {
      opts.streams.stderr.write(`${formatHeadlessModelError(lastModelError)}\n`);
    } else if (diagnostic !== null) {
      // §8/§3.3 — a CONTEXT_OVERFLOW/LIMIT_HIT is the precise cause of a failed,
      // text-less turn; print the fix-bearing line instead of the opaque
      // CoreError message so the run never fails silently.
      opts.streams.stderr.write(`${String(diagnostic)}\n`);
    } else if (opError) {
      opts.streams.stderr.write(`${opError}\n`);
      if (opErrorCode === "MODEL_NOT_CONFIGURED") {
        opts.streams.stderr.write(`${modelNotConfiguredHint(rejections, globalConfigPath)}\n`);
      }
    }
    writeDeniedLine();
    await api.session.shutdown();
    return isRoutineUsage ? EXIT.USAGE : EXIT.FAILED;
  }

  if (result) {
    // §8/§3.3 — a LIMIT_HIT/CONTEXT_OVERFLOW notice prints BEFORE the model
    // failure line, so when a terminal turn also carries a model/network error
    // that error is the LAST stderr line (the diagnostic ordering H6 asserts).
    writeDiagnostic();
    if (errored) {
      if (erroredSource === "model" && lastModelError) {
        const f = formatModelFailure(lastModelError);
        opts.streams.stderr.write(`${f.reason}\n${f.hint}\n`);
      } else {
        opts.streams.stderr.write(`${String(errored)}\n`);
      }
    }
    if (result.structured !== undefined) {
      opts.streams.stdout.write(withOneNewline(JSON.stringify(result.structured)));
    } else if (result.text === "" && streamed === "") {
      // Any terminal status that produced NO assistant text writes nothing to
      // stdout (§8.3): stdout is assistant-text-only.
    } else {
      // Reconcile to the authoritative text (§8.3).
      const sanitizedText = sanitize(result.text);
      const sanitizedStreamed = sanitize(streamed);
      if (sanitizedStreamed === "") {
        opts.streams.stdout.write(withOneNewline(sanitizedText));
      } else if (sanitizedText === sanitizedStreamed) {
        opts.streams.stdout.write("\n");
      } else if (sanitizedText.startsWith(sanitizedStreamed)) {
        opts.streams.stdout.write(withOneNewline(sanitizedText.slice(sanitizedStreamed.length)));
      } else {
        opts.streams.stdout.write(withOneNewline(sanitizedText));
      }
    }
    writeDeniedLine();
    await api.session.shutdown();
    return exitCodeFor(result.status);
  }

  writeDeniedLine();
  await api.session.shutdown();
  return EXIT.FAILED;
}
