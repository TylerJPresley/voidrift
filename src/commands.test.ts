/**
 * §7.3 slash-command routing (cli-blueprint.md §7.3). Each user command is
 * exactly one CoreAPI op; a non-special-cased command routes through
 * `session.command`; an unknown command neither sends nor dispatches.
 */
import { describe, it, expect, vi } from "vitest";
import { parseCommand, dispatchCommand } from "./commands.js";
import { BUILTIN_PANELS } from "./panels/declarations.js";
import type { CoreAPI } from "@voidrift/core";

function fakeApi(overrides: Record<string, unknown> = {}): CoreAPI {
  return {
    models: { switch: vi.fn(async () => ({ ok: true, value: {} })), list: vi.fn() },
    agents: { activate: vi.fn(async () => ({ ok: true, value: {} })) },
    session: {
      create: vi.fn(async () => ({ ok: true, value: { id: "x" } })),
      clear: vi.fn(async () => ({ ok: true, value: { id: "y" } })),
      compact: vi.fn(async () => ({ ok: true, value: { turnsFolded: 1 } })),
      cancel: vi.fn(async () => ({ ok: true, value: undefined })),
      command: vi.fn(async () => ({ ok: true, value: {} })),
      ...((overrides["session"] as object) ?? {}),
    },
    ...overrides,
  } as unknown as CoreAPI;
}

describe("§7.3 parseCommand", () => {
  it("lowercases the name and splits space-delimited args", () => {
    expect(parseCommand("/Model gpt-4o")).toEqual({ name: "model", args: ["gpt-4o"] });
    expect(parseCommand("not a command")).toBeNull();
  });
});

