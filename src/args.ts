/**
 * Flag and command parsing (cli-blueprint.md §2.1, §2.2).
 *
 * Pure argv parsing with the §2.2 flag rules: modes are mutually exclusive, an
 * unknown flag is a usage error, `--resume`/`--new` are mutually exclusive, and
 * `--resume` consumes the next argument as an id only when it does not begin
 * with `-`. Parsing happens before any SDK work so a usage error exits 2 (§2.4).
 *
 * `--vibe` and the removed `--auto-approve`/`--danger-no-ask` names are no
 * longer flags: they are unknown flags (exit 2). The one headless-only flag is
 * `--enable-write`, valid ONLY with `--prompt` and `--routine` (with `chat` or
 * alone → exit 2). It cannot be set from config, env, a routine file or a model
 * — only this argv flag turns a headless run from read-only into a write run.
 */

export type ParsedMode =
  | { kind: "chat"; resume?: { id?: string }; forceNew?: boolean }
  | { kind: "prompt"; arg: string; enableWrite?: boolean }
  | { kind: "routine"; id: string; enableWrite?: boolean }
  | { kind: "routine-list" }
  | { kind: "init"; reset?: string; update?: boolean; sweep?: boolean; migrate?: boolean; vacuum?: boolean; yes?: boolean }
  | { kind: "doctor"; offline?: boolean; json?: boolean }
  | { kind: "access"; enableWrite?: boolean }
  | { kind: "export"; id: string; format?: "md" | "json"; out?: string; noToolResults?: boolean }
  | { kind: "stats"; days?: number; model?: string; agent?: string; json?: boolean }
  | { kind: "version" }
  | { kind: "help" };

export type ParseResult =
  | { ok: true; mode: ParsedMode }
  | { ok: false; error: string };

const KNOWN_TOP_FLAGS = new Set(["--routine", "--prompt", "--version", "--help"]);

