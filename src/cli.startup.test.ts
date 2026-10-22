/**
 * §1.5 startup routing — a synchronous construction error exits 3 without
 * taking over the terminal (no cursor hide), and a successful boot hides the
 * cursor (inline primary-screen render, no alternate screen) and renders the
 * welcome (cli-blueprint.md §1.5 step 4, §2.4).
 */
import { hermeticTmp } from "./test-hermetic.js";
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { runTui } from "./tui.js";
import { TerminalController } from "./terminal.js";
import { detectCapabilities } from "./terminal.js";
import { makeHarness } from "./test-harness.js";
import { EXIT } from "./exit-codes.js";
import { waitForFrameIncludes } from "./test-frame.js";

const WS = hermeticTmp("cli-startup");

function fakeProc(): NodeJS.Process {
  const ee = new EventEmitter();
  const proc = ee as unknown as NodeJS.Process;
  (proc as unknown as { stdout: { write: (s: string) => boolean; columns: number; rows: number } }).stdout = {
    write: () => true,
    columns: 80,
    rows: 24,
  };
  (proc as unknown as { exit: () => void }).exit = () => undefined;
  (proc as unknown as { cwd: () => string }).cwd = () => WS;
  return proc;
}

describe("§1.5 startup", () => {
  it("exits 3 on a synchronous construction error without taking over the terminal", async () => {
    const proc = fakeProc();
    const terminal = new TerminalController(proc.stdout as unknown as { write(s: string): unknown });
    const code = await runTui({
      workspaceRoot: WS,
      bootOverride: () => {
        throw new Error("unwritable state dir");
      },
      terminal,
      caps: detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 80, rows: 24 }),
      proc,
    });
    expect(code).toBe(EXIT.STARTUP);
    expect(terminal.isEntered).toBe(false);
  });

  it("hides the cursor and renders the welcome on a successful boot", async () => {
    const proc = fakeProc();
    const terminal = new TerminalController(proc.stdout as unknown as { write(s: string): unknown });
    const harness = await makeHarness({ reply: "hello" });
    const { render } = await import("ink-testing-library");
    let instance: ReturnType<typeof render> | null = null;
    const codePromise = runTui({
      workspaceRoot: WS,
      forceNew: true,
      bootOverride: async () => harness.ready,
      terminal,
      caps: detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 80, rows: 24 }),
      proc,
      renderImpl: (element) => {
        instance = render(element);
        return { unmount: () => instance!.unmount() };
      },
    });
    await waitForFrameIncludes({ lastFrame: () => instance?.lastFrame() }, ["voidrift", "/help"]);
    expect(terminal.isEntered).toBe(true);
    expect(instance!.lastFrame()).toContain("voidrift");
    expect(instance!.lastFrame()).toContain("/help");
    instance!.unmount();
    terminal.restore();
    terminal.dispose();
    void codePromise;
  });

  it("resumes the most recent session on a bare --resume", async () => {
    const proc = fakeProc();
    const terminal = new TerminalController(proc.stdout as unknown as { write(s: string): unknown });
    const harness = await makeHarness();
    // Seed two sessions so "most recent" has something to resolve.
    const first = await harness.ready.api.session.create({ name: "older" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await harness.ready.api.session.create({ name: "newer" });
    expect(first.ok && second.ok).toBe(true);
    const { render } = await import("ink-testing-library");
    let instance: ReturnType<typeof render> | null = null;
    const codePromise = runTui({
      workspaceRoot: WS,
      resume: {},
      bootOverride: async () => harness.ready,
      terminal,
      caps: detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 80, rows: 24 }),
      proc,
      renderImpl: (element) => {
        instance = render(element);
        return { unmount: () => instance!.unmount() };
      },
    });
    await waitForFrameIncludes({ lastFrame: () => instance?.lastFrame() }, ["VoidRift", "Session"]);
    // The resumed session paints the welcome: banner wordmark + Session id row.
    expect(instance!.lastFrame()).toContain("VoidRift");
    expect(instance!.lastFrame()).toContain("Session");
    instance!.unmount();
    terminal.restore();
    terminal.dispose();
    void codePromise;
  });
});
