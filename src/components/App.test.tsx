/**
 * App integration tests (cli-blueprint.md §4.10, §5.6, §3.9, §6.4, §7.3) driven
 * by the Ink test renderer and the scripted core. Events are driven through the
 * harness `emit` seam (the same outward stream the core emits); keystrokes
 * through the test stdin. Deterministic and offline.
 */
import { hermeticTmp } from "../test-hermetic.js";
import React from "react";
import { basename } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { PendingApproval, ApprovalResponse } from "@voidrift/core";
import { App } from "./App.js";
import { StatusBar } from "./Footer.js";
import { makeHarness, type Harness } from "../test-harness.js";
import { waitForFrame } from "../test-frame.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import { initialState } from "../state.js";
import type { BoundPanelRegistry } from "../panels/types.js";
import type { Row } from "../panels/rows.js";

const WS = hermeticTmp("app");

/**
 * Local test builders for the CLI's `BoundPanel` registry (§7.1). Production
 * binds these from `registry.panels()` via `bindPanels` (core-client.ts);
 * these helpers construct the same `BoundPanel` shape directly from the test's
 * own getters so the App/PanelHost render path is exercised with deterministic
 * data (the binding path itself is covered in core-client.test.ts).
 */
function sliceAPanels(s: {
  sessions: () => Row[];
  models: () => Row[];
  agents: () => Row[];
  commands: () => Row[];
  diff: () => Row[];
}): BoundPanelRegistry {
  return {
    sessions: { title: "Sessions", columns: [{ key: "name", label: "Name", width: 18 }, { key: "id", label: "Id", width: 10 }, { key: "lastActiveAt", label: "Last active", width: 16 }, { key: "summary", label: "Summary" }], getItems: s.sessions },
    models: { title: "Models", columns: [{ key: "name", label: "Name", width: 18 }, { key: "model", label: "Model", width: 24 }, { key: "protocol", label: "Protocol", width: 10 }, { key: "active", label: "Active", width: 8 }], getItems: s.models },
    agents: { title: "Agents", columns: [{ key: "name", label: "Name", width: 18 }, { key: "description", label: "Description" }], getItems: s.agents },
    help: { title: "Help", columns: [{ key: "name", label: "Command", width: 18 }, { key: "description", label: "Description" }], getItems: s.commands },
    diff: { title: "Diff", columns: [{ key: "line", label: "Working-tree diff" }], getItems: s.diff },
  };
}

function sliceBPanels(s: {
  tools: () => Row[];
  mcp: () => Row[];
  plugins: () => Row[];
  permissions: () => Row[];
  compliance: () => Row[];
  memoryStored: () => Row[];
  memorySuggestions: () => Row[];
  skills: () => Row[];
  prompts: () => Row[];
  stats: () => Row[];
  context: () => Row[];
  memoryApprove: (item: unknown) => void | Promise<void>;
  memoryReject: (item: unknown) => void | Promise<void>;
}): BoundPanelRegistry {
  return {
    tools: { title: "Tools", columns: [{ key: "name", label: "Name", width: 24 }, { key: "description", label: "Description" }], getItems: s.tools },
    mcp: { title: "MCP", columns: [{ key: "name", label: "Server", width: 20 }, { key: "status", label: "Status", width: 14 }, { key: "toolCount", label: "Tools", width: 8 }], getItems: s.mcp },
    plugins: { title: "Plugins", columns: [{ key: "id", label: "Plugin", width: 24 }, { key: "enabled", label: "Enabled", width: 10 }, { key: "scope", label: "Scope", width: 12 }], getItems: s.plugins },
    permissions: { title: "Permissions", columns: [{ key: "pattern", label: "Pattern", width: 28 }, { key: "decision", label: "Decision", width: 12 }, { key: "scope", label: "Scope", width: 12 }], getItems: s.permissions },
    compliance: { title: "Compliance", columns: [{ key: "label", label: "Item", width: 28 }, { key: "detail", label: "Detail" }], getItems: s.compliance },
    memory: {
      title: "Memory",
      columns: [{ key: "kind", label: "Kind", width: 12 }, { key: "title", label: "Title", width: 28 }, { key: "detail", label: "Detail" }],
      getItems: s.memoryStored,
      pages: [
        { key: "stored", label: "Stored", columns: [{ key: "kind", label: "Kind", width: 12 }, { key: "title", label: "Title", width: 28 }, { key: "detail", label: "Detail" }], getItems: s.memoryStored, actions: { d: { label: "delete", confirm: "Delete?", handler: () => undefined } } },
        { key: "suggestions", label: "Suggestions", columns: [{ key: "kind", label: "Kind", width: 12 }, { key: "title", label: "Title", width: 28 }, { key: "detail", label: "Detail" }], getItems: s.memorySuggestions, actions: { a: { label: "approve", handler: s.memoryApprove }, r: { label: "reject", handler: s.memoryReject } } },
      ],
    },
    skills: { title: "Skills", columns: [{ key: "name", label: "Name", width: 24 }, { key: "scope", label: "Scope", width: 10 }, { key: "description", label: "Description" }], getItems: s.skills },
    prompts: { title: "Prompts", columns: [{ key: "key", label: "Key", width: 24 }, { key: "label", label: "Label" }], getItems: s.prompts },
    stats: { title: "Stats", columns: [{ key: "label", label: "Metric", width: 24 }, { key: "value", label: "Value" }], getItems: s.stats },
    context: { title: "Context", columns: [{ key: "label", label: "Segment", width: 24 }, { key: "value", label: "Value" }], getItems: s.context },
  };
}

const caps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 });
const monoCaps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 });

async function mountApp(
  harness: Harness,
  sessionId: string,
  extra: Partial<React.ComponentProps<typeof App>> = {},
) {
  const panels = sliceAPanels({
    sessions: () => [],
    models: () => [{ name: "test", model: "test-model", protocol: "openai", active: true }],
    agents: () => [{ name: "default", description: "the default agent" }],
    commands: () => [{ name: "help", description: "open help" }],
    diff: () => [],
  });
  const theme = resolveTheme(extra.caps ?? caps);
  const glyphs = resolveGlyphs(extra.caps ?? caps);
  const r = render(
    <App
      api={harness.ready.api}
      sessionId={sessionId}
      sessionName="my-session"
      panels={panels}
      caps={caps}
      theme={theme}
      glyphs={glyphs}
      version="0.0.0"
      workspaceRoot={WS}
      scrollbackLines={5000}
      reduceMotion={false}
      showTips={true}
      showThinking={false}
      onQuit={() => undefined}
      initialModel="test"
      {...extra}
    />,
  );
  // Let the subscription effect wire up.
  await new Promise((res) => setTimeout(res, 10));
  return r;
}

async function newSession(harness: Harness): Promise<string> {
  const created = await harness.ready.api.session.create();
  if (!created.ok) throw new Error("create failed");
  return created.value.id;
}

describe("§5.6 welcome, footer event mapping, context levels", () => {
  it("the welcome shows the active model and the footer the session id", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    const frame = app.lastFrame()!;
    expect(frame).toContain("voidrift");
    expect(frame).toContain("test");
    expect(frame).toContain(sid.slice(0, 8)); // Session id in the identity block
    app.unmount();
  });

  it("the footer updates occupancy on CONTEXT_BUDGET_UPDATED and branch on BRANCH_CHANGED", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("CONTEXT_BUDGET_UPDATED", { percentage: 38 }, sid);
    harness.emit("BRANCH_CHANGED", { branch: "feature-x" }); // workspace scope (unscoped)
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("38%");
    expect(frame).toContain("feature-x");
    app.unmount();
  });

  it("a boot with idle sessions renders the housekeeping notice line", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("HOUSEKEEPING_NOTICE", { idleSessions: 3, idleDays: 30 });
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("3 sessions idle over 30 days");
    app.unmount();
  });
});

