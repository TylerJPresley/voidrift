/**
 * §1.5 integration test — startup renders INLINE on the primary screen (no
 * alternate screen), hides the cursor, and guarantees a cursor restore on every
 * exit path (cli-blueprint.md §1.5, §4.10, §10.2). The construction-error →
 * exit-3 path is proven in cli.startup.test.ts via runTui's boot override.
 *
 * The CLI never enters the alternate screen, so native scrollback, the mouse
 * wheel/trackpad and text selection keep working; the restore hook only shows
 * the cursor again (ESC[?25h). No `?1049h`/`?1049l`, no `2J`/`3J` clear.
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { TerminalController } from "./terminal.js";

function sink(): { write: (s: string) => void; log: () => string } {
  let buf = "";
  return { write: (s: string) => (buf += s), log: () => buf };
}

describe("§1.5 inline primary-screen render and cursor", () => {
  it("enter only hides the cursor — never the alternate screen or a clear", () => {
    const s = sink();
    new TerminalController(s).enter();
    const log = s.log();
    expect(log).toContain("\x1b[?25l"); // cursor hide
    expect(log).not.toContain("\x1b[?1049h"); // no alternate screen
    expect(log).not.toContain("\x1b[2J"); // no full-screen clear
    expect(log).not.toContain("\x1b[3J"); // no scrollback erase
  });

  it("restore only shows the cursor — never leaves an alternate screen; idempotent", () => {
    const s = sink();
    const t = new TerminalController(s);
    t.enter();
    t.restore();
    t.restore(); // idempotent
    const log = s.log();
    expect(log).toContain("\x1b[?25h"); // cursor show
    expect(log).not.toContain("\x1b[?1049l"); // no alternate screen leave
    expect(log.match(/\x1b\[\?25h/g)!.length).toBe(1);
  });

  it("the restore hook shows the cursor on exit, SIGINT, and SIGTERM (every path)", () => {
    for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
      const s = sink();
      const t = new TerminalController(s);
      t.enter();
      const proc = new EventEmitter() as unknown as NodeJS.Process;
      (proc as unknown as { exit: (c?: number) => void }).exit = () => undefined;
      t.installRestoreHook(proc);
      (proc as unknown as EventEmitter).emit(signal);
      expect(t.isRestored).toBe(true);
      expect(s.log()).toContain("\x1b[?25h");
      expect(s.log()).not.toContain("\x1b[?1049l");
    }
  });

  it("the restore hook shows the cursor on an uncaught exception, then re-throws", () => {
    const s = sink();
    const t = new TerminalController(s);
    t.enter();
    const proc = new EventEmitter() as unknown as NodeJS.Process;
    (proc as unknown as { exit: (c?: number) => void }).exit = () => undefined;
    t.installRestoreHook(proc);
    let raised: unknown;
    try {
      (proc as unknown as EventEmitter).emit("uncaughtException", new Error("boom"));
    } catch (e) {
      raised = e;
    }
    expect(t.isRestored).toBe(true);
    expect(s.log()).toContain("\x1b[?25h");
    expect((raised as Error | undefined)?.message).toBe("boom");
  });

  it("hideCursor re-hides after an external editor returns", () => {
    const s = sink();
    const t = new TerminalController(s);
    t.enter();
    t.hideCursor();
    expect(s.log().match(/\x1b\[\?25l/g)!.length).toBe(2);
  });

  it("clearScreen emits ESC[2J ESC[H exactly once on a TTY, never ESC[3J", () => {
    const s = sink();
    const t = new TerminalController(s);
    t.clearScreen(true);
    t.clearScreen(true); // idempotent — only the first fires
    const log = s.log();
    expect(log.match(/\x1b\[2J\x1b\[H/g)!.length).toBe(1);
    expect(log).not.toContain("\x1b[3J"); // never a scrollback erase
  });

  it("clearScreen emits nothing on a non-TTY (headless / piped) run", () => {
    const s = sink();
    new TerminalController(s).clearScreen(false);
    expect(s.log()).toBe("");
  });

  it("enter alone never clears the screen (the clear is a separate startup step)", () => {
    const s = sink();
    new TerminalController(s).enter();
    expect(s.log()).not.toContain("\x1b[2J");
    expect(s.log()).not.toContain("\x1b[H");
  });
});
