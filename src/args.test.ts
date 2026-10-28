/**
 * §2.6 integration test — commands, flags, `--prompt` resolution, and the
 * `RunStatus` → exit-code mapping (cli-blueprint.md §2.6).
 */
import { describe, it, expect } from "vitest";
import { parseArgs, helpText } from "./args.js";
import { resolvePrompt, boundLines, type ResolveDeps } from "./prompt-resolve.js";
import { exitCodeFor, EXIT } from "./exit-codes.js";

describe("§2.2 flag and command parsing", () => {
  it("parses chat with no flags as a new interactive session", () => {
    const r = parseArgs(["chat"]);
    expect(r.ok && r.mode.kind).toBe("chat");
  });

  it("--help and --version resolve to their standalone modes", () => {
    expect(parseArgs(["--help"]).ok && (parseArgs(["--help"]) as { mode: { kind: string } }).mode.kind).toBe("help");
    expect(parseArgs(["--version"]).ok && (parseArgs(["--version"]) as { mode: { kind: string } }).mode.kind).toBe("version");
  });

  it("rejects an unknown flag with a usage error", () => {
    const r = parseArgs(["chat", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown flag "--nope"');
  });

  it("rejects combining distinct modes", () => {
    const r = parseArgs(["chat", "--prompt", "hi"]);
    expect(r.ok).toBe(false);
  });

  it("parses `doctor` with no flags", () => {
    const r = parseArgs(["doctor"]);
    expect(r.ok && r.mode.kind).toBe("doctor");
  });

  it("parses `doctor --offline --json`", () => {
    const r = parseArgs(["doctor", "--offline", "--json"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode.kind === "doctor") {
      expect(r.mode.offline).toBe(true);
      expect(r.mode.json).toBe(true);
    }
  });

  it("rejects an unknown doctor flag with exit-2 usage", () => {
    const r = parseArgs(["doctor", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown flag "--nope"');
  });

  it("rejects an unexpected doctor argument", () => {
    const r = parseArgs(["doctor", "foo"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unexpected argument "foo"');
  });

  it("help text lists the doctor command under Maintenance", () => {
    expect(helpText()).toContain("voidrift doctor");
  });

  it("parses `access` with no flags and with --enable-write", () => {
    const a = parseArgs(["access"]);
    expect(a.ok && a.mode.kind).toBe("access");
    const b = parseArgs(["access", "--enable-write"]);
    expect(b.ok).toBe(true);
    if (b.ok && b.mode.kind === "access") expect(b.mode.enableWrite).toBe(true);
  });

  it("rejects any other access flag or a positional argument with exit 2", () => {
    const f = parseArgs(["access", "--json"]);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.error).toContain('unknown flag "--json"');
    const g = parseArgs(["access", "foo"]);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toContain('unexpected argument "foo"');
  });

  it("help text lists the access command", () => {
    expect(helpText()).toContain("voidrift access");
  });

  it("rejects --resume and --new together", () => {
    const r = parseArgs(["chat", "--resume", "--new"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mutually exclusive");
  });

  it("--resume consumes the next arg as an id only when it is not a flag", () => {
    const withId = parseArgs(["chat", "--resume", "3f9a1c7e"]);
    expect(withId.ok && (withId.mode as { resume?: { id?: string } }).resume?.id).toBe("3f9a1c7e");
    const bare = parseArgs(["chat", "--resume", "--new"]);
    expect(bare.ok).toBe(false); // --new after bare resume is the exclusivity error
    const bareOnly = parseArgs(["chat", "--resume"]);
    expect(bareOnly.ok && (bareOnly.mode as { resume?: { id?: string } }).resume).toEqual({});
  });

  it("--routine requires an id", () => {
    expect(parseArgs(["--routine"]).ok).toBe(false);
    const r = parseArgs(["--routine", "daily"]);
    expect(r.ok && (r.mode as { id: string }).id).toBe("daily");
  });

  it("--routine --list is the routine-list mode (no id)", () => {
    const r = parseArgs(["--routine", "--list"]);
    expect(r.ok && r.mode.kind).toBe("routine-list");
    // An extra positional with --list is a usage error.
    const bad = parseArgs(["--routine", "--list", "extra"]);
    expect(bad.ok).toBe(false);
  });

  it("help text groups by workflow with angle-bracket placeholders", () => {
    const text = helpText();
    expect(text).toContain("Interactive:");
    expect(text).toContain("Headless:");
    expect(text).toContain("<file_path|text>");
    expect(text).toContain("<id>");
  });

  it("--enable-write is valid with --prompt and --routine", () => {
    const prompt = parseArgs(["--prompt", "hi", "--enable-write"]);
    expect(prompt.ok && (prompt.mode as { enableWrite?: boolean }).enableWrite).toBe(true);
    expect(prompt.ok && (prompt.mode as { arg: string }).arg).toBe("hi");
    const routine = parseArgs(["--routine", "daily", "--enable-write"]);
    expect(routine.ok && (routine.mode as { enableWrite?: boolean }).enableWrite).toBe(true);
    expect(routine.ok && (routine.mode as { id: string }).id).toBe("daily");
  });

  it("--enable-write with chat (or alone) is a usage error (exit 2)", () => {
    const chat = parseArgs(["chat", "--enable-write"]);
    expect(chat.ok).toBe(false);
    if (!chat.ok) expect(chat.error).toContain("--enable-write");
    const alone = parseArgs(["--enable-write"]);
    expect(alone.ok).toBe(false);
  });

  it("omitting --enable-write leaves enableWrite unset", () => {
    const prompt = parseArgs(["--prompt", "hi"]);
    expect(prompt.ok && (prompt.mode as { enableWrite?: boolean }).enableWrite).toBeUndefined();
  });

  it("--vibe is no longer a flag — it is an unknown flag (never aliased)", () => {
    for (const argv of [["chat", "--vibe"], ["--prompt", "hi", "--vibe"], ["--routine", "daily", "--vibe"]]) {
      const r = parseArgs(argv);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain('unknown flag "--vibe"');
    }
  });

  it("the old --danger-no-ask name is no longer accepted — it is an unknown flag (never aliased)", () => {
    for (const argv of [
      ["chat", "--danger-no-ask"],
      ["--prompt", "hi", "--danger-no-ask"],
      ["--routine", "daily", "--danger-no-ask"],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain('unknown flag "--danger-no-ask"');
    }
  });

  it("--auto-approve is NOT a flag — it is an unknown flag (never aliased)", () => {
    for (const argv of [
      ["chat", "--auto-approve"],
      ["--prompt", "hi", "--auto-approve"],
      ["--routine", "daily", "--auto-approve"],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain('unknown flag "--auto-approve"');
    }
  });

  it("help documents --enable-write under Headless and has no Vibe group", () => {
    const text = helpText();
    expect(text).toContain("Headless:");
    expect(text).toContain("--enable-write");
    expect(text).not.toContain("Vibe:");
    expect(text).not.toContain("--vibe");
  });
});

describe("§2.1 init command (CLI §2.1, core §13.9.1)", () => {
  it("parses `init` as the init command", () => {
    const r = parseArgs(["init"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { reset?: string }).reset).toBeUndefined();
    expect(r.ok && (r.mode as { yes?: boolean }).yes).toBeUndefined();
  });

  it("parses `init --reset <name>`", () => {
    const r = parseArgs(["init", "--reset", "researcher"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { reset?: string }).reset).toBe("researcher");
  });

  it("parses `init --reset <name> --yes`", () => {
    const r = parseArgs(["init", "--reset", "config", "--yes"]);
    expect(r.ok && (r.mode as { reset?: string }).reset).toBe("config");
    expect(r.ok && (r.mode as { yes?: boolean }).yes).toBe(true);
  });

  it("`--reset` requires a name", () => {
    const r = parseArgs(["init", "--reset"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"--reset" requires a <name>');
  });

  it("parses `init --yes` (confirms plugin-template copy in headless init)", () => {
    const r = parseArgs(["init", "--yes"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { yes?: boolean }).yes).toBe(true);
  });

  it("`--yes` with `--sweep` or `--migrate` is a usage error (exit 2)", () => {
    const sweep = parseArgs(["init", "--sweep", "--yes"]);
    expect(sweep.ok).toBe(false);
    if (!sweep.ok) expect(sweep.error).toContain('"--yes" is valid only');
    const migrate = parseArgs(["init", "--migrate", "--yes"]);
    expect(migrate.ok).toBe(false);
    if (!migrate.ok) expect(migrate.error).toContain('"--yes" is valid only');
  });

  it("`init` with an unrelated flag is a usage error (exit 2)", () => {
    const r = parseArgs(["init", "--new"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown flag "--new"');
  });

  it("parses `init --update`", () => {
    const r = parseArgs(["init", "--update"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { update?: boolean }).update).toBe(true);
  });

  it("parses `init --update --yes`", () => {
    const r = parseArgs(["init", "--update", "--yes"]);
    expect(r.ok && (r.mode as { update?: boolean }).update).toBe(true);
    expect(r.ok && (r.mode as { yes?: boolean }).yes).toBe(true);
  });

  it("`init --update --reset <name>` is a usage error (not combinable)", () => {
    const r = parseArgs(["init", "--update", "--reset", "research"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("may not be combined");
  });

  it("parses `init --sweep`", () => {
    const r = parseArgs(["init", "--sweep"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { sweep?: boolean }).sweep).toBe(true);
  });

  it("`init --sweep --update` is a usage error (not combinable)", () => {
    const r = parseArgs(["init", "--sweep", "--update"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("may not be combined");
  });

  it("parses `init --migrate`", () => {
    const r = parseArgs(["init", "--migrate"]);
    expect(r.ok && r.mode.kind).toBe("init");
    expect(r.ok && (r.mode as { migrate?: boolean }).migrate).toBe(true);
  });

  it("`init --migrate --sweep` is a usage error (not combinable)", () => {
    const r = parseArgs(["init", "--migrate", "--sweep"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("may not be combined");
  });

  it("`init --sweep --reset <name>` is a usage error (not combinable)", () => {
    const r = parseArgs(["init", "--sweep", "--reset", "config"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("may not be combined");
  });

  it("`--yes` with `--update` alone is valid", () => {
    const r = parseArgs(["init", "--update", "--yes"]);
    expect(r.ok).toBe(true);
  });

  it("`init` with an unexpected argument is a usage error (exit 2)", () => {
    const r = parseArgs(["init", "extra"]);
    expect(r.ok).toBe(false);
  });

  it("`chat` parsing is unchanged by the init addition", () => {
    const r = parseArgs(["chat", "--resume", "3f9a1c7e"]);
    expect(r.ok && r.mode.kind).toBe("chat");
    expect(r.ok && (r.mode as { resume?: { id?: string } }).resume?.id).toBe("3f9a1c7e");
  });

  it("help lists init under a Maintenance group with --reset/--yes", () => {
    const text = helpText();
    expect(text).toContain("Maintenance:");
    expect(text).toContain("Seed or repair ~/.config/voidrift and create .voidrift/ in this directory");
    expect(text).toContain("if enabled plugins have agent templates");
    expect(text).toContain("--reset <name>");
    expect(text).toContain("--yes");
    expect(text).toContain("voidrift init --update");
  });
});

describe("§2.3 --prompt argument resolution", () => {
  const deps = (files: Record<string, string>, stdin?: string): ResolveDeps => ({
    readFile: async (p) => {
      if (p in files) return files[p]!;
      throw new Error("ENOENT");
    },
    isReadableFile: async (p) => p in files,
    readStdin: async () => stdin,
    maxReadLines: 2000,
  });

  it("resolves an existing readable file to its contents", async () => {
    const r = await resolvePrompt("./exists.md", deps({ "./exists.md": "FILE BODY" }));
    expect(r.ok && r.prompt).toBe("FILE BODY");
  });

  it("resolves a non-file argument to literal text", async () => {
    const r = await resolvePrompt("literal prompt", deps({}));
    expect(r.ok && r.prompt).toBe("literal prompt");
  });

  it("@<path> forces a file read and bounds it by maxReadLines", async () => {
    const body = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const d = deps({ "big.md": body });
    d.maxReadLines = 3;
    const r = await resolvePrompt("@big.md", d);
    expect(r.ok && r.prompt).toBe("line0\nline1\nline2");
  });

  it("a forced file that cannot be read is a usage error", async () => {
    const r = await resolvePrompt("@missing.md", deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.usageError).toContain("missing.md");
  });

  it("- reads the prompt from stdin", async () => {
    const r = await resolvePrompt("-", deps({}, "piped text"));
    expect(r.ok && r.prompt).toBe("piped text");
  });

  it("piped stdin is appended to the resolved prompt", async () => {
    const r = await resolvePrompt("summarize", deps({}, "NOTES"));
    expect(r.ok && r.prompt).toBe("summarize\n\n---\n\nNOTES");
  });

  it("boundLines truncates past the limit", () => {
    expect(boundLines("a\nb\nc\nd", 2)).toBe("a\nb");
  });
});

describe("§2.4 RunStatus → exit-code mapping", () => {
  it("maps each terminal status to its code", () => {
    expect(exitCodeFor("completed")).toBe(EXIT.COMPLETED);
    expect(exitCodeFor("failed")).toBe(EXIT.FAILED);
    expect(exitCodeFor("limit_reached")).toBe(EXIT.LIMIT_REACHED);
    expect(exitCodeFor("waiting_for_approval")).toBe(EXIT.WAITING_FOR_APPROVAL);
    expect(exitCodeFor("waiting_for_input")).toBe(EXIT.WAITING_FOR_INPUT);
    expect(exitCodeFor("cancelled")).toBe(EXIT.SIGINT);
  });
});

describe("§2.1/§2.2 stats command (CLI §2.1, core §10.14)", () => {
  it("parses `stats` with no flags as the stats command", () => {
    const r = parseArgs(["stats"]);
    expect(r.ok && r.mode.kind).toBe("stats");
  });

  it("parses --days N, --model, --agent and --json", () => {
    const r = parseArgs(["stats", "--days", "7", "--model", "local", "--agent", "chat", "--json"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode.kind === "stats") {
      expect(r.mode.days).toBe(7);
      expect(r.mode.model).toBe("local");
      expect(r.mode.agent).toBe("chat");
      expect(r.mode.json).toBe(true);
    }
  });

  it("rejects a non-positive or non-integer --days", () => {
    expect(parseArgs(["stats", "--days", "0"]).ok).toBe(false);
    expect(parseArgs(["stats", "--days", "x"]).ok).toBe(false);
    expect(parseArgs(["stats", "--days"]).ok).toBe(false);
  });

  it("rejects an unknown flag and a positional argument (exit 2)", () => {
    expect(parseArgs(["stats", "--nope"]).ok).toBe(false);
    expect(parseArgs(["stats", "extra"]).ok).toBe(false);
  });
});
