/**
 * §7.3 built-in slash-command catalog tests (cli-blueprint.md §7.3, §7.2, §3.3).
 * The CLI owns the built-in commands' descriptions; `mergeCommands` folds the
 * plugin command names from `session.listCommands()` in beside them.
 */
import { describe, it, expect } from "vitest";
import { BUILTIN_COMMANDS, mergeCommands } from "./commands-catalog.js";

describe("§7.3 built-in command catalog", () => {
  it("every §7.3 built-in carries a non-empty description", () => {
    expect(BUILTIN_COMMANDS.length).toBeGreaterThan(0);
    for (const c of BUILTIN_COMMANDS) {
      expect(c.name).toMatch(/^[a-z]+$/);
      expect(c.description.length).toBeGreaterThan(0);
    }
    // The commands the help panel relies on are present (§7.2).
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    for (const n of ["help", "sessions", "model", "agent", "tools", "diff", "quit", "undo", "redo", "goto"]) {
      expect(names).toContain(n);
    }
  });

  it("mergeCommands returns built-ins (with descriptions) even when no plugin command exists", () => {
    const merged = mergeCommands([]);
    const help = merged.find((c) => c.name === "help");
    expect(help?.description).toBe("Show the command list");
    expect(merged.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("folds a plugin command in, sorted, with an empty description when unknown", () => {
    const merged = mergeCommands(["deploy"]);
    const deploy = merged.find((c) => c.name === "deploy");
    expect(deploy).toEqual({ name: "deploy", description: "" });
    // de-duplicates a plugin name that collides with a built-in, keeping the
    // built-in's description.
    const dup = mergeCommands(["help"]);
    expect(dup.filter((c) => c.name === "help")).toHaveLength(1);
    expect(dup.find((c) => c.name === "help")?.description).toBe("Show the command list");
    // sorted alphabetically.
    const names = merged.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});
