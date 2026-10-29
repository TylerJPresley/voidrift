/**
 * `voidrift init` runner unit tests (cli-blueprint.md §2.1; core §13.9.1).
 *
 * The host-level init/preview ops are INJECTED as fakes, so these tests exercise
 * the CLI's own logic — the summary formatter, the dependency-free line diff,
 * the cwd==home/config skip, and the reset confirmation (TTY vs --yes vs refuse)
 * — with NO filesystem, NO core, NO network, and WITHOUT touching the ambient
 * HOME/XDG. Paths are plain strings chosen so no real directory is read.
 */
import { describe, it, expect } from "vitest";
import type { ConfigInitResult } from "@voidrift/core";
import { runInit, formatSummary, lineDiff, displayPath, type InitDeps } from "./init-command.js";
import { EXIT } from "./exit-codes.js";

/** A capturing streams/deps builder over fakes (no real FS or core). */
function makeDeps(over: Partial<InitDeps> = {}): { deps: InitDeps; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const deps: InitDeps = {
    stdout: { write: (s: string) => ((out += s), true) },
    stderr: { write: (s: string) => ((err += s), true) },
    cwd: "/work/project",
    isTty: false,
      // yes passed to runInit, not makeDeps
    homeDir: "/home/u",
    configDir: () => "/home/u/.config/voidrift",
    resetNames: () => ["config", "research", "vibe", "researcher", "planner", "implementer", "reviewer"],
    ...over,
  };
  return { deps, out: () => out, err: () => err };
}

const EMPTY: ConfigInitResult = { created: [], repaired: [], leftAlone: [] };

describe("formatSummary (§13.9.1)", () => {
  it("prints one line per non-empty group with ~ and the .rejected sidecar", () => {
    const result: ConfigInitResult = {
      created: ["config.json", "agents/research/agent.json"],
      repaired: ["agents/vibe/agent.json"],
      leftAlone: ["agents/planner/prompt.md", "agents/reviewer/prompt.md"],
    };
    const lines = formatSummary(result, "~/.config/voidrift");
    expect(lines[0]).toBe("created: ~/.config/voidrift/config.json, ~/.config/voidrift/agents/research/agent.json");
    expect(lines[1]).toContain("repaired: ~/.config/voidrift/agents/vibe/agent.json");
    expect(lines[1]).toContain("the replaced copy is kept under ~/.config/voidrift/backups/");
    expect(lines[2]).toBe("left alone: 2 files");
  });

  it("omits empty groups", () => {
    expect(formatSummary({ created: ["config.json"], repaired: [], leftAlone: [] }, "r")).toEqual([
      "created: r/config.json",
    ]);
  });
});

describe("displayPath", () => {
  it("renders a home-relative path with ~ and the home dir itself as ~", () => {
    expect(displayPath("/home/u/.config/voidrift/config.json", "/home/u")).toBe("~/.config/voidrift/config.json");
    expect(displayPath("/home/u", "/home/u")).toBe("~");
    expect(displayPath("/work/project/.voidrift", "/home/u")).toBe("/work/project/.voidrift");
  });
});

describe("lineDiff (dependency-free, §13.9.1)", () => {
  it("shows additions against an absent (null) current", () => {
    expect(lineDiff(null, "a\nb")).toEqual(["+ a", "+ b"]);
  });

  it("marks removals, additions, and context", () => {
    const d = lineDiff("keep\nold\ntail", "keep\nnew\ntail");
    expect(d).toContain("  keep");
    expect(d).toContain("- old");
    expect(d).toContain("+ new");
    expect(d).toContain("  tail");
  });

  it("an identical document is all context", () => {
    expect(lineDiff("x\ny", "x\ny")).toEqual(["  x", "  y"]);
  });
});