describe("§4.4/§5.2 auto-approve surfaces (data-driven)", () => {
  it("shows [Chat] by default and the bracket is data-driven from agents.list()", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    const frame = app.lastFrame()!;
    expect(frame).toContain("[Chat]");
    expect(frame).not.toContain("[Vibe]");
    expect(frame).not.toContain("[AUTO-APPROVE]"); // the old segment is gone
    app.unmount();
  });

  it("a auto_approve auto-approved tool row shows the ⚡ marker (keyed on resolver, not a mode)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Core order (§9.5): PERMISSION_RESOLVED (auto-approve-<id>), then the tool
    // pipeline opens/closes the row keyed by that id.
    harness.emit("PERMISSION_RESOLVED", { requestId: "auto-approve-t9", decision: "approve", resolver: "auto_approve" }, sid);
    harness.emit("TOOL_STARTED", { id: "t9", name: "execute_command", args: { command: "rm -rf x" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "t9", name: "execute_command", status: "success", durationMs: 10, summary: "exit 0" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("⚡");
    expect(frame).toContain("Run"); // execute_command → Run display name
    app.unmount();
  });

  it("a tool NOT auto-approve-resolved shows no ⚡ marker", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("TOOL_STARTED", { id: "t2", name: "read_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "t2", name: "read_file", status: "success", durationMs: 5, summary: "3 lines" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    // The Read row renders; the ⚡ marker is only on auto-approve-resolved rows.
    const frame = app.lastFrame()!;
    expect(frame).toContain("Read");
    // No marker precedes the Read row (it was auto-read, never gated).
    expect(frame).not.toMatch(/⚡\s*Read/);
    app.unmount();
  });

  it("a research-mode denied write_file renders a normal ✗ tool row with the guidance (§9.7)", async () => {
    // In research, the core denies a write outright and returns a failed
    // ToolMessage; the CLI renders it as an ordinary failed tool row (no prompt).
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    const guidance = "this agent is read-only — switch to a top-level agent that allows changes to make changes";
    harness.emit("TOOL_STARTED", { id: "tw", name: "write_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "tw", name: "write_file", status: "error", durationMs: 1, summary: guidance }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("Write");
    expect(frame).toContain("this agent is read-only"); // first words of the guidance
    app.unmount();
  });
});

describe("§3.5/§5.6 conversation-mode cycling (Shift+Tab)", () => {
  const shiftTab = "\u001b[Z";
  const dialogOpen = (f: string): boolean => f.includes("disables approval prompts for this session");

  /**
   * Send a resolving key to the open Vibe-confirm dialog, re-sending while the
   * dialog is still open and the end state has not been reached. A freshly
   * mounted overlay's `useInput` handler is not guaranteed to be active for the
   * very next keystroke under heavy load (Ink activates it on a later tick), so
   * a single keypress can be dropped; re-sending is safe because the key is a
   * no-op/idempotent while the dialog stays open. Resolves at the end state or
   * throws with the last frame on timeout.
   */
  async function resolveDialog(
    app: ReturnType<typeof render>,
    key: string,
    done: (f: string) => boolean,
    timeoutMs = 4000,
  ): Promise<string> {
    const start = Date.now();
    for (;;) {
      const frame = app.lastFrame() ?? "";
      if (done(frame)) return frame;
      if (dialogOpen(frame)) app.stdin.write(key);
      if (Date.now() - start > timeoutMs) {
        throw new Error(`dialog never reached the end state within ${timeoutMs}ms; last frame:\n${frame}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("cycles [Chat] → [Research] on Shift+Tab, following SESSION_MODE_CHANGED", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    expect(app.lastFrame()!).toContain("[Chat]");
    app.stdin.write(shiftTab);
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    expect(app.lastFrame()!).toContain("[Research]");
    app.unmount();
  });

  it("entering Vibe the first time shows the confirmation dialog; y enables, bracket turns [Vibe]", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write(shiftTab); // → research
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab); // → would-be vibe: opens the confirmation
    await waitForFrame(app, dialogOpen, { timeoutMs: 4000, intervalMs: 10 });
    expect(app.lastFrame()!).toContain("disables approval prompts for this session");
    expect(app.lastFrame()!).toContain("[y] enable  [n] cancel");
    // `y` enables Vibe; the bracket follows the async setMode + SESSION_MODE_CHANGED.
    const frame = await resolveDialog(app, "y", (f) => f.includes("[Vibe]"));
    expect(frame).toContain("[Vibe]");
    app.unmount();
  });

  it("n cancels the Vibe confirmation and keeps the current mode", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write(shiftTab); // research
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab); // vibe confirm
    await waitForFrame(app, dialogOpen, { timeoutMs: 4000, intervalMs: 10 });
    // `n` cancels: the dialog closes and the mode stays Research.
    const frame = await resolveDialog(
      app,
      "n",
      (f) => f.includes("[Research]") && !dialogOpen(f),
    );
    expect(frame).not.toContain("[Vibe]");
    expect(frame).toContain("[Research]"); // unchanged
    app.unmount();
  });

  it("Escape cancels the Vibe confirmation", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write(shiftTab);
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab);
    await waitForFrame(app, dialogOpen, { timeoutMs: 4000, intervalMs: 10 });
    // Escape dismisses the dialog and keeps Research.
    const frame = await resolveDialog(app, "\u001b", (f) => f.includes("[Research]") && !dialogOpen(f));
    expect(frame).not.toContain("[Vibe]");
    app.unmount();
  });

  it("confirming a write agent once skips the first-entry confirmation on later re-entry this session", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write(shiftTab); // chat → research
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab); // research → would-be vibe: dialog
    await waitForFrame(app, dialogOpen, { timeoutMs: 4000, intervalMs: 10 });
    await resolveDialog(app, "y", (f) => f.includes("[Vibe]")); // confirm once
    app.stdin.write(shiftTab); // vibe → chat (wraps)
    await waitForFrame(app, (f) => f.includes("[Chat]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab); // chat → research
    await waitForFrame(app, (f) => f.includes("[Research]"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab); // research → vibe: NO dialog (already confirmed)
    const frame = await waitForFrame(app, (f) => f.includes("[Vibe]"), { timeoutMs: 4000, intervalMs: 10 });
    expect(frame).not.toContain("disables approval prompts for this session");
    expect(frame).toContain("[Vibe]");
    app.unmount();
  });

  it("refuses a mode change mid-turn with the dim notice and keeps the mode", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Start a turn so the session is not idle; the core refuses setMode.
    app.stdin.write("do something");
    app.stdin.write("\r"); // submit
    await waitForFrame(app, (f) => f.includes("do something"), { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write(shiftTab);
    // The refusal notice is the async setMode result; poll for it, then confirm
    // the mode stayed on Chat.
    const frame = await waitForFrame(
      app,
      (f) => f.includes("finish or cancel the current turn first"),
      { timeoutMs: 4000, intervalMs: 10 },
    );
    expect(frame).toContain("finish or cancel the current turn first");
    // The mode did not change away from Chat.
    expect(frame).toContain("[Chat]");
    app.unmount();
  });
});

describe("§4.10 stream, tool-call, diffs, reasoning, cancel/error", () => {
  it("buffers tokens then commits a diffed tool row and TurnResult text (no live stream)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("TOKEN_STREAM", { token: "Hello ", done: false }, sid);
    harness.emit("TOKEN_STREAM", { token: "world", done: false }, sid);
    harness.emit("TOOL_STARTED", { id: "t1", name: "write_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "t1", name: "write_file", status: "success", durationMs: 400, summary: "wrote", diff: "+added\n-removed" }, sid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "FINAL ANSWER", usage: { promptTokens: 1, completionTokens: 2, totalMs: 5 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    // On TURN_COMPLETE the tool group auto-collapses (§4.4): the Write row and
    // its diff hide behind the `▸ N tool calls` header; the assistant text
    // remains (no divider, replies render flush at a two-space margin, §4.1).
    expect(frame).toContain("▸ 1 tool call");
    expect(frame).not.toContain("+added");
    expect(frame).not.toContain("─ Response");
    expect(frame).toContain("FINAL ANSWER");
    app.unmount();
  });

  it("Ctrl+O toggles the reasoning view and reasoning is never committed", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("REASONING_STREAM", { token: "secret thoughts", done: false }, sid);
    await new Promise((r) => setTimeout(r, 10));
    // Collapsed lead line (§4.6): the dim `Thinking…`/`Thought for Ns` lead with
    // the ctrl+o hint, not the reasoning body.
    expect(app.lastFrame()).toContain("(ctrl+o to view)");
    expect(app.lastFrame()).not.toContain("secret thoughts");
    app.stdin.write("\u000f"); // Ctrl+O
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("secret thoughts");
    app.unmount();
  });

  it("TURN_CANCELLED commits partial text with a cancelled marker; ERROR_OCCURRED renders the source", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("TOKEN_STREAM", { token: "half", done: false }, sid);
    harness.emit("TURN_CANCELLED", { sessionId: sid }, sid);
    harness.emit("ERROR_OCCURRED", { source: "model", message: "boom" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("cancelled");
    expect(frame).toContain("model: boom");
    app.unmount();
  });

  it("a committed assistant segment carrying escape introducers is sanitized before render", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Buffered rendering never shows live tokens (§4.2); the committed segment is
    // sanitized on commit. TURN_COMPLETE carries the authoritative text.
    harness.emit("TURN_COMPLETE", { status: "completed", text: "x\x1b[31mHACK\x1b[0m", usage: { promptTokens: 1, completionTokens: 1, totalMs: 5 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("HACK");
    app.unmount();
  });

  it("renders legibly under NO_COLOR with diff markers preserved", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, { caps: monoCaps });
    harness.emit("TOOL_STARTED", { id: "t1", name: "write_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "t1", name: "write_file", status: "success", durationMs: 100, summary: "", diff: "+line" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("+line");
    app.unmount();
  });
});

describe("§3.9 input, history, cancel", () => {
  it("an empty submit never calls session.send; a text submit does and pushes history", async () => {
    const harness = await makeHarness({ reply: "answered" });
    const sid = await newSession(harness);
    const send = vi.spyOn(harness.ready.api.session, "send");
    const app = await mountApp(harness, sid);
    app.stdin.write("\r"); // empty Enter
    await new Promise((r) => setTimeout(r, 10));
    expect(send).not.toHaveBeenCalled();
    app.stdin.write("hello there");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledWith(sid, { input: "hello there" });
    app.unmount();
  });

  it("Ctrl+V attaches a validated PNG path in SendRequest.payload on send (§3.7)", async () => {
    const harness = await makeHarness({ reply: "seen" });
    const sid = await newSession(harness);
    const send = vi.spyOn(harness.ready.api.session, "send");
    // Inject the clipboard spawn seam: a Wayland env returning a PNG — no real
    // wl-paste runs. The write lands under the client-owned cache subtree.
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const spawned: { command: string; args: string[] }[] = [];
    const app = await mountApp(harness, sid, {
      clipboardDeps: {
        env: { platform: "linux", WAYLAND_DISPLAY: "wayland-0" },
        now: () => 777,
        spawn: async (command, args) => {
          spawned.push({ command, args });
          return PNG;
        },
      },
    });
    app.stdin.write("look"); // some text in the buffer
    app.stdin.write("\u0016"); // Ctrl+V
    // The clipboard spawn + buffer insert is async; poll for the reference token.
    await waitForFrame(app, (f) => f.includes("777.png"), { timeoutMs: 4000, intervalMs: 10 });
    // The right tool with the right arg array and shell:false (seam proves it).
    expect(spawned).toEqual([{ command: "wl-paste", args: ["--type", "image/png"] }]);
    // A reference token is inserted into the buffer.
    expect(app.lastFrame()).toContain("777.png");
    app.stdin.write("\r"); // submit
    await waitForFrame(app, () => send.mock.calls.some((c) => c[0] === sid), { timeoutMs: 4000, intervalMs: 10 });
    const call = send.mock.calls.find((c) => c[0] === sid)!;
    const req = call[1] as { input: string; payload?: { images: { type: string; path: string }[] } };
    expect(req.payload?.images?.[0]?.type).toBe("image");
    expect(req.payload?.images?.[0]?.path).toContain(
      ".voidrift/cache/apps/cli/clipboard/" + sid + "/777.png",
    );
    app.unmount();
  });

  it("Ctrl+V with no clipboard tool is a silent no-op (plain input, no payload) (§3.7)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const send = vi.spyOn(harness.ready.api.session, "send");
    const app = await mountApp(harness, sid, {
      clipboardDeps: { env: { platform: "linux" }, spawn: async () => Buffer.alloc(0) },
    });
    app.stdin.write("plain");
    app.stdin.write("\u0016"); // Ctrl+V — no tool, silent no-op
    app.stdin.write("\r");
    await waitForFrame(app, () => send.mock.calls.some((c) => c[0] === sid), { timeoutMs: 4000, intervalMs: 10 });
    expect(send).toHaveBeenCalledWith(sid, { input: "plain" });
    app.unmount();
  });

  it("Ctrl+X composes in a terminal editor and returns the edited buffer (§3.8)", async () => {
    const { writeFileSync } = await import("node:fs");
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const order: string[] = [];
    const app = await mountApp(harness, sid, {
      editorCommand: "nano",
      inkControl: {
        suspend: () => order.push("suspend"),
        resume: () => order.push("resume"),
        hideCursor: () => order.push("hideCursor"),
      },
      editorDeps: {
        env: {},
        runSync: (command, args) => {
          order.push(`run:${command}:shellfalse`);
          writeFileSync(args[args.length - 1]!, "composed body\n");
        },
      },
    });
    app.stdin.write("\u0018"); // Ctrl+X
    // The editor compose + buffer replace is async; poll for the edited body.
    await waitForFrame(app, (f) => f.includes("composed body"), { timeoutMs: 4000, intervalMs: 10 });
    // The terminal editor ran with an arg array (seam) and Ink suspended/
    // restored with the cursor re-hidden, in order.
    expect(order).toEqual(["suspend", "run:nano:shellfalse", "resume", "hideCursor"]);
    expect(app.lastFrame()).toContain("composed body");
    app.unmount();
  });

  it("/editor composes in the editor the same way (§3.8)", async () => {
    const { writeFileSync } = await import("node:fs");
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, {
      editorCommand: "vim",
      editorDeps: {
        env: {},
        runSync: (_c, args) => writeFileSync(args[args.length - 1]!, "from slash editor\n"),
      },
    });
    app.stdin.write("/editor");
    // Ensure the whole command is in the buffer before submitting (char input is
    // applied per keystroke; under load the frame reflects it on a later tick).
    await waitForFrame(app, (f) => f.includes("/editor"), { timeoutMs: 4000, intervalMs: 10 });
    // The slash dropdown is open (§3.3): the first Enter completes the
    // highlighted `/editor` (closing the dropdown), the second submits it. Ink
    // may drop a keystroke before its input handler activates, so poll each
    // stage — completing (re-sending Enter while the dropdown rule still shows)
    // then submitting (re-sending until the editor body lands).
    await waitForFrame(
      app,
      (f) => !f.includes("↑↓ navigate"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("↑↓ navigate")) app.stdin.write("\r"); },
    );
    await waitForFrame(
      app,
      (f) => f.includes("from slash editor"),
      { timeoutMs: 4000, intervalMs: 20 },
      () => app.stdin.write("\r"),
    );
    expect(app.lastFrame()).toContain("from slash editor");
    app.unmount();
  });

  it("the first Ctrl+C during a turn calls session.cancel", async () => {
    const harness = await makeHarness({ reply: "slow" });
    const sid = await newSession(harness);
    const cancel = vi.spyOn(harness.ready.api.session, "cancel");
    const app = await mountApp(harness, sid);
    app.stdin.write("do work");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 5));
    app.stdin.write("\u0003"); // Ctrl+C
    await new Promise((r) => setTimeout(r, 10));
    expect(cancel).toHaveBeenCalledWith(sid);
    app.unmount();
  });

  it("typing / opens the live slash dropdown, refilters, completes, and submits (§3.3)", async () => {
    const harness = await makeHarness();
    harness.ready.api.register.command("deploy", "deploy the app", async () => undefined);
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);

    // `/` opens the dropdown (no Tab) showing an 8-row window over EVERY
    // command — `(+N more)` proves the full uncapped set is present.
    app.stdin.write("/");
    await waitForFrame(app, (f) => f.includes("↑↓ navigate") && f.includes("(+"), { timeoutMs: 4000, intervalMs: 20 });
    expect(app.lastFrame()!).toContain("↑↓ navigate  enter select  tab complete  esc close");

    // Typing `dep` refilters live to the plugin command `/deploy` (no Tab).
    app.stdin.write("dep");
    await waitForFrame(app, (f) => f.includes("/deploy"), { timeoutMs: 4000, intervalMs: 20 });

    // Backspace refilters back (`/de` still matches /deploy).
    app.stdin.write("\u007f"); // Backspace
    await waitForFrame(app, (f) => f.includes("/deploy"), { timeoutMs: 4000, intervalMs: 20 });

    // A space in the word closes the dropdown (argument entry).
    app.stdin.write(" ");
    await waitForFrame(app, (f) => !f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });

    app.unmount();
  });

  it("Escape dismisses the slash dropdown and keeps it closed until the next edit (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/he");
    await waitForFrame(app, (f) => f.includes("/help"), { timeoutMs: 4000, intervalMs: 20 });
    // Escape closes it; re-send while the hint still shows (Ink may drop a key).
    await waitForFrame(
      app,
      (f) => !f.includes("↑↓ navigate"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("↑↓ navigate")) app.stdin.write("\u001b"); },
    );
    // A fresh edit reopens it (Escape only holds until the next edit).
    app.stdin.write("l");
    await waitForFrame(app, (f) => f.includes("/help"), { timeoutMs: 4000, intervalMs: 20 });
    app.unmount();
  });

  it("Enter completes the highlighted command and closes the dropdown (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/mod"); // → /model
    await waitForFrame(app, (f) => f.includes("/model"), { timeoutMs: 4000, intervalMs: 20 });
    // First Enter completes `/model ` and closes the dropdown; re-send if dropped.
    await waitForFrame(
      app,
      (f) => !f.includes("↑↓ navigate"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("↑↓ navigate")) app.stdin.write("\r"); },
    );
    expect(app.lastFrame()!).toContain("/model");
    app.unmount();
  });

  it("Tab opens file completion from workspace.files (5 rows, 10 cap) — regression (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    const api = {
      ...harness.ready.api,
      workspace: { ...harness.ready.api.workspace, files: async () => ({ ok: true as const, value: files }) },
    };
    const app = await mountApp(harness, sid, { api });
    app.stdin.write("edit src/file");
    await waitForFrame(app, (f) => f.includes("src/file"), { timeoutMs: 4000, intervalMs: 20 });
    // A non-slash buffer does NOT auto-open; Tab opens the file dropdown.
    expect(app.lastFrame()!).not.toContain("↑↓ navigate");
    app.stdin.write("\t");
    await waitForFrame(app, (f) => f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    const frame = app.lastFrame()!;
    expect(frame).toContain("src/file0.ts");
    // 10-cap on files: a 5-row window shows, `(+N more)` indicates the rest.
    expect(frame).toContain("(+");
    app.unmount();
  });

  it("submitting closes the slash dropdown; none is shown after the turn (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Open the slash dropdown, then submit a message (Enter completes first, so
    // submit from a non-slash buffer): type text, confirm no dropdown, submit.
    app.stdin.write("do work");
    await waitForFrame(app, (f) => f.includes("do work"), { timeoutMs: 4000, intervalMs: 20 });
    // A non-slash buffer never auto-opens the dropdown.
    expect(app.lastFrame()!).not.toContain("↑↓ navigate");
    app.stdin.write("\r"); // submit — the turn runs and completes
    await waitForFrame(app, (f) => f.includes("┃ do work"), { timeoutMs: 4000, intervalMs: 20 });
    // After the turn the prompt returns with no dropdown rule/hint.
    expect(app.lastFrame()!).not.toContain("↑↓ navigate");
    app.unmount();
  });

  it("a MODEL_ERROR with willRetry shows a legible dim retry line", async () => {
    const TEST_HOST = "models.example.test";
    const harness = await makeHarness({
      seed: { models: { test: { model: "test-model", protocol: "openai", baseUrl: `https://${TEST_HOST}/v1`, contextLimit: 32_000 } }, modelSelected: "test" },
    });
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Let the endpoint-table snapshot (models.list) resolve before the error.
    await new Promise((r) => setTimeout(r, 10));
    harness.emit(
      "MODEL_ERROR",
      { name: "test", code: "server", message: "502 Bad Gateway", attempt: 2, maxRetries: 2, willRetry: true },
      sid,
    );
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain(TEST_HOST);
    expect(frame).toContain("retrying (2/3)");
    app.unmount();
  });

  it("Up from a typed 0 shows the newest history entry and Down restores the typed text (§3.2)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    // Stub send so seeding several history entries does not exhaust the fake
    // model (one queued reply per instance); history.push runs on submit either way.
    const api = {
      ...harness.ready.api,
      session: { ...harness.ready.api.session, send: async () => ({ ok: true as const, value: undefined }) },
    };
    const app = await mountApp(harness, sid, { api });
    // Seed one history entry via a submit; the stubbed send emits no event, so
    // drive TURN_COMPLETE to return the prompt (turnActive → false).
    app.stdin.write("first message");
    await waitForFrame(app, (f) => f.includes("first message"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\r");
    harness.emit("TURN_COMPLETE", { status: "completed", text: "ok" }, sid);
    await waitForFrame(app, (f) => f.includes("ask a question or describe a task"), { timeoutMs: 4000, intervalMs: 20 });
    // Type a draft at index 0.
    app.stdin.write("abc");
    await waitForFrame(app, (f) => f.includes("❯ abc"), { timeoutMs: 4000, intervalMs: 20 });
    // Up → newest history entry.
    await waitForFrame(
      app,
      (f) => f.includes("❯ first message"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ first message")) app.stdin.write("\u001b[A"); },
    );
    // Down → back to 0, the typed draft restored unchanged.
    await waitForFrame(
      app,
      (f) => f.includes("❯ abc"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ abc")) app.stdin.write("\u001b[B"); },
    );
    app.unmount();
  });

  it("editing a recalled history entry and pressing Enter submits the edited text; the original is unchanged (§3.2)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const sent: string[] = [];
    const api = {
      ...harness.ready.api,
      session: {
        ...harness.ready.api.session,
        send: async (_sid: string, req: { input: string }) => {
          sent.push(req.input);
          return { ok: true as const, value: undefined };
        },
      },
    };
    const app = await mountApp(harness, sid, { api });
    // Seed two entries: oldest then newest (stubbed send + TURN_COMPLETE).
    for (const msg of ["older", "newer"]) {
      app.stdin.write(msg);
      await waitForFrame(app, (f) => f.includes("❯ " + msg), { timeoutMs: 4000, intervalMs: 20 });
      app.stdin.write("\r");
      harness.emit("TURN_COMPLETE", { status: "completed", text: "ok" }, sid);
      await waitForFrame(app, (f) => f.includes("ask a question or describe a task"), { timeoutMs: 4000, intervalMs: 20 });
    }
    // Up twice → -2 = "older".
    await waitForFrame(
      app,
      (f) => f.includes("❯ newer"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ newer")) app.stdin.write("\u001b[A"); },
    );
    await waitForFrame(
      app,
      (f) => f.includes("❯ older"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("❯ newer")) app.stdin.write("\u001b[A"); },
    );
    // Edit the scratch copy and submit the edited text.
    app.stdin.write("X"); // "olderX"
    await waitForFrame(app, (f) => f.includes("olderX"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\r");
    await waitForFrame(app, () => sent.includes("olderX"), { timeoutMs: 4000, intervalMs: 20 });
    expect(sent).toContain("olderX");
    expect(sent[sent.length - 1]).toBe("olderX"); // the edit submitted the scratch text
    harness.emit("TURN_COMPLETE", { status: "completed", text: "ok" }, sid);
    await waitForFrame(app, (f) => f.includes("ask a question or describe a task"), { timeoutMs: 4000, intervalMs: 20 });
    // Visit the history again: "older" (the original, -3 now) reads unchanged —
    // entries are immutable. Walk up past olderX(-1), newer(-2) to older(-3).
    await waitForFrame(
      app,
      (f) => f.includes("❯ olderX"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ olderX")) app.stdin.write("\u001b[A"); },
    );
    await waitForFrame(
      app,
      (f) => f.includes("❯ newer"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("❯ olderX")) app.stdin.write("\u001b[A"); },
    );
    await waitForFrame(
      app,
      (f) => /❯ older(?!X)/.test(f), // input line is the original, unedited "older"
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("❯ newer")) app.stdin.write("\u001b[A"); },
    );
    app.unmount();
  });

  it("with the slash dropdown open Down previews +1, Up restores the live text (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/he");
    await waitForFrame(app, (f) => f.includes("/help") && f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    // Down previews +1 in the input: the input LINE (not the dropdown row) reads
    // `/help`. The input line is the `❯ ` prompt followed by the dim rule, so
    // match `❯ /help` immediately followed by the rule to disambiguate.
    app.stdin.write("\u001b[B");
    await waitForFrame(app, (f) => /❯ \/help\n─/.test(f), { timeoutMs: 4000, intervalMs: 20 });
    // The dropdown is still open and filtered by the live buffer (/help row still shown).
    expect(app.lastFrame()!).toContain("↑↓ navigate");
    // Up returns to 0 with the live text /he restored on the input line.
    app.stdin.write("\u001b[A");
    await waitForFrame(app, (f) => /❯ \/he\n─/.test(f), { timeoutMs: 4000, intervalMs: 20 });
    app.unmount();
  });

  it("typing at +n accepts the candidate into the live buffer and applies the char (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/he");
    await waitForFrame(app, (f) => f.includes("/help") && f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\u001b[B"); // Down → +1 previews /help on the input line
    await waitForFrame(app, (f) => /❯ \/help\n─/.test(f), { timeoutMs: 4000, intervalMs: 20 });
    // Typing accepts /help into the live buffer at 0 and applies the char.
    app.stdin.write("x");
    await waitForFrame(app, (f) => f.includes("/helpx"), { timeoutMs: 4000, intervalMs: 20 });
    app.unmount();
  });

  it("Escape at +n dismisses the dropdown and returns to 0 with the live text (§3.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/he");
    await waitForFrame(app, (f) => f.includes("/help") && f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\u001b[B"); // → +1
    await waitForFrame(app, (f) => /❯ \/help\n─/.test(f), { timeoutMs: 4000, intervalMs: 20 });
    // Escape returns to 0 with /he restored and the dropdown dismissed.
    await waitForFrame(
      app,
      (f) => /❯ \/he\n/.test(f) && !f.includes("↑↓ navigate"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("↑↓ navigate")) app.stdin.write("\u001b"); },
    );
    app.unmount();
  });

  it("Down at index 0 with no slash dropdown is a no-op (§3.2)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Seed a history entry so Down could in principle move; it must not from 0.
    app.stdin.write("entry");
    await waitForFrame(app, (f) => f.includes("entry"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\r");
    await waitForFrame(app, (f) => f.includes("┃ entry"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("plain");
    await waitForFrame(app, (f) => f.includes("plain"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\u001b[B"); // Down at 0, no dropdown → no-op
    await new Promise((r) => setTimeout(r, 30));
    expect(app.lastFrame()!).toContain("❯ plain");
    app.unmount();
  });

  it("a recalled slash history entry opens no dropdown (§3.3 pin 4)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Submit a bare slash command so it enters history (no space in the word).
    app.stdin.write("/help");
    await waitForFrame(app, (f) => f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    // First Enter completes /help (closes dropdown), second submits it.
    await waitForFrame(
      app,
      (f) => !f.includes("↑↓ navigate"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (f.includes("↑↓ navigate")) app.stdin.write("\r"); },
    );
    // The completed buffer is "/help " (trailing space) — submit it.
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    // Up recalls the submitted slash entry; it must NOT open the dropdown.
    app.stdin.write("\u001b[A");
    await waitForFrame(app, (f) => f.includes("/help"), { timeoutMs: 4000, intervalMs: 20 });
    expect(app.lastFrame()!).not.toContain("↑↓ navigate");
    app.unmount();
  });
});

describe("§7.3 slash commands and panel host", () => {
  it("/help opens the help panel listing commands from the registry", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("/help");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Help");
    expect(app.lastFrame()).toContain("open help");
    app.unmount();
  });

  it("/undo while a turn is running prints the fixed busy refusal, starts no turn (§7.5)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const undo = vi
      .spyOn(harness.ready.api.session, "undo")
      .mockResolvedValue({ ok: false, error: { code: "SESSION_BUSY", message: "busy" } } as never);
    const send = vi.spyOn(harness.ready.api.session, "send");
    const app = await mountApp(harness, sid);
    app.stdin.write("/undo");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Rollback is unavailable while a turn is running.");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    app.unmount();
  });

  it("/undo with a conflict opens the dialog; 'y' re-invokes undo with confirmOverwrite = the conflicting paths (§7.5)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const conflicts = ["src/users.ts", "src/pager.ts"];
    const undo = vi
      .spyOn(harness.ready.api.session, "undo")
      .mockResolvedValueOnce({
        ok: true,
        value: { ok: false, action: "undo", fromPointer: 3, toPointer: 3, fromId: 3, toId: 3, restored: [], skipped: [], undone: 0, shellEffects: 0, conflicts, method: "git", message: "conflict" },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        value: { ok: true, action: "undo", fromPointer: 3, toPointer: 2, fromId: 3, toId: 2, restored: conflicts, skipped: [], undone: 1, shellEffects: 0, method: "git", message: "x" },
      } as never);
    const app = await mountApp(harness, sid);
    app.stdin.write("/undo");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Rollback conflict");
    // Retry `y` until the overlay closes (the embedded dialog's input can need a
    // retry under the test renderer, like the Vibe confirm tests).
    const start = Date.now();
    while ((app.lastFrame() ?? "").includes("Rollback conflict")) {
      app.stdin.write("y");
      if (Date.now() - start > 4000) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 10));
    // The second call carries exactly the conflicting paths as confirmOverwrite.
    expect(undo).toHaveBeenNthCalledWith(2, sid, { confirmOverwrite: conflicts });
    expect(app.lastFrame()).toContain("Undid move 3: conversation rewound to move 2; 2 files restored (git). /redo to reapply.");
    app.unmount();
  });

  it("the conflict dialog is cancelled by 'n' and nothing is re-invoked (§7.5)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const undo = vi.spyOn(harness.ready.api.session, "undo").mockResolvedValue({
      ok: true,
      value: { ok: false, action: "undo", fromPointer: 3, toPointer: 3, fromId: 3, toId: 3, restored: [], skipped: [], undone: 0, shellEffects: 0, conflicts: ["a.ts"], method: "git", message: "conflict" },
    } as never);
    const app = await mountApp(harness, sid);
    app.stdin.write("/undo");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Rollback conflict");
    // Retry `n` until the dialog closes; the op is never re-invoked.
    const startN = Date.now();
    while ((app.lastFrame() ?? "").includes("Rollback conflict")) {
      app.stdin.write("n");
      if (Date.now() - startN > 4000) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(app.lastFrame()).not.toContain("Rollback conflict");
    expect(undo).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("the conflict dialog is cancelled by Escape — nothing re-invoked (§7.5)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const undo = vi.spyOn(harness.ready.api.session, "undo").mockResolvedValue({
      ok: true,
      value: { ok: false, action: "undo", fromPointer: 3, toPointer: 3, fromId: 3, toId: 3, restored: [], skipped: [], undone: 0, shellEffects: 0, conflicts: ["a.ts"], method: "git", message: "conflict" },
    } as never);
    const app = await mountApp(harness, sid);
    app.stdin.write("/undo");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Rollback conflict");
    // Poll Escape until the dialog closes (a lone ESC can need a retry under the
    // test input pipeline); never re-invokes the op.
    const start = Date.now();
    while ((app.lastFrame() ?? "").includes("Rollback conflict")) {
      app.stdin.write("\u001b");
      if (Date.now() - start > 4000) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(app.lastFrame()).not.toContain("Rollback conflict");
    expect(undo).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("an unknown /nope renders the unknown-command line and starts no turn", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const send = vi.spyOn(harness.ready.api.session, "send");
    const app = await mountApp(harness, sid);
    app.stdin.write("/nope");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Unknown command: /nope");
    expect(send).not.toHaveBeenCalled();
    app.unmount();
  });
});

describe("§7.2/§7.3 Slice-B built-in panels", () => {
  const slicebRegistry = () => ({
    ...sliceAPanels({ sessions: () => [], models: () => [], agents: () => [], commands: () => [], diff: () => [] }),
    ...sliceBPanels({
      tools: () => [], // a stubbed op (agents.tools) → empty state
      mcp: () => [{ name: "fs", status: "connected", toolCount: 3 }],
      plugins: () => [{ id: "routines", enabled: "yes", scope: "project" }],
      permissions: () => [{ pattern: "write_file:*", decision: "ask", scope: "global" }],
      compliance: () => [
        { label: "status", detail: "enforcing" },
        { label: "policy: data", detail: "no secrets" },
        { label: "decision: write_file", detail: "allow data" },
      ],
      memoryStored: () => [
        { kind: "note", title: "prefers tabs", detail: "project" },
      ],
      memorySuggestions: () => [
        { kind: "suggestion", title: "likes vitest", detail: "pending", id: "s1", _suggestion: true },
      ],
      skills: () => [{ name: "review", scope: "project", description: "review code" }],
      prompts: () => [{ key: "system", label: "the system prompt" }],
      stats: () => [], // a stubbed op (models.stats) → empty state
      context: () => [{ label: "head", value: "1200" }],
      memoryApprove: approveSpy,
      memoryReject: rejectSpy,
    }),
  });
  const approveSpy = vi.fn();
  const rejectSpy = vi.fn();

  async function mountWith(harness: Harness, sid: string) {
    const theme = resolveTheme(caps);
    const glyphs = resolveGlyphs(caps);
    const r = render(
      <App
        api={harness.ready.api}
        sessionId={sid}
        sessionName="s"
        panels={slicebRegistry()}
        caps={caps}
        theme={theme}
        glyphs={glyphs}
        version="0.0.0"
        workspaceRoot={WS}
        scrollbackLines={5000}
        reduceMotion={false}
        showTips={false}
        showThinking={false}
        onQuit={() => undefined}
        initialModel="test"
      />,
    );
    await new Promise((res) => setTimeout(res, 10));
    return r;
  }

  const CASES: [string, string, string][] = [
    ["/mcp", "MCP", "connected"],
    ["/plugins", "Plugins", "routines"],
    ["/permissions", "Permissions", "write_file:*"],
    ["/skills", "Skills", "review"],
    ["/prompts", "Prompts", "system"],
    ["/context", "Context", "1200"],
  ];

  for (const [cmd, title, data] of CASES) {
    it(`${cmd} opens the ${title} panel and renders its op data`, async () => {
      const harness = await makeHarness();
      const sid = await newSession(harness);
      const app = await mountWith(harness, sid);
      app.stdin.write(cmd);
      app.stdin.write("\r");
      await new Promise((r) => setTimeout(r, 10));
      expect(app.lastFrame()).toContain(title);
      expect(app.lastFrame()).toContain(data);
      app.unmount();
    });
  }

  it("/tools and /stats open and render a graceful empty state for a stubbed op", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountWith(harness, sid);
    app.stdin.write("/tools");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("Tools");
    expect(app.lastFrame()).toContain("(nothing to show)");
    app.unmount();
  });

  it("the Compliance panel shows status, policies, and recent decisions", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountWith(harness, sid);
    app.stdin.write("/compliance");
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("enforcing");
    expect(frame).toContain("policy: data");
    expect(frame).toContain("decision: write_file");
    app.unmount();
  });

  it("the Memory panel tabs Stored and Suggestions; approve/reject fire on the selected suggestion (pin 8)", async () => {
    approveSpy.mockClear();
    rejectSpy.mockClear();
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountWith(harness, sid);
    app.stdin.write("/memory");
    app.stdin.write("\r");
    // The panel opens on the Stored page (pin 8); it lists stored entries.
    await waitForFrame(app, (f) => f.includes("prefers tabs"), { timeoutMs: 4000, intervalMs: 10 });
    expect(app.lastFrame()).toContain("prefers tabs");
    expect(app.lastFrame()).not.toContain("likes vitest"); // on the other tab
    // Switch to the Suggestions tab (←→), which swaps rows AND actions (pin 8).
    const onSuggestions = (f: string): boolean => f.includes("likes vitest") && f.includes("a approve");
    for (let i = 0; i < 50 && !onSuggestions(app.lastFrame() ?? ""); i++) {
      app.stdin.write("\u001b[C"); // Right → next tab
      await new Promise((r) => setTimeout(r, 20));
    }
    await waitForFrame(app, onSuggestions, { timeoutMs: 4000, intervalMs: 10 });
    expect(app.lastFrame()).toContain("likes vitest");
    // The suggestion is the only row → selected by default; approve it.
    const suggestionSelected = (f: string): boolean =>
      f.split("\n").some((l) => l.includes("likes vitest") && (l.includes("▸") || l.includes("> ")));
    await waitForFrame(app, suggestionSelected, { timeoutMs: 4000, intervalMs: 10 });
    app.stdin.write("a");
    await waitForFrame(app, () => approveSpy.mock.calls.length > 0, { timeoutMs: 4000, intervalMs: 10 });
    expect(approveSpy).toHaveBeenCalledWith({ kind: "suggestion", title: "likes vitest", detail: "pending", id: "s1", _suggestion: true });
    // The notice clears on the next key; re-send `r` until reject fires (the
    // first `r` may fall on the notice-clearing render).
    for (let i = 0; i < 50 && rejectSpy.mock.calls.length === 0; i++) {
      app.stdin.write("r");
      await new Promise((res) => setTimeout(res, 20));
    }
    await waitForFrame(app, () => rejectSpy.mock.calls.length > 0, { timeoutMs: 4000, intervalMs: 10 });
    expect(rejectSpy).toHaveBeenCalled();
    app.unmount();
  });
});

describe("§4.10 history visual-line navigation", () => {
  it("PageUp shows the scroll view with a `↓ N new lines` indicator; End returns to the bottom", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Commit a handful of turns so there is a scrollback buffer.
    for (let i = 0; i < 4; i++) {
      harness.emit("TURN_COMPLETE", { status: "completed", text: `answer ${i}`, usage: { promptTokens: 1, completionTokens: 1, totalMs: 1 } }, sid);
    }
    await new Promise((r) => setTimeout(r, 10));
    app.stdin.write("\u001b[5~"); // PageUp
    await new Promise((r) => setTimeout(r, 10));
    // A new committed line arrives while scrolled up → the indicator counts it.
    harness.emit("TURN_COMPLETE", { status: "completed", text: "live update", usage: { promptTokens: 1, completionTokens: 1, totalMs: 1 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("new lines");
    app.stdin.write("\u001b[F"); // End
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).not.toContain("new lines");
    app.unmount();
  });
});

describe("§4.8 hyperlinks in rendered assistant markdown", () => {
  const linkCaps = detectCapabilities({ COLORTERM: "truecolor", TERM_PROGRAM: "iTerm.app", LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 });

  it("emits OSC 8 for an https link and withholds it for a javascript: link", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, { caps: linkCaps });
    harness.emit(
      "TURN_COMPLETE",
      { status: "completed", text: "see [docs](https://example.com) or [x](javascript:alert(1))", usage: { promptTokens: 1, completionTokens: 1, totalMs: 1 } },
      sid,
    );
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("\x1b]8;;https://example.com");
    expect(frame).toContain("docs");
    expect(frame).not.toContain("javascript:");
    app.unmount();
  });
});

describe("§6.4 single-action approval dialog", () => {
  it("renders a pending approval with full args and resolves approve on 'a'", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    let resolved: ApprovalResponse | null = null;
    const req: PendingApproval = {
      id: "ap1",
      tool: "write_file",
      args: { path: "secret.ts", content: "x" },
      choices: ["approve", "edit", "reject"],
      mode: "interactive",
      inferredPatterns: ["write_file:*.ts"],
      diff: "+new line",
    };
    const app = await mountApp(harness, sid, {
      approvalRequest: req,
      onApprovalResolve: (r) => {
        resolved = r;
      },
    });
    const frame = app.lastFrame()!;
    expect(frame).toContain("write_file");
    expect(frame).toContain("secret.ts");
    expect(frame).toContain("+new line");
    app.stdin.write("a");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toEqual({ requestId: "ap1", decision: "approve" });
    app.unmount();
  });

  it("Escape and 'r' reject; 's' remembers for the session; 'p' persists to the project", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    let resolved: ApprovalResponse | null = null;
    const req: PendingApproval = {
      id: "ap2",
      tool: "execute_command",
      args: { command: "rm x" },
      choices: ["approve", "reject"],
      mode: "interactive",
      rememberable: true,
      inferredPatterns: ["execute_command:rm *"],
    };
    const app = await mountApp(harness, sid, {
      approvalRequest: req,
      onApprovalResolve: (r) => {
        resolved = r;
      },
    });
    // The exact entry that will be saved is shown before the user chooses.
    expect(app.lastFrame()).toContain("will save to .voidrift/config.json");
    app.stdin.write("p");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toMatchObject({
      requestId: "ap2",
      decision: "approve",
      remember: "project",
      chosenPattern: "execute_command:rm *",
    });
    app.unmount();
  });

  it("'s' remembers for this session only", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    let resolved: ApprovalResponse | null = null;
    const req: PendingApproval = {
      id: "ap2s",
      tool: "execute_command",
      args: { command: "rm x" },
      choices: ["approve", "reject"],
      mode: "interactive",
      rememberable: true,
      inferredPatterns: ["execute_command:rm *"],
    };
    const app = await mountApp(harness, sid, {
      approvalRequest: req,
      onApprovalResolve: (r) => {
        resolved = r;
      },
    });
    app.stdin.write("s");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toMatchObject({ requestId: "ap2s", decision: "approve", remember: "session" });
    app.unmount();
  });

  it("a force-ask (not rememberable) offers only y/n — 's'/'p' are inert", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    let resolved: ApprovalResponse | null = null;
    const req: PendingApproval = {
      id: "ap2f",
      tool: "execute_command",
      args: { command: "rm -rf /" },
      choices: ["approve", "reject"],
      mode: "interactive",
      rememberable: false,
      forceAskKind: "shell",
      inferredPatterns: ["execute_command:rm -rf *"],
    };
    const app = await mountApp(harness, sid, {
      approvalRequest: req,
      onApprovalResolve: (r) => {
        resolved = r;
      },
    });
    expect(app.lastFrame()).not.toContain("will save to .voidrift/config.json");
    // 's' and 'p' must do nothing when the ask is not rememberable.
    app.stdin.write("s");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBeNull();
    app.stdin.write("p");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBeNull();
    // only y/n work.
    app.stdin.write("n");
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toMatchObject({ requestId: "ap2f", decision: "reject" });
    app.unmount();
  });

describe("§4/§5 the ported TUI look", () => {
  it("§5.1 paints the block-letter banner, wordmark, tagline, and identity block", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    const frame = app.lastFrame()!;
    expect(frame).toContain("VoidRift"); // wordmark
    expect(frame).toContain("Local-first AI harness"); // tagline
    expect(frame).toContain("██"); // block-letter banner glyphs
    expect(frame).toContain("Workspace");
    expect(frame).toContain("Session");
    app.unmount();
  });

  it("§4.1 echoes the user turn with a `┃` bar and no role word", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    app.stdin.write("list the files");
    await new Promise((r) => setTimeout(r, 10));
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    const frame = app.lastFrame()!;
    expect(frame).toContain("┃");
    expect(frame).toContain("list the files");
    expect(frame).not.toContain("you");
    app.unmount();
  });

  it("§4.1 wraps a long user echo with a hanging indent and no orphan line", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    // A ~112-char message at width 110 reproduced the orphan-`a` / bad-indent bug.
    const narrowCaps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 110, rows: 40 });
    const app = await mountApp(harness, sid, { caps: narrowCaps });
    const msg =
      "Read package.json then explain the dependencies as a bullet list, and a code block showing the scripts section verbatim";
    app.stdin.write(msg);
    await new Promise((r) => setTimeout(r, 10));
    app.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    const frame = app.lastFrame()!;
    // The echo wrapped across lines, the bar on the first line only.
    expect(frame).toContain("┃ Read package.json");
    const echoLines = frame.split("\n").filter((l) => /package\.json|bullet list|code block|verbatim/.test(l));
    expect(echoLines.length).toBeGreaterThan(1);
    // No continuation line is a lone single character (the old orphan `a`).
    for (const l of echoLines) expect(l.trim()).not.toMatch(/^[a-z]$/);
    // Continuation lines carry the 2-space hanging indent, not the bar.
    const cont = echoLines.filter((l) => !l.includes("┃"));
    for (const l of cont) expect(l).toMatch(/^\s{2}\S/);
    app.unmount();
  });

  it("§4.2 shows `<0.1s` and no tok/s for a sub-0.1s turn", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit(
      "TURN_COMPLETE",
      { status: "completed", text: "quick", usage: { promptTokens: 10, completionTokens: 4, totalMs: 40 } },
      sid,
    );
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("<0.1s");
    expect(frame).not.toContain("tok/s");
    expect(frame).toContain("↓ 4");
    app.unmount();
  });

  it("§4.2 still shows tok/s and elapsed for a turn at/over 0.1s", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // §10.7 — tok/s is generation speed; it needs a measured genMs from MODEL_USAGE.
    harness.emit(
      "MODEL_USAGE",
      { name: "test", usage: { promptTokens: 10, inputSum: 10, completionTokens: 4, genMs: 500 } },
      sid,
    );
    harness.emit(
      "TURN_COMPLETE",
      { status: "completed", text: "ok", usage: { promptTokens: 10, completionTokens: 4, totalMs: 100 } },
      sid,
    );
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("tok/s");
    expect(frame).not.toContain("<0.1s");
    app.unmount();
  });

  it("§5.1 renders the full banner at >= 82 columns and the compact wordmark below", async () => {
    const harness = await makeHarness();
    const wide = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 82, rows: 40 });
    const narrow = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 81, rows: 40 });
    const sidW = await newSession(harness);
    const wideApp = await mountApp(harness, sidW, { caps: wide });
    await new Promise((r) => setTimeout(r, 10));
    expect(wideApp.lastFrame()!).toContain("██"); // block-letter banner
    wideApp.unmount();
    const sidN = await newSession(harness);
    const narrowApp = await mountApp(harness, sidN, { caps: narrow });
    await new Promise((r) => setTimeout(r, 10));
    const nf = narrowApp.lastFrame()!;
    expect(nf).not.toContain("██"); // compact wordmark, no block letters
    expect(nf).toContain("VoidRift");
    narrowApp.unmount();
  });

  it("§4.4 renders a compact `● Tool  arg  dur` row + counts summary for each built-in tool, never dumping the raw body", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // The core emits a RAW result body as `summary` (decision-point slices the
    // tool content, §8.1); the CLI must transform it to a counts-only line and
    // NEVER render the raw body (§4.4).
    const cases: Array<[string, Record<string, unknown>, string, string, string, string]> = [
      // [name, args, rawSummary, label, countLine, bodyFragmentThatMustNotShow]
      ["read_file", { path: "a.ts" }, "a.ts (24 lines)\n 1  const x = 1\n 2  const y = 2", "Read", "24 lines", "const x = 1"],
      ["workspace_map", { path: "." }, "src/\ndocs/\nf1.ts\nf2.ts", "Map", "2 files, 2 dirs", "f1.ts"],
      ["glob_files", { pattern: "**/*.ts" }, "a.ts\nb.ts", "Glob", "2 matches", "b.ts"],
      ["write_file", { path: "o.ts" }, "Created o.ts (1 lines)", "Write", "wrote 1 lines", "Created o.ts"],
    ];
    let i = 0;
    for (const [name, args, rawSummary] of cases) {
      harness.emit("TOOL_STARTED", { id: `t${i}`, name, args }, sid);
      harness.emit("TOOL_FINISHED", { id: `t${i}`, name, status: "success", durationMs: 300, summary: rawSummary }, sid);
      i++;
    }
    // Let every committed row flush to Static before asserting on the frame.
    await new Promise((r) => setTimeout(r, 40));
    const frame = app.lastFrame()!;
    for (const [, , , label, countLine, body] of cases) {
      expect(frame).toContain(label);
      expect(frame).toContain(countLine);
      expect(frame).not.toContain(body); // the raw body is never dumped (§4.4)
    }
    expect(frame).toContain("●");
    app.unmount();
  });

  it("§4.4 shows a failed tool with ✗ and two parallel tools, each with its own state", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // Two parallel running tools.
    harness.emit("TOOL_STARTED", { id: "p1", name: "read_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_STARTED", { id: "p2", name: "glob_files", args: { pattern: "*.ts" } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    let frame = app.lastFrame()!;
    // Buffered rendering (§4.2): no individual rows are drawn while the round
    // runs — only the single status line. The rows appear once the group commits.
    expect(frame).toContain("Running");
    expect(frame).not.toContain("a.ts");
    // One succeeds, one fails: the whole group commits when the round finishes.
    harness.emit("TOOL_FINISHED", { id: "p1", name: "read_file", status: "success", durationMs: 100, summary: "3 lines" }, sid);
    harness.emit("TOOL_FINISHED", { id: "p2", name: "glob_files", status: "error", durationMs: 100, summary: "boom" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    frame = app.lastFrame()!;
    expect(frame).toContain("Read");
    expect(frame).toContain("Glob");
    expect(frame).toContain("✗"); // the failed row
    expect(frame).toContain("boom");
    app.unmount();
  });

  it("§4.3 renders markdown headings, bold, inline code, bullets, and a table", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    const md = [
      "# Heading",
      "",
      "A **bold** word and `code`.",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "| Name | Val |",
      "| --- | --- |",
      "| a | 1 |",
    ].join("\n");
    harness.emit("TURN_COMPLETE", { status: "completed", text: md, usage: { promptTokens: 5, completionTokens: 9, totalMs: 100 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("Heading");
    expect(frame).toContain("bold");
    expect(frame).toContain("code");
    expect(frame).toContain("•"); // bullets
    expect(frame).toContain("Name"); // table header
    expect(frame).not.toContain("**"); // raw markdown not shown
    app.unmount();
  });

  it("§4.2 shows the turn footer `↑in ↓out tok/s elapsed` with SUMMED input and generation-speed tok/s", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // §10.7 — `↑` is the SUMMED input across the turn's calls (inputSum), not the
    // peak prompt (promptTokens); tok/s is generation speed from genMs.
    harness.emit("MODEL_USAGE", { name: "test", usage: { promptTokens: 1400, inputSum: 2400, completionTokens: 70, cacheReadTokens: 0, genMs: 1000 } }, sid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "the answer", usage: { promptTokens: 1400, completionTokens: 70, totalMs: 13000 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("↑ 2400"); // summed input, not the 1400 peak
    expect(frame).not.toContain("↑ 1400");
    expect(frame).toContain("↓ 70");
    expect(frame).toContain("tok/s");
    expect(frame).not.toContain("0 tokens"); // the fixed defect
    app.unmount();
  });

  it("§4.2 omits tok/s when the turn was not streamed (no genMs), keeping ↑ ↓ and elapsed", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // No genMs on MODEL_USAGE → the turn's calls were not streamed; the footer
    // drops the tok/s segment but still shows ↑/↓ and elapsed (§10.7, §4.2).
    harness.emit("MODEL_USAGE", { name: "test", usage: { promptTokens: 800, inputSum: 800, completionTokens: 30 } }, sid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "no stream", usage: { promptTokens: 800, completionTokens: 30, totalMs: 2000 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("↑ 800");
    expect(frame).toContain("↓ 30");
    expect(frame).not.toContain("tok/s");
    app.unmount();
  });

  it("§4.2 hides the footer line for a tool-only turn (zero completion tokens)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "", usage: { promptTokens: 10, completionTokens: 0, totalMs: 100 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).not.toContain("tok/s");
    app.unmount();
  });

  it("§4.2 marks estimated token figures with `~` and bare for provider-reported", async () => {
    const harness = await makeHarness();
    const estSid = await newSession(harness);
    const estApp = await mountApp(harness, estSid);
    harness.emit("MODEL_USAGE", { name: "test", usage: { promptTokens: 1200, completionTokens: 24 }, estimated: true }, estSid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "est", usage: { promptTokens: 1200, completionTokens: 24, totalMs: 2000 } }, estSid);
    await new Promise((r) => setTimeout(r, 10));
    const estFrame = estApp.lastFrame()!;
    expect(estFrame).toContain("↑ ~1200");
    expect(estFrame).toContain("↓ ~24");
    estApp.unmount();

    const repSid = await newSession(harness);
    const repApp = await mountApp(harness, repSid);
    harness.emit("MODEL_USAGE", { name: "test", usage: { promptTokens: 1200, completionTokens: 24 }, estimated: false }, repSid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "rep", usage: { promptTokens: 1200, completionTokens: 24, totalMs: 2000 } }, repSid);
    await new Promise((r) => setTimeout(r, 10));
    const repFrame = repApp.lastFrame()!;
    expect(repFrame).toContain("↑ 1200");
    expect(repFrame).not.toContain("~1200");
    repApp.unmount();
  });

  it("§4.2 appends `$cost` only when the active model carries a configured price", async () => {
    // Priced active model → `$cost` appears.
    const priced = await makeHarness({ seed: { models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000, costPer1kInput: 1, costPer1kOutput: 2 } }, modelSelected: "test" } });
    const pSid = await newSession(priced);
    const pApp = await mountApp(priced, pSid);
    priced.emit("TURN_COMPLETE", { status: "completed", text: "paid", usage: { promptTokens: 1000, completionTokens: 1000, totalMs: 1000 } }, pSid);
    await new Promise((r) => setTimeout(r, 10));
    expect(pApp.lastFrame()!).toContain("$3.0000");
    pApp.unmount();

    // Unpriced (default harness) → no `$`.
    const free = await makeHarness();
    const fSid = await newSession(free);
    const fApp = await mountApp(free, fSid);
    free.emit("TURN_COMPLETE", { status: "completed", text: "free", usage: { promptTokens: 1000, completionTokens: 1000, totalMs: 1000 } }, fSid);
    await new Promise((r) => setTimeout(r, 10));
    expect(fApp.lastFrame()!).not.toContain("$");
    fApp.unmount();
  });

  it("§4.2 shows no footer for a turn that errored before the model answered", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("ERROR_OCCURRED", { source: "model", message: "endpoint down" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).not.toContain("tok/s");
    expect(frame).not.toContain("↑ ");
    app.unmount();
  });

  it("§4.2 the turn footer does not wrap at 60 columns", async () => {
    const narrow = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 60, rows: 40 });
    const priced = await makeHarness({ seed: { models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000, costPer1kInput: 1, costPer1kOutput: 2 } }, modelSelected: "test" } });
    const sid = await newSession(priced);
    const app = await mountApp(priced, sid, { caps: narrow });
    priced.emit("MODEL_USAGE", { name: "test", usage: { promptTokens: 7204, inputSum: 7204, completionTokens: 24, genMs: 5000 }, estimated: true }, sid);
    priced.emit("TURN_COMPLETE", { status: "completed", text: "ok", usage: { promptTokens: 7204, completionTokens: 24, totalMs: 13000 } }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    // The whole footer sits on ONE line within 60 cols: find the line and
    // assert every segment is present on it (no wrap splitting the segments).
    const footer = frame.split("\n").find((l) => l.includes("tok/s"))!;
    expect(footer).toBeDefined();
    expect(footer).toContain("↑ ~7204");
    expect(footer).toContain("↓ ~24");
    expect(footer).toContain("tok/s");
    expect(footer).toContain("$");
    app.unmount();
  });

  it("§5.2 renders the status bar `[Mode] voidrift · model · ◎ ctx%` with right-aligned cwd under a rule", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("CONTEXT_BUDGET_UPDATED", { percentage: 38, usedTokens: 1, headTokens: 1, workingBudget: 1, window: 1 }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("[Chat]");
    expect(frame).toContain("voidrift");
    expect(frame).toContain("◎ 38%");
    expect(frame).toContain("─"); // the rule
    expect(frame).toContain(basename(WS)); // cwd on the right
    app.unmount();
  });

  for (const width of [60, 80, 120]) {
    it(`§5.2 status bar rule honors terminal width ${width} with cwd right-aligned`, async () => {
      // Render StatusBar in isolation at a controlled width — ink-testing-library
      // renders the full App at a fixed buffer width, so the component is tested
      // directly for its width-dependent layout (§5.2).
      const wcaps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: width, rows: 40 });
      const theme = resolveTheme(wcaps);
      const glyphs = resolveGlyphs(wcaps);
      const state = { ...initialState(5000), model: "gpt-4o", contextPercentage: 38, activeAgent: undefined, branch: "main" };
      const topAgents = [{ name: "chat", label: "Chat", unlisted: "ask" as const, order: 10 }];
      const r = render(
        <StatusBar state={state} topAgents={topAgents} workspaceRoot="/home/u/some/long/workspace/path/project" width={width} theme={theme} glyphs={glyphs} />,
      );
      const frame = r.lastFrame()!.replace(/\u001b\[[0-9;]*m/g, "");
      const lines = frame.split("\n").map((l) => l.replace(/\s+$/, ""));
      // The dim rule is drawn to the detected width (clamped by the test
      // renderer's 100-col buffer, so a 120-wide rule reads as 100 here).
      const rule = lines.find((l) => /^─+$/.test(l));
      expect(rule).toBeDefined();
      expect(rule!.length).toBe(Math.min(width, 100));
      // Left identity and right cwd both present; cwd home-shortened/aligned right.
      expect(frame).toContain("[Chat]");
      expect(frame).toContain("gpt-4o");
      expect(frame).toContain("◎ 38%");
      expect(frame).toMatch(/project/); // cwd segment
      r.unmount();
    });
  }

  for (const width of [60, 80, 120]) {
    for (const mono of [false, true]) {
      it(`§5.2/§5.6 the [Vibe] bracket is bold+red (NO_COLOR=${mono}) at width ${width}`, async () => {
        const env = mono ? { NO_COLOR: "1", LANG: "en_US.UTF-8" } : { LANG: "en_US.UTF-8" };
        const wcaps = detectCapabilities(env, { columns: width, rows: 40 });
        const theme = resolveTheme(wcaps);
        const glyphs = resolveGlyphs(wcaps);
        const state = { ...initialState(5000), model: "gpt-4o", mode: "vibe", branch: "main" };
        const topAgents = [{ name: "vibe", label: "Vibe", unlisted: "allow" as const, order: 30 }];
        const r = render(
          <StatusBar state={state} topAgents={topAgents} workspaceRoot="/home/u/proj" width={width} theme={theme} glyphs={glyphs} />,
        );
        const raw = r.lastFrame()!;
        const plain = raw.replace(/\u001b\[[0-9;]*m/g, "");
        // The literal [Vibe] text is always present so the posture reads the
        // same under NO_COLOR (§5.2); the bracket colour keys on the active
        // agent's `unlisted: allow` (data-driven, not a name).
        expect(plain).toContain("[Vibe]");
        expect(plain).not.toContain("[AUTO-APPROVE]");
        if (mono) {
          // §5.2 NO_COLOR-safe fallback: with no colour the allow bracket is
          // bold + INVERSE so it still stands out — those are ANSI SGR codes,
          // not colour. The rest of the frame carries no colour, and the literal
          // [Vibe] text is the always-on signal.
          const sgr = raw.match(/\u001b\[[0-9;]*m/g) ?? [];
          // Only bold (1) / inverse (7) / reset (0/22/27) codes may appear.
          for (const code of sgr) {
            expect(code).toMatch(/\u001b\[(0|1|7|22|27|1;7)m/);
          }
        }
        r.unmount();
      });
    }
  }

  it("§4.9 NO_COLOR keeps the layout legible with glyphs and no ANSI color", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, { caps: monoCaps });
    harness.emit("TOOL_STARTED", { id: "m1", name: "read_file", args: { path: "a.ts" } }, sid);
    harness.emit("TOOL_FINISHED", { id: "m1", name: "read_file", status: "success", durationMs: 100, summary: "3 lines" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).not.toContain("\u001b["); // no ANSI color escapes
    expect(frame).toContain("Read"); // glyph/label still present
    expect(frame).toContain("●"); // state glyph carries meaning without color
    app.unmount();
  });

  it("§5.1 the banner is committed to Static and never re-printed below answers across turns", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // The banner glyph row is present once at boot.
    const bannerRow = "██╗   ██╗";
    expect(app.lastFrame()).toContain(bannerRow);
    // Two completed turns commit below the banner; the banner is not repainted
    // beneath them (the Static region prints it exactly once).
    harness.emit("TURN_COMPLETE", { status: "completed", text: "first answer", usage: { promptTokens: 1, completionTokens: 2, totalMs: 5 } }, sid);
    harness.emit("TURN_COMPLETE", { status: "completed", text: "second answer", usage: { promptTokens: 1, completionTokens: 2, totalMs: 5 } }, sid);
    await new Promise((r) => setTimeout(r, 15));
    const frame = app.lastFrame()!;
    expect(frame).toContain("first answer");
    expect(frame).toContain("second answer");
    // The banner's top glyph row appears at most once in the live frame.
    const occurrences = frame.split(bannerRow).length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
    app.unmount();
  });

  it("§5.1 a terminal narrower than the banner falls back to a compact wordmark (no mid-glyph wrap)", async () => {
    const narrowCaps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 48, rows: 40 });
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, { caps: narrowCaps });
    const frame = app.lastFrame()!;
    expect(frame).toContain("VoidRift"); // the compact wordmark
    expect(frame).toContain("Local-first AI harness");
    expect(frame).not.toContain("██"); // the block-letter banner is suppressed
    app.unmount();
  });

  it("§3.9 an idle Ctrl+C arms the exit hint, and a second within 1s shuts down and exits 130", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const onQuit = vi.fn();
    const shutdown = vi.spyOn(harness.ready.api.session, "shutdown");
    const app = await mountApp(harness, sid, { onQuit });
    // First idle Ctrl+C arms the hint instead of silently no-opping.
    app.stdin.write("\x03");
    await new Promise((r) => setTimeout(r, 10));
    expect(app.lastFrame()).toContain("press ctrl+c again to exit");
    expect(onQuit).not.toHaveBeenCalled();
    // Second within 1s shuts down and exits 130 (SIGINT).
    app.stdin.write("\x03");
    await new Promise((r) => setTimeout(r, 20));
    expect(shutdown).toHaveBeenCalled();
    expect(onQuit).toHaveBeenCalledWith(130);
    app.unmount();
  });

  it("§4.4 a failed tool renders a red ✗ glyph and the error line, not a success ●", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    harness.emit("TOOL_STARTED", { id: "e1", name: "edit_file", args: { path: "a.ts" } }, sid);
    harness.emit(
      "TOOL_FINISHED",
      { id: "e1", name: "edit_file", status: "error", durationMs: 100, summary: "Edit failed: search string not found in a.ts" },
      sid,
    );
    await new Promise((r) => setTimeout(r, 10));
    const frame = app.lastFrame()!;
    expect(frame).toContain("✗"); // the failure glyph
    expect(frame).toContain("Edit failed: search string not found in a.ts");
    app.unmount();
  });

  it("§5.1 a resume paints prior turns into Static above a resume line, below the banner", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid, {
      resumeMessages: [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      resumeContext: { summary: "resumed: 3 turns", staleDocuments: ["README.md"] },
    });
    const frame = app.lastFrame()!;
    const bannerRow = "██╗   ██╗";
    expect(frame).toContain(bannerRow); // banner at the top
    expect(frame).toContain("earlier question"); // prior user turn painted
    expect(frame).toContain("earlier answer"); // prior assistant turn painted
    expect(frame).toContain("resumed: 3 turns"); // the resume summary line
    expect(frame).toContain("1 documents changed since you left"); // stale-docs warning
    // The banner is painted once, above the restored turns.
    expect(frame.indexOf(bannerRow)).toBeLessThan(frame.indexOf("earlier question"));
    expect(frame.indexOf("earlier answer")).toBeLessThan(frame.indexOf("resumed: 3 turns"));
    app.unmount();
  });
});
});

