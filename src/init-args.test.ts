/**
 * Argument-parsing tests for `voidrift init` flags: `--yes` is accepted with plain init,
 * `--reset` and `--update`, and rejected with `--sweep` and `--migrate` (cli §2.1).
 */
import { describe, it, expect } from "vitest";
import { parseArgs, helpText } from "./args.js";

describe("voidrift init — plugin-template copy (e2e, cli-blueprint.md §2.1)", () => {
  it("(a) parseArgs: plain init parses without --yes error", () => {
    const r = parseArgs(["init"]);
    expect(r.ok && r.mode.kind).toBe("init");
  });

  it("(b) parseArgs: init --yes is now valid (for plugin-template copy)", () => {
    const r = parseArgs(["init", "--yes"]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.mode.kind).toBe("init");
    if (r.ok && r.mode.kind === "init") {
      expect(r.mode.yes).toBe(true);
    }
  });

  it("(c) parseArgs: init --reset config --yes is valid", () => {
    const r = parseArgs(["init", "--reset", "config", "--yes"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode.kind === "init") {
      expect(r.mode.reset).toBe("config");
      expect(r.mode.yes).toBe(true);
    }
  });

  it("(d) parseArgs: init --update --yes is valid", () => {
    const r = parseArgs(["init", "--update", "--yes"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.mode.kind === "init") {
      expect(r.mode.update).toBe(true);
      expect(r.mode.yes).toBe(true);
    }
  });

  it("(e) parseArgs: init --sweep --yes is invalid (mutation guard)", () => {
    const r = parseArgs(["init", "--sweep", "--yes"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"--yes" is valid only');
  });

  it("(f) parseArgs: init --migrate --yes is invalid (mutation guard)", () => {
    const r = parseArgs(["init", "--migrate", "--yes"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"--yes" is valid only');
  });

  it("(g) help text includes plain `init --yes` description", () => {
    const text = helpText();
    expect(text).toContain("voidrift init --yes");
    expect(text).toContain("plugin-template");
  });

  it("(h) help text distinguishes --yes uses (plain init vs --reset vs --update)", () => {
    const text = helpText();
    // Each should be mentioned in the help
    expect(text).toMatch(/voidrift init\s+.*plugin.*template/);
    expect(text).toMatch(/voidrift init --yes\s+.*headless/);
    expect(text).toMatch(/voidrift init --reset.*--yes/);
    expect(text).toMatch(/voidrift init --update.*--yes/);
  });
});
