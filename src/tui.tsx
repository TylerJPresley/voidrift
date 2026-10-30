/**
 * Interactive bootstrap (cli-blueprint.md §1.5).
 *
 * Enters the alternate screen and hides the cursor, registers the restore hook
 * for every exit path, detects capabilities, boots the core with the CLI
 * callbacks and `installSignalHandlers: false`, selects the session, assembles
 * the Slice-A panel registry, and renders the App. A construction error exits 3
 * without entering the alternate screen (§1.5 step 4, §2.4).
 */
import React from "react";
import { render } from "ink";
import type { ApprovalResponse, CoreReady, PendingApproval, SessionInfo } from "@voidrift/core";
import { TerminalController, detectCapabilities, type Capabilities } from "./terminal.js";
import { resolveTheme, resolveGlyphs } from "./render/theme.js";
import { bootCore, bindPanels, type CoreClientOptions } from "./core-client.js";
import { registerBuiltinPanels, slashCommandsDataset } from "./panels/declarations.js";
import { readAutoDenySeconds } from "./approval-countdown.js";
import { App } from "./components/App.js";
import { EXIT } from "./exit-codes.js";
import { CLI_VERSION } from "./version.js";
import { writeConfigNotice } from "./config-notice.js";
import { installResizeClear, type ResizeStdout } from "./resize-clear.js";

/**
 * Whether a worker ask may join the batched fan-out prompt (§6.2, cli §6.2).
 * ONLY a PLAIN worker ask (one carrying `workerId` and NOT a force-ask) is
 * batchable: a batch `a`/`f` approves every batched member at once, and a
 * force-ask (any `forceAskKind`: SSRF, plugin-install, dangerous shell, control-
 * file) can NEVER be satisfied by a bulk approval or a fan-out grant (core §9.5)
 * — it is routed to the single-action dialog, one decision each. PURE. */
export function isWorkerBatchable(req: PendingApproval): boolean {
  return Boolean(req.workerId) && !req.forceAsk && req.forceAskKind === undefined;
}

export interface TuiOptions {
  workspaceRoot: string;
  resume?: { id?: string } | undefined;
  forceNew?: boolean;
  /** Inject a pre-built core (tests); otherwise bootCore constructs it. */
  bootOverride?: (opts: CoreClientOptions) => Promise<CoreReady>;
  terminal?: TerminalController;
  caps?: Capabilities;
  proc?: NodeJS.Process;
  /** Inject the Ink renderer (tests pass ink-testing-library's render). */
  renderImpl?: (element: React.ReactElement) => { unmount: () => void; clear?: () => void };
}