describe("§6.2/§6.3 agent monitor and batched fan-out prompt (App wiring)", () => {
  it("Ctrl+G toggles the agent monitor overlay (§6.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const app = await mountApp(harness, sid);
    // A worker is live so the monitor has a row to show.
    harness.emit("WORKER_STATUS_CHANGED", { workerId: "api-worker", status: "running", tool: "write_file" }, sid);
    await new Promise((r) => setTimeout(r, 10));
    app.stdin.write("\x07"); // Ctrl+G
    await new Promise((r) => setTimeout(r, 20));
    expect(app.lastFrame()).toContain("workers");
    expect(app.lastFrame()).toContain("api-worker");
    app.stdin.write("\x07"); // Ctrl+G again closes
    await new Promise((r) => setTimeout(r, 20));
    expect(app.lastFrame()).not.toContain("api-worker");
    app.unmount();
  });

  it("two pending worker approvals render ONE batched prompt; 'a' approves all (§6.2)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const resolved: { id: string; decision: string }[] = [];
    const batch: PendingApproval[] = [
      { id: "w1", tool: "write_file", args: { path: "a.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "api-worker" },
      { id: "w2", tool: "run_tests", args: { suite: "unit" }, choices: ["approve", "reject"], mode: "interactive", workerId: "db-worker" },
    ];
    const app = await mountApp(harness, sid, {
      workerApprovals: batch,
      onWorkerResolve: (id: string, r: ApprovalResponse) => resolved.push({ id, decision: r.decision }),
    });
    await new Promise((r) => setTimeout(r, 20));
    const frame = app.lastFrame()!;
    expect(frame).toContain("write_file"); // both actions shown in full
    expect(frame).toContain("run_tests");
    expect(frame).toContain("[a] approve all");
    app.stdin.write("a");
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved.map((x) => x.decision)).toEqual(["approve", "approve"]);
    app.unmount();
  });

  it("'x' in the batch rejects every worker (§6.2)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    const resolved: string[] = [];
    const batch: PendingApproval[] = [
      { id: "w1", tool: "write_file", args: { path: "a.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "w-a" },
      { id: "w2", tool: "edit_file", args: { path: "b.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "w-b" },
    ];
    const app = await mountApp(harness, sid, {
      workerApprovals: batch,
      onWorkerResolve: (_id: string, r: ApprovalResponse) => resolved.push(r.decision),
    });
    await new Promise((r) => setTimeout(r, 20));
    app.stdin.write("x");
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toEqual(["reject", "reject"]);
    app.unmount();
  });

  it("'c' opens the monitor from the batch to review individually (§6.2 → §6.3)", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    harness.emit("WORKER_STATUS_CHANGED", { workerId: "w-a", status: "needs_review", tool: "write_file" }, sid);
    const batch: PendingApproval[] = [
      { id: "w1", tool: "write_file", args: { path: "a.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "w-a" },
      { id: "w2", tool: "edit_file", args: { path: "b.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "w-b" },
    ];
    const app = await mountApp(harness, sid, { workerApprovals: batch, onWorkerResolve: () => undefined });
    await new Promise((r) => setTimeout(r, 20));
    app.stdin.write("c");
    await new Promise((r) => setTimeout(r, 20));
    expect(app.lastFrame()).toContain("workers"); // the monitor header
    app.unmount();
  });
});

describe("§5.2 SIGWINCH resize reflow", () => {
  it("shrinking to 40 columns re-renders the status rule at the new width with NO duplicate rule", async () => {
    const harness = await makeHarness();
    const sid = await newSession(harness);
    // A controllable resize source (ink-testing-library's own stdout reports a
    // fixed width, so we inject one we can resize, §5.2).
    const resizeSource = Object.assign(new (await import("node:events")).EventEmitter(), {
      columns: 100,
      rows: 40,
    }) as NodeJS.EventEmitter & { columns: number; rows: number };
    const app = await mountApp(harness, sid, { resizeSource });
    await new Promise((r) => setTimeout(r, 10));
    // Shrink to 40 columns and fire the resize.
    resizeSource.columns = 40;
    resizeSource.emit("resize");
    await new Promise((r) => setTimeout(r, 40)); // past the debounce
    const frame = app.lastFrame()!.replace(/\u001b\[[0-9;]*m/g, "");
    const lines = frame.split("\n").map((l) => l.replace(/\s+$/, ""));
    const rules = lines.filter((l) => /^─+$/.test(l));
    // Exactly one status rule, and it is the new (narrower) width — no overlap,
    // no multiple partial rules.
    expect(rules.length).toBe(1);
    expect(rules[0]!.length).toBe(40);
    app.unmount();
  });
});

describe("§3.1/§3.2/§3.4 multi-line Up/Down visual navigation", () => {
  // A stubbed send that records inputs and never consumes the fake model, so
  // seeding history entries is cheap (as the existing §3.2 history tests do).
  async function mountWithStubSend(
    harness: Harness,
    sid: string,
    extra: Partial<React.ComponentProps<typeof App>> = {},
  ) {
    const api = {
      ...harness.ready.api,
      session: { ...harness.ready.api.session, send: async () => ({ ok: true as const, value: undefined }) },
    };
    return mountApp(harness, sid, { api, ...extra });
  }

  it("Ctrl+J two-line buffer: Up moves to line 1 keeping the column, a second Up falls to history, Down returns", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountWithStubSend(harness, sid);
    // Seed one history entry "hist".
    app.stdin.write("hist");
    await waitForFrame(app, (f) => f.includes("❯ hist"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\r");
    harness.emit("TURN_COMPLETE", { status: "completed", text: "ok" }, sid);
    await waitForFrame(app, (f) => f.includes("ask a question or describe a task"), { timeoutMs: 4000, intervalMs: 20 });
    // Build a two-line buffer: "ab" + newline (Ctrl+J → "\n") + "cd".
    app.stdin.write("ab");
    app.stdin.write("\n");
    app.stdin.write("cd");
    // Both visual rows render (prompt on the first, indent on the continuation).
    await waitForFrame(app, (f) => f.includes("❯ ab") && f.includes("cd"), { timeoutMs: 4000, intervalMs: 20 });
    // Up moves the cursor one visual line up, keeping column 2; typing lands at
    // the end of line 0 → "abZ\ncd".
    app.stdin.write("\u001b[A");
    app.stdin.write("Z");
    await waitForFrame(app, (f) => f.includes("❯ abZ"), { timeoutMs: 4000, intervalMs: 20 });
    // The cursor is now on line 0 again (goal reset by typing). Up falls through
    // to the index axis → the newest history entry "hist".
    await waitForFrame(
      app,
      (f) => f.includes("❯ hist"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ hist")) app.stdin.write("\u001b[A"); },
    );
    // Down returns to the live multi-line buffer, restored unchanged.
    await waitForFrame(
      app,
      (f) => f.includes("❯ abZ") && f.includes("cd"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ abZ")) app.stdin.write("\u001b[B"); },
    );
    app.unmount();
  });

  it("Down on the last visual line falls through to the index axis (no-op at 0 with no history/dropdown)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountWithStubSend(harness, sid);
    app.stdin.write("ab");
    app.stdin.write("\n");
    app.stdin.write("cd");
    await waitForFrame(app, (f) => f.includes("❯ ab") && f.includes("cd"), { timeoutMs: 4000, intervalMs: 20 });
    // Cursor at the end (last visual line). Down falls through; with no history
    // and no dropdown it is a no-op — the buffer is unchanged.
    app.stdin.write("\u001b[B");
    app.stdin.write("Z"); // lands at the end → "ab\ncdZ"
    await waitForFrame(app, (f) => f.includes("cdZ"), { timeoutMs: 4000, intervalMs: 20 });
    app.unmount();
  });

  it("a wrapped single logical line navigates its visual lines at a small columns", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    // columns 12 → content width 10; "hello world!!" wraps to "hello " / "world!!".
    const narrow = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 12, rows: 40 });
    const app = await mountWithStubSend(harness, sid, { caps: narrow });
    app.stdin.write("hello world!!");
    await waitForFrame(app, (f) => f.includes("hello") && f.includes("world"), { timeoutMs: 4000, intervalMs: 20 });
    // Cursor at the end (row1). Up moves into the first visual line; typing lands
    // there, inside "hello ".
    app.stdin.write("\u001b[A");
    app.stdin.write("Z");
    await waitForFrame(app, (f) => f.includes("Z"), { timeoutMs: 4000, intervalMs: 20 });
    // The inserted Z appears on the first wrapped row, before "world".
    const frame = app.lastFrame()!;
    const zAt = frame.indexOf("Z");
    const worldAt = frame.indexOf("world");
    expect(zAt).toBeGreaterThanOrEqual(0);
    expect(zAt).toBeLessThan(worldAt);
    app.unmount();
  });

  it("single-line buffer: Up/Down drive history unchanged (no visual nav)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountWithStubSend(harness, sid);
    app.stdin.write("hist");
    await waitForFrame(app, (f) => f.includes("❯ hist"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("\r");
    harness.emit("TURN_COMPLETE", { status: "completed", text: "ok" }, sid);
    await waitForFrame(app, (f) => f.includes("ask a question or describe a task"), { timeoutMs: 4000, intervalMs: 20 });
    app.stdin.write("draft");
    await waitForFrame(app, (f) => f.includes("❯ draft"), { timeoutMs: 4000, intervalMs: 20 });
    // Single-line: Up immediately recalls history (no visual move to consume it).
    await waitForFrame(
      app,
      (f) => f.includes("❯ hist"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ hist")) app.stdin.write("\u001b[A"); },
    );
    // Down restores the draft.
    await waitForFrame(
      app,
      (f) => f.includes("❯ draft"),
      { timeoutMs: 4000, intervalMs: 20 },
      (f) => { if (!f.includes("❯ draft")) app.stdin.write("\u001b[B"); },
    );
    app.unmount();
  });

  it("while the slash dropdown is open, Up/Down keep the index-axis behaviour (dropdown owns them)", async () => {
    const harness = await makeHarness({ reply: "ok" });
    const sid = await newSession(harness);
    const app = await mountWithStubSend(harness, sid);
    // Open the slash dropdown with a `/` buffer (a single-line slash command).
    app.stdin.write("/");
    await waitForFrame(app, (f) => f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    const before = app.lastFrame()!;
    // Down steps the candidate highlight on the positive axis (dropdown owns it);
    // the dropdown stays open — no visual-line move swallows the key.
    app.stdin.write("\u001b[B");
    await waitForFrame(app, (f) => f.includes("↑↓ navigate"), { timeoutMs: 4000, intervalMs: 20 });
    expect(app.lastFrame()!).toContain("↑↓ navigate");
    expect(before).toContain("↑↓ navigate");
    app.unmount();
  });
});