describe("runInit — plain run (§13.9.1)", () => {
  it("seeds the global base then creates the project skeleton; exits 0", async () => {
    const calls: { scope?: string; dir?: string }[] = [];
    const init = (async (opts: { scope?: string; dir?: string } = {}) => {
      calls.push(opts);
      return opts.scope === "project"
        ? { ok: true as const, value: { created: ["config.json"], repaired: [], leftAlone: [] } }
        : { ok: true as const, value: { created: ["config.json"], repaired: [], leftAlone: ["agents/research/agent.json"] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out } = makeDeps({ init });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(calls.map((c) => c.scope)).toEqual(["global", "project"]);
    expect(calls[1]!.dir).toBe("/work/project");
    expect(out()).toContain("created: ~/.config/voidrift/config.json");
    expect(out()).toContain("left alone: 1 files");
    expect(out()).toContain("created: /work/project/.voidrift/config.json");
  });

  it("skips the project skeleton when cwd IS the home directory", async () => {
    const calls: { scope?: string }[] = [];
    const init = (async (opts: { scope?: string } = {}) => {
      calls.push(opts);
      return { ok: true as const, value: EMPTY };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out } = makeDeps({ init, cwd: "/home/u" });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(calls.map((c) => c.scope)).toEqual(["global"]); // no project call
    expect(out()).toContain("your home directory");
  });

  it("skips the project skeleton when cwd IS the global config directory", async () => {
    const calls: { scope?: string }[] = [];
    const init = (async (opts: { scope?: string } = {}) => {
      calls.push(opts);
      return { ok: true as const, value: EMPTY };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out } = makeDeps({ init, cwd: "/home/u/.config/voidrift" });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(calls.map((c) => c.scope)).toEqual(["global"]);
    expect(out()).toContain("global config directory");
  });

  it("a global failure prints to stderr and exits 1", async () => {
    const init = (async () => ({ ok: false as const, error: { code: "INTERNAL", message: "disk full" } })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, err } = makeDeps({ init });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.FAILED);
    expect(err()).toContain("disk full");
  });
});

describe("runInit — --reset (§13.9.1)", () => {
  const preview = (async (name: string) => {
    if (name === "researcher") {
      return {
        ok: true as const,
        value: [
          { rel: "agents/researcher/agent.json", current: "old", def: "new" },
          { rel: "agents/researcher/prompt.md", current: "p old", def: "p new" },
        ],
      };
    }
    return { ok: false as const, error: { code: "INVALID_INPUT", message: `unknown reset target "${name}"` } };
  }) as unknown as NonNullable<InitDeps["preview"]>;

  it("non-interactive reset without --yes refuses (exit 2) and writes nothing", async () => {
    let wrote = false;
    const init = (async () => ((wrote = true), { ok: true as const, value: EMPTY })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out, err } = makeDeps({ preview, init, isTty: false });
    const code = await runInit({ reset: "researcher" }, deps);
    expect(code).toBe(EXIT.USAGE);
    expect(wrote).toBe(false);
    expect(out()).toContain("- old"); // the diff was still shown
    expect(out()).toContain("+ new");
    expect(err()).toContain("not a TTY");
  });

  it("reset with --yes restores and prints the summary; exits 0", async () => {
    const calls: { reset?: string[]; confirmed?: boolean }[] = [];
    const init = (async (opts: { reset?: string[]; confirmed?: boolean } = {}) => {
      calls.push(opts);
      return { ok: true as const, value: { created: [], repaired: ["agents/researcher/agent.json"], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out } = makeDeps({ preview, init, isTty: false });
    const code = await runInit({ reset: "researcher", yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(calls[0]).toEqual({ scope: "global", reset: ["researcher"], confirmed: true });
    expect(out()).toContain("repaired: ~/.config/voidrift/agents/researcher/agent.json");
  });

  it("an interactive 'y' confirms and restores", async () => {
    let wrote = false;
    const init = (async () => ((wrote = true), { ok: true as const, value: { created: [], repaired: ["agents/researcher/prompt.md"], leftAlone: [] } })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps } = makeDeps({ preview, init, isTty: true, readLine: async () => "y\n" });
    const code = await runInit({ reset: "researcher" }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(wrote).toBe(true);
  });

  it("an interactive 'N' leaves everything alone", async () => {
    let wrote = false;
    const init = (async () => ((wrote = true), { ok: true as const, value: EMPTY })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out } = makeDeps({ preview, init, isTty: true, readLine: async () => "\n" });
    const code = await runInit({ reset: "researcher" }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(wrote).toBe(false);
    expect(out()).toContain("left alone: nothing was changed");
  });

  it("an unknown reset name exits 2 and lists the valid names", async () => {
    const init = (async () => ({ ok: true as const, value: EMPTY })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, err } = makeDeps({ preview, init });
    const code = await runInit({ reset: "nope" }, deps);
    expect(code).toBe(EXIT.USAGE);
    expect(err()).toContain('unknown reset target "nope"');
    expect(err()).toContain("config, research, vibe");
  });
});

describe("runInit --update (§13.9.1)", () => {
  const plan = (over: Partial<{ files: unknown[]; missingAllowRules: string[] }> = {}) =>
    (async () => ({
      ok: true as const,
      value: { files: [], missingAllowRules: [], ...over },
    })) as unknown as NonNullable<InitDeps["previewUpdate"]>;

  const applied = (value: {
    updated: string[];
    leftAloneCustomized: { rel: string; resetName: string }[];
    added: string[];
  }) => (async () => ({ ok: true as const, value })) as unknown as NonNullable<InitDeps["applyUpdate"]>;

  it("refuses non-interactively without --yes and changes nothing (exit 2)", async () => {
    let applyCalled = false;
    const previewUpdate = plan({
      files: [{ rel: "agents/research/prompt.md", status: "stale", current: "old", def: "new" }],
    });
    const applyUpdate = (async () => ((applyCalled = true), { ok: true as const, value: { updated: [], leftAloneCustomized: [], added: [] } })) as unknown as NonNullable<InitDeps["applyUpdate"]>;
    const { deps, err } = makeDeps({ previewUpdate, applyUpdate, isTty: false });
    const code = await runInit({ update: true }, deps);
    expect(code).toBe(EXIT.USAGE);
    expect(applyCalled).toBe(false);
    expect(err()).toContain("refusing to update without confirmation");
  });

  it("--yes applies the batch and prints the grouped summary", async () => {
    const previewUpdate = plan({
      files: [{ rel: "agents/research/prompt.md", status: "stale", current: "old", def: "new" }],
      missingAllowRules: ["allow-read_file"],
    });
    const applyUpdate = applied({
      updated: ["agents/research/prompt.md"],
      leftAloneCustomized: [{ rel: "agents/vibe/prompt.md", resetName: "vibe" }],
      added: ["permissions:allow-read_file"],
    });
    const { deps, out } = makeDeps({ previewUpdate, applyUpdate });
    const code = await runInit({ update: true, yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(out()).toContain("updated: ~/.config/voidrift/agents/research/prompt.md (the old copy is kept under ~/.config/voidrift/backups/)");
    expect(out()).toContain("left alone (customized): ~/.config/voidrift/agents/vibe/prompt.md (reset with: voidrift init --reset vibe)");
    expect(out()).toContain("added: allow rule allow-read_file");
  });

  it("an interactive 'y' confirms the batch", async () => {
    let applyCalled = false;
    const previewUpdate = plan({ files: [{ rel: "skills/systems-thinking/SKILL.md", status: "stale", current: "o", def: "n" }] });
    const applyUpdate = (async () => ((applyCalled = true), { ok: true as const, value: { updated: ["skills/systems-thinking/SKILL.md"], leftAloneCustomized: [], added: [] } })) as unknown as NonNullable<InitDeps["applyUpdate"]>;
    const { deps } = makeDeps({ previewUpdate, applyUpdate, isTty: true, readLine: async () => "y\n" });
    const code = await runInit({ update: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(applyCalled).toBe(true);
  });

  it("nothing stale/missing and no customized → everything up to date", async () => {
    const previewUpdate = plan({});
    const { deps, out } = makeDeps({ previewUpdate });
    const code = await runInit({ update: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(out()).toContain("left alone: everything is up to date");
  });

  it("only customized files → lists them with the reset hint, no confirmation", async () => {
    const previewUpdate = plan({
      files: [{ rel: "agents/vibe/prompt.md", status: "customized", resetName: "vibe", current: "mine", def: "new" }],
    });
    const { deps, out } = makeDeps({ previewUpdate });
    const code = await runInit({ update: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(out()).toContain("left alone (customized): agents/vibe/prompt.md (reset with: voidrift init --reset vibe)");
  });
});

describe("runInit --sweep (§13.9.1)", () => {
  it("moves the matched files and prints the grouped summary (home shortened)", async () => {
    let passedDir: string | undefined = "UNSET";
    const sweep = (async (dir?: string) => {
      passedDir = dir;
      return {
        ok: true as const,
        value: {
          moved: ["/home/u/.config/voidrift/agents/vibe/agent.json.bak", "/work/project/.voidrift/skills/s/SKILL.md~"],
          backupSet: "/home/u/.config/voidrift/backups/20261020T000000000Z-000000",
        },
      };
    }) as unknown as NonNullable<InitDeps["sweep"]>;
    const { deps, out } = makeDeps({ sweep });
    const code = await runInit({ sweep: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    // The project dir (cwd) is passed because cwd is neither home nor config dir.
    expect(passedDir).toBe("/work/project");
    expect(out()).toContain("moved: ~/.config/voidrift/agents/vibe/agent.json.bak, /work/project/.voidrift/skills/s/SKILL.md~");
    expect(out()).toContain("into: ~/.config/voidrift/backups/");
  });

  it("nothing matched → a clean message and exit 0", async () => {
    const sweep = (async () => ({ ok: true as const, value: { moved: [], backupSet: null } })) as unknown as NonNullable<InitDeps["sweep"]>;
    const { deps, out } = makeDeps({ sweep });
    const code = await runInit({ sweep: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(out()).toContain("nothing to sweep");
  });

  it("skips the project dir when cwd IS the config dir", async () => {
    let passedDir: string | undefined = "UNSET";
    const sweep = (async (dir?: string) => ((passedDir = dir), { ok: true as const, value: { moved: [], backupSet: null } })) as unknown as NonNullable<InitDeps["sweep"]>;
    const { deps } = makeDeps({ sweep, cwd: "/home/u/.config/voidrift" });
    await runInit({ sweep: true }, deps);
    expect(passedDir).toBeUndefined();
  });
});

describe("runInit --migrate (§13.1/§13.9.1)", () => {
  it("prints the grouped migrated summary and the backup set (home shortened)", async () => {
    let passedDir: string | undefined = "UNSET";
    const migrate = (async (dir?: string) => {
      passedDir = dir;
      return {
        ok: true as const,
        value: {
          migrated: [{ file: "/home/u/.config/voidrift/config.json", renames: [{ from: "modelPrimary", to: "modelSelected" }] }],
          leftAlone: [],
          backupSet: "/home/u/.config/voidrift/backups/20261020T000000000Z-000000",
        },
      };
    }) as unknown as NonNullable<InitDeps["migrate"]>;
    const { deps, out } = makeDeps({ migrate });
    const code = await runInit({ migrate: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(passedDir).toBe("/work/project");
    expect(out()).toContain("migrated: ~/.config/voidrift/config.json (modelPrimary→modelSelected)");
    expect(out()).toContain("backed up to: ~/.config/voidrift/backups/");
  });

  it("no retired keys → a clean message and exit 0", async () => {
    const migrate = (async () => ({ ok: true as const, value: { migrated: [], leftAlone: ["/x/config.json"], backupSet: null } })) as unknown as NonNullable<InitDeps["migrate"]>;
    const { deps, out } = makeDeps({ migrate });
    const code = await runInit({ migrate: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(out()).toContain("no retired keys to migrate");
  });
});



describe("runInit — plain run with plugin discovery (§13.9.1)", () => {
  const mockDiscovery = (templates: { name: string }[] = []) =>
    (async () => ({
      ok: true as const,
      value: {
        templates: templates.map((t) => ({ name: t.name, agent: { role: "test" as const }, prompt: "test" })),
        plugins: templates.length > 0 ? ["test-plugin"] : [],
      },
    })) as unknown as NonNullable<InitDeps["discover"]>;

  const mockClassify = (templates: { name: string }[] = []) =>
    (async () => ({
      toCopy: templates.map((t) => ({ name: t.name, agent: { role: "test" as const }, prompt: "test" })),
      identical: [],
      kept: [],
    })) as unknown as NonNullable<InitDeps["classifyPluginAgents"]>;

  it("TTY with templates: asks and copies on 'y'; prints seeded and plugin name", async () => {
    const calls: { scope?: string; dir?: string; pluginAgents?: unknown }[] = [];
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      calls.push(opts);
      if (opts.scope === "project") {
        return {
          ok: true as const,
          value: {
            created: [],
            repaired: [],
            leftAlone: [],
            seeded: ["planner", "researcher"],
          },
        };
      }
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out, err } = makeDeps({
      init,
      discover: mockDiscovery([{ name: "planner" }, { name: "researcher" }]),
      classifyPluginAgents: mockClassify([{ name: "planner" }, { name: "researcher" }]),
      isTty: true,
      readLine: async () => "y\n",
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(err()).toContain("voidrift: loaded plugin test-plugin");
    expect(out()).toContain("seeded: planner, researcher");
    expect(calls[1]?.pluginAgents).toHaveLength(2);
  });



  it("non-TTY with --yes: copies templates; prints seeded and plugin name", async () => {
    let projectInitCalled = false;
    let projectInitWithTemplates = false;
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      if (opts.scope === "project") {
        projectInitCalled = true;
        if (opts.pluginAgents) {
          projectInitWithTemplates = true;
        }
        return {
          ok: true as const,
          value: {
            created: [],
            repaired: [],
            leftAlone: [],
            seeded: ["planner"],
          },
        };
      }
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out, err } = makeDeps({
      init,
      discover: mockDiscovery([{ name: "planner" }]),
      classifyPluginAgents: mockClassify([{ name: "planner" }]),
      isTty: false,
      // yes passed to runInit, not makeDeps
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(projectInitCalled).toBe(true);
    expect(projectInitWithTemplates).toBe(true);
    expect(err()).toContain("voidrift: loaded plugin test-plugin");
    expect(out()).toContain("seeded: planner");
  });

  it("second run with identical templates: prints no seeded (no-op)", async () => {
    const calls: { scope?: string; dir?: string; pluginAgents?: unknown }[] = [];
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      calls.push(opts);
      if (opts.scope === "project") {
        // Second run: seeded is absent (identical file, no-op)
        return {
          ok: true as const,
          value: {
            created: [],
            repaired: [],
            leftAlone: [],
          },
        };
      }
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out, err } = makeDeps({
      init,
      discover: mockDiscovery([{ name: "planner" }]),
      classifyPluginAgents: (async () => ({
        toCopy: [],
        identical: ["planner"],
        kept: [],
      })) as unknown as NonNullable<InitDeps["classifyPluginAgents"]>,
      isTty: false,
      // yes passed to runInit, not makeDeps
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(err()).toContain("voidrift: loaded plugin test-plugin");
    expect(out()).not.toContain("seeded:");
    expect(out()).not.toContain("kept:");
  });

  it("changed existing agent: prints kept with reason", async () => {
    const calls: { scope?: string; dir?: string; pluginAgents?: unknown }[] = [];
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      calls.push(opts);
      if (opts.scope === "project") {
        return {
          ok: true as const,
          value: {
            created: [],
            repaired: [],
            leftAlone: [],
            kept: [{ name: "planner", reason: "collision with a different existing agent" }],
          },
        };
      }
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const { deps, out, err } = makeDeps({
      init,
      discover: mockDiscovery([{ name: "planner" }]),
      classifyPluginAgents: (async () => ({
        toCopy: [],
        identical: [],
        kept: [{ name: "planner", reason: "collision with a different existing agent" }],
      })) as unknown as NonNullable<InitDeps["classifyPluginAgents"]>,
      isTty: false,
      // yes passed to runInit, not makeDeps
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(err()).toContain("voidrift: loaded plugin test-plugin");
    expect(out()).toContain("kept: planner (collision with a different existing agent)");
  });


  it("discovery failure: logs warning and continues without templates", async () => {
    const calls: { scope?: string; dir?: string; pluginAgents?: unknown }[] = [];
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      calls.push(opts);
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const discover = (async () => ({
      ok: false as const,
      error: { code: "INTERNAL" as const, message: "config error" },
    })) as unknown as NonNullable<InitDeps["discover"]>;
    const { deps, err, out } = makeDeps({
      init,
      discover,
      isTty: true,
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(err()).toContain("voidrift: warning: could not discover plugin agent templates");
    expect(out()).not.toContain("seeded:");
    expect(calls[1]?.pluginAgents).toBeUndefined();
  });

  it("discovery has warnings: prints each one to stderr", async () => {
    const calls: { scope?: string; dir?: string; pluginAgents?: unknown }[] = [];
    const init = (async (opts: { scope?: string; dir?: string; pluginAgents?: unknown } = {}) => {
      calls.push(opts);
      if (opts.scope === "project") {
        return {
          ok: true as const,
          value: {
            created: [],
            repaired: [],
            leftAlone: [],
            seeded: ["planner"],
          },
        };
      }
      return { ok: true as const, value: { created: [], repaired: [], leftAlone: [] } };
    }) as unknown as NonNullable<InitDeps["init"]>;
    const discover = (async () => ({
      ok: true as const,
      value: {
        templates: [{ name: "planner", agent: { role: "test" as const }, prompt: "test" }],
        plugins: ["test-plugin"],
        warnings: [{ plugin: "bad-plugin", error: "license rejected" }],
      },
    })) as unknown as NonNullable<InitDeps["discover"]>;
    const { deps, err, out } = makeDeps({
      init,
      discover,
      classifyPluginAgents: mockClassify([{ name: "planner" }]),
      isTty: false,
      // yes passed to runInit, not makeDeps
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(err()).toContain("voidrift: loaded plugin test-plugin");
    expect(err()).toContain("voidrift: warning: plugin bad-plugin: license rejected");
    expect(out()).toContain("seeded: planner");
  });

  // === DEFENSIVE ASSERTIONS: test boundary conditions ===
  it("no templates from discovery: doesn't ask or try to copy", async () => {
    let askWasWrong = false;
    const init = (async () => ({ ok: true as const, value: { created: [], repaired: [], leftAlone: [] } })) as unknown as NonNullable<InitDeps["init"]>;
    const { deps } = makeDeps({
      init,
      discover: mockDiscovery([]),
      isTty: true,
      readLine: async () => {
        askWasWrong = true;
        return "y\n";
      },
    });
    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(askWasWrong).toBe(false); // readLine was never called
  });
});