/** Parse argv (without node/script) into a mode or a usage error (§2.2). */
export function parseArgs(argv: readonly string[]): ParseResult {
  const args = [...argv];
  // Standalone top-level flags.
  if (args.includes("--help") || args.includes("-h")) return { ok: true, mode: { kind: "help" } };
  if (args.includes("--version") || args.includes("-v")) return { ok: true, mode: { kind: "version" } };

  const first = args[0];

  // `init` — a top-level COMMAND like `chat` (CLI §2.1), not a flag and not a
  // model tool. `voidrift init [--reset <name>] [--yes]`: `--reset <name>` names
  // a seeded agent or `config` to restore after a confirmed diff (§13.9.1);
  // `--yes` confirms a reset non-interactively and is valid ONLY with `--reset`.
  // Any other flag is a usage error (exit 2).
  if (first === "init") {
    const rest = args.slice(1);
    let reset: string | undefined;
    let update = false;
    let sweep = false;
    let migrate = false;
    let vacuum = false;
    let yes = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--reset") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) {
          return { ok: false, error: 'flag "--reset" requires a <name>' };
        }
        reset = next;
        i += 1;
      } else if (a === "--update") {
        update = true;
      } else if (a === "--sweep") {
        sweep = true;
      } else if (a === "--migrate") {
        migrate = true;
      } else if (a === "--vacuum") {
        vacuum = true;
      } else if (a === "--yes" || a === "-y") {
        yes = true;
      } else if (a.startsWith("-")) {
        return { ok: false, error: `unknown flag "${a}"` };
      } else {
        return { ok: false, error: `unexpected argument "${a}"` };
      }
    }
    // `--update`, `--reset`, `--sweep`, `--migrate`, and `--vacuum` are each
    // their own invocation (§13.9.1).
    const exclusive = [update, reset !== undefined, sweep, migrate, vacuum].filter(Boolean).length;
    if (exclusive > 1) {
      return { ok: false, error: '"--update", "--reset", "--sweep", "--migrate", and "--vacuum" may not be combined' };
    }
    // `--yes` confirms a reset, plain init (plugin-template copy), or an update
    // non-interactively (§13.9.1); `--sweep`, `--migrate`, and `--vacuum` act
    // directly and take no confirmation.
    if (yes && reset === undefined && !update && (sweep || migrate || vacuum)) {
      return { ok: false, error: '"--yes" is valid only with "--reset <name>", "--update", or a plain "init" (without --sweep/--migrate/--vacuum)' };
    }
    const mode: ParsedMode = { kind: "init" };
    if (reset !== undefined) (mode as { reset?: string }).reset = reset;
    if (update) (mode as { update?: boolean }).update = update;
    if (sweep) (mode as { sweep?: boolean }).sweep = sweep;
    if (migrate) (mode as { migrate?: boolean }).migrate = migrate;
    if (vacuum) (mode as { vacuum?: boolean }).vacuum = vacuum;
    if (yes) (mode as { yes?: boolean }).yes = yes;
    return { ok: true, mode };
  }

  // `doctor` — a top-level COMMAND like `init` (CLI §2.1). `voidrift doctor
  // [--offline] [--json]`: validate every resource read-only. `--offline` skips
  // network checks; `--json` emits machine-readable findings. Any other flag or
  // argument is a usage error (exit 2).
  if (first === "doctor") {
    const rest = args.slice(1);
    let offline = false;
    let json = false;
    for (const a of rest) {
      if (a === "--offline") offline = true;
      else if (a === "--json") json = true;
      else if (a.startsWith("-")) return { ok: false, error: `unknown flag "${a}"` };
      else return { ok: false, error: `unexpected argument "${a}"` };
    }
    const mode: ParsedMode = { kind: "doctor" };
    if (offline) (mode as { offline?: boolean }).offline = offline;
    if (json) (mode as { json?: boolean }).json = json;
    return { ok: true, mode };
  }

  // `access` — a top-level COMMAND like `doctor` (CLI §2.1, §7.4). `voidrift
  // access [--enable-write]`: print the effective permissions for the top-level
  // agent the flag selects, read-only. It accepts ONLY `--enable-write`; any
  // other flag or a positional argument is a usage error (exit 2).
  if (first === "access") {
    const rest = args.slice(1);
    let enableWrite = false;
    for (const a of rest) {
      if (a === "--enable-write") enableWrite = true;
      else if (a.startsWith("-")) return { ok: false, error: `unknown flag "${a}"` };
      else return { ok: false, error: `unexpected argument "${a}"` };
    }
    const mode: ParsedMode = { kind: "access" };
    if (enableWrite) (mode as { enableWrite?: boolean }).enableWrite = enableWrite;
    return { ok: true, mode };
  }

  // `export` — a top-level COMMAND like `doctor`/`access` (CLI §2.1, core
  // §10.13). `voidrift export <session-id|last> [--format md|json] [--out
  // <path>] [--no-tool-results]`: render a stored session as a sanitized
  // document, read-only (no model, no network, no session start). The first
  // positional is the session id or `last`; `--format` defaults to json;
  // `--out` writes an owner-only file. Any unknown flag, a missing id, or a
  // repeated positional is a usage error (exit 2).
  if (first === "export") {
    const rest = args.slice(1);
    let id: string | undefined;
    let format: "md" | "json" | undefined;
    let out: string | undefined;
    let noToolResults = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--format") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) return { ok: false, error: 'flag "--format" requires md or json' };
        if (next !== "md" && next !== "json") return { ok: false, error: `flag "--format" must be md or json, not "${next}"` };
        format = next;
        i += 1;
      } else if (a === "--out") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) return { ok: false, error: 'flag "--out" requires a <path>' };
        out = next;
        i += 1;
      } else if (a === "--no-tool-results") {
        noToolResults = true;
      } else if (a.startsWith("-")) {
        return { ok: false, error: `unknown flag "${a}"` };
      } else if (id === undefined) {
        id = a;
      } else {
        return { ok: false, error: `unexpected argument "${a}"` };
      }
    }
    if (id === undefined) return { ok: false, error: "export requires a <session-id|last>" };
    const mode: ParsedMode = { kind: "export", id };
    if (format !== undefined) (mode as { format?: "md" | "json" }).format = format;
    if (out !== undefined) (mode as { out?: string }).out = out;
    if (noToolResults) (mode as { noToolResults?: boolean }).noToolResults = noToolResults;
    return { ok: true, mode };
  }

  // `stats` — a top-level COMMAND like `doctor`/`access` (CLI §2.1, §2.2, core
  // §10.14). `voidrift stats [--days N] [--model <name>] [--agent <name>]
  // [--json]`: print the aggregate cost/token/time report across this
  // workspace's stored sessions, read-only (no model, no network, no session).
  // Any other flag or a positional argument is a usage error (exit 2).
  if (first === "stats") {
    const rest = args.slice(1);
    let days: number | undefined;
    let model: string | undefined;
    let agent: string | undefined;
    let json = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--json") {
        json = true;
      } else if (a === "--days") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) return { ok: false, error: 'flag "--days" requires a number' };
        const n = Number(next);
        if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'flag "--days" requires a positive integer' };
        days = n;
        i += 1;
      } else if (a === "--model") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) return { ok: false, error: 'flag "--model" requires a <name>' };
        model = next;
        i += 1;
      } else if (a === "--agent") {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("-")) return { ok: false, error: 'flag "--agent" requires a <name>' };
        agent = next;
        i += 1;
      } else if (a.startsWith("-")) {
        return { ok: false, error: `unknown flag "${a}"` };
      } else {
        return { ok: false, error: `unexpected argument "${a}"` };
      }
    }
    const mode: ParsedMode = { kind: "stats" };
    if (days !== undefined) (mode as { days?: number }).days = days;
    if (model !== undefined) (mode as { model?: string }).model = model;
    if (agent !== undefined) (mode as { agent?: string }).agent = agent;
    if (json) (mode as { json?: boolean }).json = json;
    return { ok: true, mode };
  }

  const hasRoutine = args.includes("--routine");
  const hasPrompt = args.includes("--prompt");
  const isChat = first === "chat" || (!hasRoutine && !hasPrompt && first === undefined);

  // Mode exclusivity: chat + routine/prompt, or routine + prompt.
  const modeCount = [first === "chat", hasRoutine, hasPrompt].filter(Boolean).length;
  if (modeCount > 1) {
    return { ok: false, error: "chat, --routine, and --prompt are distinct modes and may not be combined" };
  }

  if (hasRoutine) {
    const i = args.indexOf("--routine");
    // `voidrift --routine --list` lists saved routines and exits 0 (§4, cli
    // §2.2): it takes no id and no other flag.
    const listIdx = args.indexOf("--list");
    if (listIdx !== -1) {
      const rest = [...args.slice(0, i), ...args.slice(i + 1)].filter((a) => a !== "--list");
      const bad = rest.find((a) => a.startsWith("-"));
      if (bad) return { ok: false, error: `unknown flag "${bad}"` };
      if (rest.length > 0) return { ok: false, error: `unexpected argument "${rest[0]}"` };
      return { ok: true, mode: { kind: "routine-list" } };
    }
    const id = args[i + 1];
    if (!id || id.startsWith("-")) {
      return { ok: false, error: 'flag "--routine" requires an <id>' };
    }
    let rest = [...args.slice(0, i), ...args.slice(i + 2)];
    const enableWrite = rest.includes("--enable-write");
    rest = rest.filter((a) => a !== "--enable-write");
    const bad = rest.find((a) => a.startsWith("-"));
    if (bad) return { ok: false, error: `unknown flag "${bad}"` };
    if (rest.length > 0) return { ok: false, error: `unexpected argument "${rest[0]}"` };
    return { ok: true, mode: { kind: "routine", id, ...(enableWrite ? { enableWrite } : {}) } };
  }

  if (hasPrompt) {
    const i = args.indexOf("--prompt");
    const arg = args[i + 1];
    if (arg === undefined) return { ok: false, error: 'flag "--prompt" requires <file_path|text>' };
    let rest = [...args.slice(0, i), ...args.slice(i + 2)];
    const enableWrite = rest.includes("--enable-write");
    rest = rest.filter((a) => a !== "--enable-write");
    const bad = rest.find((a) => a.startsWith("-"));
    if (bad) return { ok: false, error: `unknown flag "${bad}"` };
    return { ok: true, mode: { kind: "prompt", arg, ...(enableWrite ? { enableWrite } : {}) } };
  }

  if (isChat) {
    const chatArgs = first === "chat" ? args.slice(1) : args;
    let resume: { id?: string } | undefined;
    let forceNew = false;
    for (let i = 0; i < chatArgs.length; i++) {
      const a = chatArgs[i]!;
      if (a === "--new") {
        forceNew = true;
      } else if (a === "--enable-write") {
        // `--enable-write` is a HEADLESS-only flag (§2.2): with chat it is a
        // usage error (exit 2), never a silent no-op.
        return { ok: false, error: '"--enable-write" is valid only with --prompt or --routine' };
      } else if (a === "--resume") {
        const next = chatArgs[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          resume = { id: next };
          i += 1;
        } else {
          resume = {};
        }
      } else if (a.startsWith("-")) {
        return { ok: false, error: `unknown flag "${a}"` };
      } else {
        return { ok: false, error: `unexpected argument "${a}"` };
      }
    }
    if (resume && forceNew) {
      return { ok: false, error: "--resume and --new are mutually exclusive" };
    }
    const mode: ParsedMode = { kind: "chat" };
    if (resume) (mode as { resume?: { id?: string } }).resume = resume;
    if (forceNew) (mode as { forceNew?: boolean }).forceNew = forceNew;
    return { ok: true, mode };
  }

  // A leading flag that is not a known top-level flag.
  if (first && first.startsWith("-") && !KNOWN_TOP_FLAGS.has(first)) {
    return { ok: false, error: `unknown flag "${first}"` };
  }
  return { ok: false, error: `unexpected argument "${first}"` };
}