/** Pick the session at start per the command and resumeOnStart (§2.5). */
async function selectSession(
  ready: CoreReady,
  resume: { id?: string } | undefined,
  forceNew: boolean,
): Promise<{ sessionId: string; name: string; resumeSummary?: string; pending?: PendingApproval[]; stale?: string[] }> {
  const api = ready.api;
  const resumeOnStart = (await api.config.get("resumeOnStart")).ok
    ? ((await api.config.get("resumeOnStart")).ok && ((await api.config.get("resumeOnStart")) as { value: unknown }).value)
    : undefined;

  const resumeById = async (id: string) => {
    const r = await api.session.resume(id);
    if (r.ok) {
      return {
        sessionId: r.value.info.id,
        name: r.value.info.name,
        resumeSummary: r.value.info.summary,
        pending: r.value.pending ?? [],
        stale: r.value.staleDocuments,
      };
    }
    return null;
  };

  if (forceNew) {
    const c = await api.session.create();
    return { sessionId: c.ok ? c.value.id : "", name: c.ok ? c.value.name : "untitled" };
  }
  if (resume) {
    if (resume.id) {
      const r = await resumeById(resume.id);
      if (r) return r;
    } else {
      const list = await api.session.list();
      const sorted = [...list].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
      const recent = sorted[0];
      if (recent) {
        const r = await resumeById(recent.id);
        if (r) return r;
      }
    }
  } else if (resumeOnStart === 1) {
    const list = await api.session.list();
    const sorted = [...list].sort((a: SessionInfo, b: SessionInfo) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    const recent = sorted[0];
    if (recent) {
      const r = await resumeById(recent.id);
      if (r) return r;
    }
  }
  const c = await api.session.create();
  return { sessionId: c.ok ? c.value.id : "", name: c.ok ? c.value.name : "untitled" };
}

/** Boot the interactive TUI; returns the exit code when the user leaves. */
export async function runTui(opts: TuiOptions): Promise<number> {
  const proc = opts.proc ?? process;
  const caps = opts.caps ?? detectCapabilities();
  const theme = resolveTheme(caps);
  const glyphs = resolveGlyphs(caps);

  // The onApproval bridge. The core calls it once per gated action; it resolves
  // when the user answers. A WORKER ask (one carrying `workerId`, raised by a
  // fan-out, core §9.5) is collected into a batch so N concurrent worker asks
  // render ONE batched prompt (§6.2) or the monitor (§6.3) rather than N serial
  // single dialogs; a non-worker (orchestrator) ask uses the single-action
  // dialog as before. Each pending promise is latched to exactly one decision.
  let resolveApproval: ((r: ApprovalResponse) => void) | null = null;
  let setRequest: ((req: PendingApproval | null) => void) | null = null;
  // The live worker-ask batch, keyed by request id → its resolver. Published to
  // the App as an array so a late-arriving sibling ask joins the open batch.
  const workerResolvers = new Map<string, (r: ApprovalResponse) => void>();
  let setWorkerBatch: ((batch: PendingApproval[]) => void) | null = null;
  const workerBatch: PendingApproval[] = [];
  const publishWorkerBatch = (): void => setWorkerBatch?.(workerBatch.slice());

  const onApproval = (req: PendingApproval): Promise<ApprovalResponse> => {
    if (isWorkerBatchable(req)) {
      // A PLAIN worker ask: add to the batch and resolve when the user answers
      // it (through the batched prompt, the monitor, or a single worker dialog).
      // A force-ask (any forceAskKind: SSRF, plugin-install, dangerous shell,
      // control-file) is NEVER batched — a batch `a`/`f` must not approve it —
      // so it falls through to the single-action dialog below, one decision each
      // (the four choices / always-asked line, as for the orchestrator).
      return new Promise<ApprovalResponse>((resolve) => {
        workerResolvers.set(req.id, resolve);
        workerBatch.push(req);
        publishWorkerBatch();
      });
    }
    // A non-worker (orchestrator) ask, or a worker FORCE-ASK: the single-action
    // dialog, one at a time.
    return new Promise<ApprovalResponse>((resolve) => {
      resolveApproval = resolve;
      setRequest?.(req);
    });
  };

  // Resolve one worker ask by request id (from the batch, the monitor, or a
  // single worker dialog) and remove it from the batch so the UI updates.
  const resolveWorker = (requestId: string, r: ApprovalResponse): void => {
    const resolve = workerResolvers.get(requestId);
    if (!resolve) return; // already latched (one decision per request)
    workerResolvers.delete(requestId);
    const idx = workerBatch.findIndex((p) => p.id === requestId);
    if (idx >= 0) workerBatch.splice(idx, 1);
    publishWorkerBatch();
    resolve(r);
  };

  let ready: CoreReady;
  try {
    const boot = opts.bootOverride ?? bootCore;
    ready = await boot({
      workspaceRoot: opts.workspaceRoot,
      onApproval,
      output: (t) => proc.stdout.write(t),
    });
  } catch {
    // A synchronous construction error exits 3 without entering the alt screen.
    return EXIT.STARTUP;
  }

  // §13.2–§13.3 — report any config layer rejected at boot, then any ignored-key
  // warning (one `voidrift: warning:` line each), BEFORE the TUI takes over the
  // terminal (hides the cursor), so the user sees why their config did not apply
  // (the CONFIG_INVALID / CONFIG_WARNING events fired during boot, before
  // anything subscribed).
  await writeConfigNotice(ready.api, proc.stderr);

  const terminal = opts.terminal ?? new TerminalController(proc.stdout);
  // Clear the visible screen and home the cursor ONCE on a TTY before the first
  // Ink frame, so the banner is on the first row with scrollback preserved
  // (§1.5 step 2, §10.2). A non-TTY or headless run emits nothing. Never on
  // resize or `/clear`.
  terminal.clearScreen(Boolean((proc.stdout as { isTTY?: boolean }).isTTY));
  terminal.enter();
  terminal.installRestoreHook(proc);

  const api = ready.api;
  // Panels ship WITH the CLI (handoff §0.1): register the CLI's own built-in
  // declarations through the same `register.panel` seam a plugin uses, right
  // after `createCore`. A failed registration is skipped, never fatal.
  registerBuiltinPanels((name, def) => api.register.panel(name, def));
  // §7.2 (pin 9, a deviation) — the core's `commands` dataset holds only
  // core/plugin command NAMES; the CLI registers its OWN `slash-commands`
  // dataset (its built-in catalog WITH descriptions) so the Help panel, sourced
  // from `["slash-commands", "commands"]`, lists both.
  api.register.dataset("slash-commands", slashCommandsDataset(async () => {
    const r = await api.session.listCommands();
    return r.ok ? r.value : [];
  }));
  const selection = await selectSession(ready, opts.resume, opts.forceNew ?? false);
  const rootRes = await api.workspace.root();
  const workspaceRoot = rootRes.ok ? rootRes.value : opts.workspaceRoot;
  const models = await api.models.list();
  const activeModel = models.ok ? (models.value as { name: string; active: boolean }[]).find((m) => m.active)?.name ?? "" : "";

  // On a resume, load the prior chain so the restored turns paint into Static
  // above the resume line (§5.1). A resume is any selection that carried resume
  // context (summary / pending / stale) back from `selectSession`.
  const isResume =
    selection.resumeSummary !== undefined || selection.pending !== undefined || selection.stale !== undefined;
  let resumeMessages: { role: string; content: string }[] | undefined;
  let resumeContext:
    | { summary?: string; pendingCount?: number; staleDocuments?: string[] }
    | undefined;
  if (isResume) {
    const msgs = await api.session.loadMessages(selection.sessionId);
    resumeMessages = msgs.ok ? msgs.value.map((m) => ({ role: m.role, content: m.content })) : [];
    resumeContext = {
      ...(selection.resumeSummary ? { summary: selection.resumeSummary } : {}),
      ...(selection.pending && selection.pending.length > 0 ? { pendingCount: selection.pending.length } : {}),
      ...(selection.stale && selection.stale.length > 0 ? { staleDocuments: selection.stale } : {}),
    };
  }

  // Read `registry.panels()` as the source of truth and bind each declaration —
  // built-in or plugin-registered — to the CLI's `BoundPanel` view-model (§7.1).
  // A plugin that registered its own panel shows up here with no CLI change.
  const panels = await bindPanels(api, api.registry.panels());

  const cfg = await api.config.get();
  const apps = (cfg.ok ? (cfg.value as { apps?: { cli?: Record<string, unknown> } }).apps?.cli : undefined) ?? {};
  const scrollbackLines = typeof apps["scrollbackLines"] === "number" ? (apps["scrollbackLines"] as number) : 5000;
  const reduceMotion = apps["reduceMotion"] === true;
  const showTips = apps["welcomeTips"] !== false;
  const showThinking = apps["showThinking"] === true;
  const editorCommand = typeof apps["editor"] === "string" ? (apps["editor"] as string) : undefined;

  // §9.5 — the unattended-approval countdown. Read the effective
  // `limits.approval.autoDenySeconds` once at start; 0 (the default) disables it.
  const autoDenySeconds = await readAutoDenySeconds(api);

  return await new Promise<number>((resolveExit) => {
    let disposeResizeClearRef: () => void = () => {};
    // The Ink suspend/restore hooks a terminal editor drives around (§3.8): the
    // live region is cleared so the editor owns the TTY, and on return the
    // cursor is re-hidden so Ink's inverse cursor is the only one shown.
    const inkControl = {
      suspend: () => (instance as { clear?: () => void }).clear?.(),
      resume: () => (instance as { clear?: () => void }).clear?.(),
      hideCursor: () => terminal.hideCursor(),
    };
    const AppWithApproval = (): React.ReactElement => {
      const [req, setReq] = React.useState<PendingApproval | null>(null);
      const [batch, setBatch] = React.useState<PendingApproval[]>([]);
      setRequest = setReq;
      setWorkerBatch = setBatch;
      return (
        <App
          api={api}
          sessionId={selection.sessionId}
          sessionName={selection.name}
          panels={panels}
          caps={caps}
          theme={theme}
          glyphs={glyphs}
          version={CLI_VERSION}
          workspaceRoot={workspaceRoot}
          scrollbackLines={scrollbackLines}
          reduceMotion={reduceMotion}
          showTips={showTips}
          showThinking={showThinking}
          approvalRequest={req}
          onApprovalResolve={(r) => {
            setReq(null);
            resolveApproval?.(r);
          }}
          workerApprovals={batch}
          onWorkerResolve={resolveWorker}
          autoDenySeconds={autoDenySeconds}
          resizeSource={proc.stdout as unknown as NodeJS.EventEmitter & { columns?: number; rows?: number }}
          onQuit={(exitCode) => {
            terminal.restore();
            terminal.dispose();
            disposeResizeClearRef();
            instance.unmount();
            resolveExit(exitCode ?? EXIT.COMPLETED);
          }}
          initialModel={activeModel}
          editorCommand={editorCommand}
          inkControl={inkControl}
          {...(resumeMessages !== undefined ? { resumeMessages } : {})}
          {...(resumeContext !== undefined ? { resumeContext } : {})}
        />
      );
    };
    const renderImpl =
      opts.renderImpl ??
      ((element: React.ReactElement) =>
        render(element, { stdout: proc.stdout as NodeJS.WriteStream, exitOnCtrlC: false }));
    // §5.2 — install the width-decrease frame clear BEFORE render() so its
    // stdout `resize` listener is registered ahead of Ink's own `resized`
    // (listeners fire in registration order): on a narrower resize it erases the
    // rewrapped previous frame's excess physical rows BEFORE Ink repaints, so no
    // stale spinner/rule rows are left behind. Width increase and height-only
    // changes are untouched.
    let resetInk = (): void => {};
    const disposeResizeClear = installResizeClear(proc.stdout as unknown as ResizeStdout, () => resetInk());
    const instance = renderImpl(<AppWithApproval />);
    resetInk = () => (instance as { clear?: () => void }).clear?.();
    disposeResizeClearRef = disposeResizeClear;
  });
}