describe("§7.3 dispatchCommand", () => {
  it("/model <name> calls models.switch; bare /model opens the models panel", async () => {
    const api = fakeApi();
    const sw = api.models.switch as unknown as ReturnType<typeof vi.fn>;
    expect(await dispatchCommand(api, "s", { name: "model", args: ["gpt-4o"] }, [])).toEqual({ kind: "handled" });
    expect(sw).toHaveBeenCalledWith("gpt-4o");
    expect(await dispatchCommand(api, "s", { name: "model", args: [] }, [])).toEqual({ kind: "open_panel", name: "model" });
  });

  it("bare /model and /agent open panel ids that exist in BUILTIN_PANELS (not the titles)", async () => {
    const api = fakeApi();
    const modelOut = await dispatchCommand(api, "s", { name: "model", args: [] }, []);
    const agentOut = await dispatchCommand(api, "s", { name: "agent", args: [] }, []);
    expect(modelOut.kind).toBe("open_panel");
    expect(agentOut.kind).toBe("open_panel");
    const ids = Object.keys(BUILTIN_PANELS);
    expect(ids).toContain((modelOut as { name: string }).name);
    expect(ids).toContain((agentOut as { name: string }).name);
  });

  it("/routine <id> calls session.command('routine', id)", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    await dispatchCommand(api, "s", { name: "routine", args: ["daily-report"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", "daily-report");
  });

  it("/sessions and /diff open their panels", async () => {
    const api = fakeApi();
    expect(await dispatchCommand(api, "s", { name: "sessions", args: [] }, [])).toEqual({ kind: "open_panel", name: "sessions" });
    expect(await dispatchCommand(api, "s", { name: "diff", args: [] }, [])).toEqual({ kind: "open_panel", name: "diff" });
  });

  it("a registered plugin command routes through session.command", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "deploy", args: ["prod"] }, ["deploy"]);
    expect(out).toEqual({ kind: "handled" });
    expect(cmd).toHaveBeenCalledWith("deploy", "prod");
  });

  it("an unknown command returns the unknown outcome and dispatches nothing", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    expect(await dispatchCommand(api, "s", { name: "nope", args: [] }, [])).toEqual({ kind: "unknown", name: "nope" });
    expect(cmd).not.toHaveBeenCalled();
  });

  it("/quit shuts down and /cancel cancels", async () => {
    const api = fakeApi();
    expect(await dispatchCommand(api, "s", { name: "quit", args: [] }, [])).toEqual({ kind: "quit" });
    expect((await dispatchCommand(api, "s", { name: "cancel", args: [] }, [])).kind).toBe("cancel");
  });

  it("/new and /clear start a fresh session; /compact compacts; /editor is client-side", async () => {
    const api = fakeApi();
    expect((await dispatchCommand(api, "s", { name: "new", args: [] }, [])).kind).toBe("new_session");
    expect((await dispatchCommand(api, "s", { name: "clear", args: [] }, [])).kind).toBe("new_session");
    expect((await dispatchCommand(api, "s", { name: "compact", args: [] }, [])).kind).toBe("handled");
    expect((await dispatchCommand(api, "s", { name: "editor", args: [] }, [])).kind).toBe("editor");
  });

  it("/resume with an id resumes; bare /resume opens the sessions view", async () => {
    const api = fakeApi();
    expect(await dispatchCommand(api, "s", { name: "resume", args: ["abc"] }, [])).toEqual({ kind: "resume", id: "abc" });
    expect(await dispatchCommand(api, "s", { name: "resume", args: [] }, [])).toEqual({ kind: "open_panel", name: "sessions" });
  });

  it("/agent <name> switches the active top-level agent via session.setMode; a failing op surfaces an error", async () => {
    const setMode = vi.fn(async () => ({ ok: false, error: { code: "NOT_FOUND", message: 'no top-level agent named "reviewer"; valid agents: chat, research' } }));
    const api = fakeApi({ session: { setMode } });
    const out = await dispatchCommand(api, "s", { name: "agent", args: ["reviewer"] }, []);
    expect(setMode).toHaveBeenCalledWith("s", "reviewer");
    expect(out).toEqual({ kind: "error", message: 'no top-level agent named "reviewer"; valid agents: chat, research' });
    expect((await dispatchCommand(api, "s", { name: "agent", args: [] }, [])).kind).toBe("open_panel");
  });

  it("/agent <name> with a known top-level agent calls session.setMode and reports handled", async () => {
    const setMode = vi.fn(async () => ({ ok: true, value: { from: "chat", to: "research" } }));
    const api = fakeApi({ session: { setMode } });
    const out = await dispatchCommand(api, "s", { name: "agent", args: ["research"] }, []);
    expect(setMode).toHaveBeenCalledWith("s", "research");
    expect(out).toEqual({ kind: "handled" });
  });

  it("/config prints the layers and effective config, redacting secrets, no turn (§7.3)", async () => {
    const paths = vi.fn(async () => ({
      ok: true,
      value: {
        managed: { path: "/etc/voidrift/managed.json", exists: false },
        global: { path: "/home/u/.config/voidrift/config.json", exists: true },
        project: { path: "/proj/.voidrift/config.json", exists: true },
        session: { path: "(session)", exists: false },
      },
    }));
    const get = vi.fn(async () => ({
      ok: true,
      value: { modelSelected: "local", models: { local: { apiKeyEnv: "OPENAI_API_KEY", apiKey: "sk-secret" } } },
    }));
    const send = vi.fn();
    const api = fakeApi({ config: { paths, get }, session: { send } });
    const out = await dispatchCommand(api, "s", { name: "config", args: [] }, []);
    expect(out.kind).toBe("system_message");
    const text = (out as { text: string }).text;
    expect(text).toContain("/proj/.voidrift/config.json");
    expect(text).toContain("OPENAI_API_KEY"); // the env-var NAME is safe to show
    expect(text).not.toContain("sk-secret"); // the key value is redacted
    expect(text).toContain("«redacted»");
    expect(send).not.toHaveBeenCalled();
  });

  it("/config edit opens the project config file (open_file outcome)", async () => {
    const paths = vi.fn(async () => ({
      ok: true,
      value: {
        managed: { path: "m", exists: false },
        global: { path: "g", exists: true },
        project: { path: "/proj/.voidrift/config.json", exists: true },
        session: { path: "s", exists: false },
      },
    }));
    const api = fakeApi({ config: { paths } });
    const out = await dispatchCommand(api, "s", { name: "config", args: ["edit"] }, []);
    expect(out).toEqual({ kind: "open_file", path: "/proj/.voidrift/config.json" });
  });

  it("/routine with no id is an error", async () => {
    const api = fakeApi();
    expect((await dispatchCommand(api, "s", { name: "routine", args: [] }, [])).kind).toBe("error");
  });

  it("/routine list routes { list: true } and renders rows as a system_message", async () => {
    const api = fakeApi({
      session: {
        command: vi.fn(async () => ({ ok: true, value: { routines: [{ id: "daily", preview: "do it", savedAt: "t" }] } })),
      },
    });
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "routine", args: ["list"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", { list: true });
    expect(out.kind).toBe("system_message");
    expect((out as { text: string }).text).toContain("daily");
  });

  it("/routine show <id> routes { show } and /routine delete <id> routes { delete }", async () => {
    const api = fakeApi({
      session: {
        command: vi.fn(async (_n: string, a: unknown) =>
          (a as { show?: string }).show
            ? { ok: true, value: { routine: { id: "daily", prompt: "p" } } }
            : { ok: true, value: { deleted: "daily" } },
        ),
      },
    });
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const show = await dispatchCommand(api, "s", { name: "routine", args: ["show", "daily"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", { show: "daily" });
    expect(show.kind).toBe("system_message");
    await dispatchCommand(api, "s", { name: "routine", args: ["delete", "daily"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", { delete: "daily" });
  });

  it("/routine save <id> @file reads through the injected reader, capped, and routes { save }", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const readPromptFile = vi.fn(async () => "x".repeat(10000));
    await dispatchCommand(api, "s", { name: "routine", args: ["save", "big", "@notes.md"] }, [], { readPromptFile });
    expect(readPromptFile).toHaveBeenCalledWith("notes.md");
    const call = cmd.mock.calls.find((c) => c[0] === "routine" && (c[1] as { save?: unknown }).save);
    expect((call![1] as { save: { prompt: string } }).save.prompt).toHaveLength(8192);
  });

  it("/routine save <id> @file without a reader reports it is unavailable", async () => {
    const api = fakeApi();
    const out = await dispatchCommand(api, "s", { name: "routine", args: ["save", "x", "@f"] }, []);
    expect(out.kind).toBe("error");
    expect((out as { message: string }).message).toContain("not available");
  });

  it("/access reads config.access and returns a system_message, never a turn (§7.4)", async () => {
    const report = {
      activeAgent: "chat",
      agents: { topLevel: [{ name: "chat", kind: "top-level", tools: ["*"], order: 10, unlisted: "ask", workers: "all", source: "builtin" }], worker: [] },
      allowList: { tools: [], commands: [] },
      unlistedBehaviour: "ask first",
      mutatingRunsFreely: false,
      webSearch: { provider: "duckduckgo", note: "(default) — your queries are sent there" },
      neverList: [],
      alwaysAsks: ["x"],
      unlock: [],
      rules: [],
      workers: [],
      rollback: { method: "cache", snapshotCount: 50, layer: "default" },
      notices: { rejections: [], warnings: [] },
    };
    const access = vi.fn(async () => ({ ok: true, value: report }));
    const send = vi.fn();
    const api = fakeApi({ config: { access }, session: { send } });
    const out = await dispatchCommand(api, "s", { name: "access", args: [] }, []);
    expect(out.kind).toBe("system_message");
    expect((out as { text: string }).text).toContain("VoidRift access — active agent: chat");
    expect(access).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("/access surfaces an error when config.access fails", async () => {
    const api = fakeApi({ config: { access: async () => ({ ok: false, error: { code: "INTERNAL", message: "nope" } }) } });
    expect(await dispatchCommand(api, "s", { name: "access", args: [] }, [])).toEqual({ kind: "error", message: "nope" });
  });

  // ── §7.5 rollback commands ──
  const moveFixture = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    sessionId: "s",
    turn: id,
    time: "2026-01-01T14:02:00.000Z",
    summary: `move ${id}`,
    conversation: { beforeCheckpointId: null, afterCheckpointId: `cp-${id}` },
    files: { method: "git", paths: [{ path: "a.ts", kind: "modified", restorable: true }], notUndoable: [] },
    ...over,
  });

  it("/goto with no argument lists the timeline from session.moves, no turn", async () => {
    const moves = vi.fn(async () => ({ ok: true, value: { enabled: true, method: "git", pointer: 1, moves: [moveFixture(1)] } }));
    const send = vi.fn();
    const api = fakeApi({ session: { moves, send } });
    const out = await dispatchCommand(api, "s", { name: "goto", args: [] }, []);
    expect(out.kind).toBe("system_message");
    expect((out as { text: string }).text).toContain("Move timeline — 1 move, git snapshots");
    expect(moves).toHaveBeenCalledWith("s");
    expect(send).not.toHaveBeenCalled();
  });

  it("/undo with no conflict calls session.undo and prints the summary", async () => {
    const undo = vi.fn(async () => ({ ok: true, value: { ok: true, action: "undo", fromPointer: 3, toPointer: 2, fromId: 3, toId: 2, restored: ["a.ts", "b.ts", "c.ts", "d.ts"], skipped: [], undone: 1, shellEffects: 0, method: "git", message: "x" } }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out.kind).toBe("system_message");
    expect((out as { text: string }).text).toContain("Undid move 3: conversation rewound to move 2; 4 files restored (git). /redo to reapply.");
  });

  it("/undo with a conflict returns a rollback_conflict outcome (dialog), nothing changed", async () => {
    const undo = vi.fn(async () => ({ ok: true, value: { ok: false, action: "undo", fromPointer: 3, toPointer: 3, fromId: 3, toId: 3, restored: [], skipped: [], undone: 0, shellEffects: 0, conflicts: ["src/users.ts", "src/pager.ts"], method: "git", message: "conflict" } }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out.kind).toBe("rollback_conflict");
    expect(out).toMatchObject({ action: "undo", movePointer: 3, conflicts: ["src/users.ts", "src/pager.ts"] });
  });

  it("/goto <id> calls session.goto and prints the moves-undone summary", async () => {
    const goto = vi.fn(async () => ({ ok: true, value: { ok: true, action: "goto", fromPointer: 3, toPointer: 1, fromId: 3, toId: 1, restored: ["a.ts"], skipped: [], undone: 2, shellEffects: 0, method: "git", message: "x" } }));
    const api = fakeApi({ session: { goto } });
    const out = await dispatchCommand(api, "s", { name: "goto", args: ["1"] }, []);
    expect(goto).toHaveBeenCalledWith("s", 1, undefined);
    expect((out as { text: string }).text).toContain("Went to move 1 (2 moves undone, git).");
  });

  it("/undo during a running turn prints the running-turn refusal (SESSION_BUSY)", async () => {
    const undo = vi.fn(async () => ({ ok: false, error: { code: "SESSION_BUSY", message: "busy" } }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out).toEqual({ kind: "system_message", text: "Rollback is unavailable while a turn is running." });
  });

  it("snapshotCount 0 prints the rollback-off line", async () => {
    const undo = vi.fn(async () => ({ ok: true, value: { ok: false, action: "undo", fromPointer: 0, toPointer: 0, restored: [], skipped: [], method: "cache", message: "rollback is off (snapshotCount is 0)" } }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out).toEqual({ kind: "system_message", text: "Rollback is off (snapshotCount is 0). Set snapshotCount to enable it." });
  });

  it("/goto a missing id prints the unknown-id line (NOT_FOUND)", async () => {
    const goto = vi.fn(async () => ({ ok: false, error: { code: "NOT_FOUND", message: "no move with id 9" } }));
    const api = fakeApi({ session: { goto } });
    const out = await dispatchCommand(api, "s", { name: "goto", args: ["9"] }, []);
    expect(out).toEqual({ kind: "system_message", text: "No move 9. /goto with no argument lists the timeline." });
  });

  it("/goto with a non-integer or negative id prints the unknown-id refusal, calls no op", async () => {
    const goto = vi.fn();
    const api = fakeApi({ session: { goto } });
    const bad = await dispatchCommand(api, "s", { name: "goto", args: ["abc"] }, []);
    expect(bad).toEqual({ kind: "system_message", text: "No move abc. /goto with no argument lists the timeline." });
    const neg = await dispatchCommand(api, "s", { name: "goto", args: ["-2"] }, []);
    expect(neg).toEqual({ kind: "system_message", text: "No move -2. /goto with no argument lists the timeline." });
    expect(goto).not.toHaveBeenCalled();
  });

  it("/undo of a not-undoable merge prints the fixed explanation naming the previous HEAD", async () => {
    const undo = vi.fn(async () => ({
      ok: true,
      value: {
        ok: false,
        action: "undo",
        fromPointer: 4,
        toPointer: 4,
        restored: [],
        skipped: [],
        notUndoable: [{ kind: "merge", detail: "previous HEAD abc1234" }],
        method: "git",
        message: "move 4 cannot be undone: it applied a worktree merge (previous HEAD abc1234)",
      },
    }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out).toEqual({
      kind: "system_message",
      text:
        "Move 4 applied a worker's changes (merge); /undo can't reverse it.\n" +
        "The previous HEAD was abc1234 — git reset there to undo it manually.",
    });
  });

  it("/undo on an empty timeline prints the fixed §7.5 'nothing to undo' line", async () => {
    const undo = vi.fn(async () => ({
      ok: true,
      value: { ok: false, action: "undo", fromPointer: 0, toPointer: 0, fromId: 0, toId: 0, restored: [], skipped: [], undone: 0, shellEffects: 0, method: "none", message: "already at the start of the timeline" },
    }));
    const api = fakeApi({ session: { undo } });
    const out = await dispatchCommand(api, "s", { name: "undo", args: [] }, []);
    expect(out).toEqual({ kind: "system_message", text: "Nothing to undo: you are at the start of the session." });
  });
});

describe("D1 — quote-aware tokenizing (parseCommand)", () => {
  it("keeps a double-quoted argument as one token", () => {
    expect(parseCommand('/plan create demo "the real goal"')).toEqual({
      name: "plan",
      args: ["create", "demo", "the real goal"],
    });
  });
  it("keeps a single-quoted argument as one token", () => {
    expect(parseCommand("/routine save nightly 'run the audit'")).toEqual({
      name: "routine",
      args: ["save", "nightly", "run the audit"],
    });
  });
  it("still splits unquoted args on whitespace (unchanged)", () => {
    expect(parseCommand("/model gpt-4o")).toEqual({ name: "model", args: ["gpt-4o"] });
  });
});

describe("D1 — /plan routes a STRUCTURED op (plan-blueprint §6)", () => {
  it("bare /plan opens the plan panel", async () => {
    const api = fakeApi();
    expect(await dispatchCommand(api, "s", { name: "plan", args: [] }, [])).toEqual({
      kind: "open_panel",
      name: "plan",
    });
  });
  it("/plan create <id> \"<goal>\" sends { op:create, id, goal } — never a string", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "plan", args: ["create", "demo", "the goal"] }, []);
    expect(out).toEqual({ kind: "handled" });
    expect(cmd).toHaveBeenCalledWith("plan", { op: "create", id: "demo", goal: "the goal", author: "human" });
  });
  it("/plan add-step builds a structured step", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    await dispatchCommand(api, "s", { name: "plan", args: ["add-step", "demo", "do X", "with detail"] }, []);
    expect(cmd).toHaveBeenCalledWith("plan", { op: "add-step", id: "demo", step: { title: "do X", detail: "with detail" }, author: "human" });
  });
  it("/plan activate | advance | abandon map to their ops", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    await dispatchCommand(api, "s", { name: "plan", args: ["activate", "demo"] }, []);
    expect(cmd).toHaveBeenLastCalledWith("plan", { op: "activate", id: "demo" });
    await dispatchCommand(api, "s", { name: "plan", args: ["advance", "demo", "passed"] }, []);
    expect(cmd).toHaveBeenLastCalledWith("plan", { op: "advance", id: "demo", outcome: "passed" });
    await dispatchCommand(api, "s", { name: "plan", args: ["abandon", "demo"] }, []);
    expect(cmd).toHaveBeenLastCalledWith("plan", { op: "abandon", id: "demo" });
  });
  it("/plan show prints the digest as a system message", async () => {
    const api = fakeApi({
      session: { command: vi.fn(async () => ({ ok: true, value: { plan: { id: "demo" }, status: "plan \"g\" — draft", digest: "Plan: g" } })) },
    });
    const out = await dispatchCommand(api, "s", { name: "plan", args: ["show"] }, []);
    expect(out.kind).toBe("system_message");
    expect((out as { text: string }).text).toContain("Plan: g");
  });
  it("a validation error is reported in plain words, no session.command call", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "plan", args: ["create", "demo"] }, []);
    expect(out.kind).toBe("error");
    expect(cmd).not.toHaveBeenCalled();
  });
  it("an unknown subcommand is a plain-word error", async () => {
    const api = fakeApi();
    const out = await dispatchCommand(api, "s", { name: "plan", args: ["frobnicate", "x"] }, []);
    expect(out.kind).toBe("error");
    expect((out as { message: string }).message).toContain("unknown /plan subcommand");
  });
});

describe("D1 — /routine save sends the structured { save } payload (routines §4)", () => {
  it("/routine save <id> <prompt...> sends { save:{ id, prompt } }", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "routine", args: ["save", "nightly", "run", "the", "audit"] }, []);
    expect(out).toEqual({ kind: "handled" });
    expect(cmd).toHaveBeenCalledWith("routine", { save: { id: "nightly", prompt: "run the audit" } });
  });
  it("/routine run <id> runs by bare id", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    await dispatchCommand(api, "s", { name: "routine", args: ["run", "nightly"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", "nightly");
  });
  it("bare /routine <id> still runs the saved routine", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    await dispatchCommand(api, "s", { name: "routine", args: ["nightly"] }, []);
    expect(cmd).toHaveBeenCalledWith("routine", "nightly");
  });
  it("/routine save with no prompt is a plain-word error", async () => {
    const api = fakeApi();
    const cmd = api.session.command as unknown as ReturnType<typeof vi.fn>;
    const out = await dispatchCommand(api, "s", { name: "routine", args: ["save", "nightly"] }, []);
    expect(out.kind).toBe("error");
    expect(cmd).not.toHaveBeenCalled();
  });
});