/** The grouped-by-workflow help text with angle-bracket placeholders (§2.1). */
export function helpText(): string {
  return [
    "voidrift — the terminal agent harness on the VoidRift core SDK",
    "",
    "Interactive:",
    "  voidrift chat                     Start a new session and open the TUI",
    "  voidrift chat --resume [<id>]     Resume a session (bare: the most recent)",
    "  voidrift chat --new               Force a fresh session",
    "  (Shift+Tab cycles the top-level agents; a write agent asks to confirm once.)",
    "",
    "Headless:",
    "  voidrift --prompt <file_path|text>   Run a one-shot prompt, stream, exit",
    "  voidrift --prompt @<path>            Force the argument to be read as a file",
    "  voidrift --prompt -                  Read the prompt from stdin",
    "  voidrift --routine <id>              Run a saved routine, then exit",
    "  --enable-write                       Headless runs are READ-ONLY by default;",
    "                                       pass this (with --prompt/--routine only) to",
    "                                       allow changes. Never-list commands, deny",
    "                                       rules, Warden and guardrails still apply.",
    "",
    "Maintenance:",
    "  voidrift init                     Seed or repair ~/.config/voidrift and create .voidrift/ in this directory; if enabled plugins have agent templates, offer to copy them (TTY: prompt; headless: copy only with --yes)",
    "  voidrift init --yes               Confirm the plugin-template copy non-interactively (headless only; use --reset/--update/--sweep/--migrate/--vacuum as separate invocations)",
    "  voidrift init --reset <name>      Restore one seeded default (an agent name, or 'config') after a confirmed diff",
    "  voidrift init --reset <name> --yes  Confirm the reset non-interactively (valid only with --reset)",
    "  voidrift init --update            Bring seeded agents, skills, and allow rules up to the current shipped set",
    "  voidrift init --update --yes      Confirm the update batch non-interactively",
    "  voidrift init --sweep             Move backup/editor leftovers out of the live directories into a backup set",
    "  voidrift init --migrate           Rewrite config files that name a retired key to its current name (backed up first)",
    "  voidrift init --vacuum            Convert the workspace checkpoint store to reclaim freed space (auto_vacuum=INCREMENTAL; backed up first)",
    "  voidrift doctor                   Validate every resource and its configuration (read-only)",
    "  voidrift doctor --offline         Validate without any network check (CI/offline)",
    "  voidrift doctor --json            Emit findings as machine-readable JSON",
    "  voidrift access                   Print the effective permissions (read-only agent)",
    "  voidrift access --enable-write    Print the effective permissions for the write agent",
    "  voidrift export <id|last>         Render a stored session as a sanitized document (JSON/Markdown)",
    "  voidrift export last --format md --out session.md   Write a sanitized Markdown transcript to a file",
    "  voidrift stats                    Print the cost/token/time report across this workspace's sessions",
    "  voidrift stats --days 7 --json    Filter by day cutoff and emit one JSON document",
    "",
    "Other:",
    "  voidrift --version                Print the version",
    "  voidrift --help                   Print this help",
    "",
    "Examples:",
    "  voidrift chat --resume",
    '  cat notes.md | voidrift --prompt "summarize"',
    "  voidrift --routine daily-report --enable-write",
  ].join("\n");
}
