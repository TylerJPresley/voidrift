/**
 * External editor compose unit tests (cli-blueprint.md §3.8). The sync and
 * detached spawn seams are injected so no real editor is ever executed — the
 * tests are deterministic and offline. A terminal editor's temp-file edit is
 * simulated by the injected `runSync` writing to the temp path.
 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolveEditor, composeInEditor, editFile, type EditorEnv } from "./editor.js";

describe("§3.8 editor resolution: apps.cli.editor → $VISUAL → $EDITOR", () => {
  it("prefers the configured apps.cli.editor command", () => {
    const r = resolveEditor("nano", { VISUAL: "vim", EDITOR: "vi" });
    expect(r).toEqual({ command: "nano", args: [], terminal: true });
  });
  it("falls back to $VISUAL then $EDITOR", () => {
    expect(resolveEditor(undefined, { VISUAL: "vim", EDITOR: "vi" })?.command).toBe("vim");
    expect(resolveEditor(undefined, { EDITOR: "vi" })?.command).toBe("vi");
  });
  it("classifies a GUI editor as non-terminal and keeps its flags as args", () => {
    const r = resolveEditor("code --wait", {});
    expect(r).toEqual({ command: "code", args: ["--wait"], terminal: false });
  });
  it("returns null when nothing is configured", () => {
    expect(resolveEditor(undefined, {})).toBeNull();
  });
});

describe("§3.8 compose in a terminal editor", () => {
  it("spawns with an arg array shell:false, suspends/restores Ink, re-hides the cursor, and returns the edit", async () => {
    const calls: { command: string; args: string[] }[] = [];
    let tempPath = "";
    const runSync = vi.fn((command: string, args: string[]) => {
      calls.push({ command, args });
      tempPath = args[args.length - 1]!;
      writeFileSync(tempPath, "edited in nano\n"); // the editor's write-back
    });
    const order: string[] = [];
    const ink = {
      suspend: () => order.push("suspend"),
      resume: () => order.push("resume"),
      hideCursor: () => order.push("hideCursor"),
    };
    const env: EditorEnv = {};
    const result = await composeInEditor("start", "nano", { env, runSync, ink });
    // Then — the editor ran once with [tempPath] and shell:false (seam).
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("nano");
    expect(calls[0]!.args).toHaveLength(1);
    // Then — Ink suspended, resumed, and the cursor re-hidden, in order.
    expect(order).toEqual(["suspend", "resume", "hideCursor"]);
    // Then — the edited buffer returns (trailing newline dropped).
    expect(result).toBe("edited in nano");
    // Then — the temp file is cleaned up.
    expect(existsSync(tempPath)).toBe(false);
  });
});

describe("§3.8 compose in a GUI editor", () => {
  it("spawns detached and returns the buffer unchanged", async () => {
    const detached: { command: string; args: string[] }[] = [];
    const runDetached = vi.fn((command: string, args: string[]) => {
      detached.push({ command, args });
    });
    const runSync = vi.fn();
    const result = await composeInEditor("keep", "code --wait", { env: {}, runSync, runDetached });
    expect(runSync).not.toHaveBeenCalled();
    expect(detached).toHaveLength(1);
    expect(detached[0]!.command).toBe("code");
    expect(detached[0]!.args[0]).toBe("--wait");
    expect(result).toBe("keep");
  });
});

describe("§3.8 no editor configured", () => {
  it("is a silent no-op returning the original buffer", async () => {
    const runSync = vi.fn();
    const result = await composeInEditor("unchanged", undefined, { env: {}, runSync });
    expect(runSync).not.toHaveBeenCalled();
    expect(result).toBe("unchanged");
  });
});

describe("§7.3 editFile — open an existing file (/config edit)", () => {
  it("opens a terminal editor on the given path, suspending/restoring Ink", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const runSync = vi.fn((command: string, args: string[]) => calls.push({ command, args }));
    const order: string[] = [];
    const ink = {
      suspend: () => order.push("suspend"),
      resume: () => order.push("resume"),
      hideCursor: () => order.push("hideCursor"),
    };
    const launched = await editFile("/proj/.voidrift/config.json", "nano", { env: {}, runSync, ink });
    expect(launched).toBe(true);
    expect(calls).toEqual([{ command: "nano", args: ["/proj/.voidrift/config.json"] }]);
    expect(order).toEqual(["suspend", "resume", "hideCursor"]);
  });

  it("spawns a GUI editor detached on the path", async () => {
    const detached: { command: string; args: string[] }[] = [];
    const runDetached = vi.fn((command: string, args: string[]) => detached.push({ command, args }));
    const launched = await editFile("/proj/.voidrift/config.json", "code --wait", { env: {}, runDetached });
    expect(launched).toBe(true);
    expect(detached).toEqual([{ command: "code", args: ["--wait", "/proj/.voidrift/config.json"] }]);
  });

  it("is a silent no-op returning false when no editor is configured", async () => {
    const runSync = vi.fn();
    const launched = await editFile("/x", undefined, { env: {}, runSync });
    expect(launched).toBe(false);
    expect(runSync).not.toHaveBeenCalled();
  });
});
