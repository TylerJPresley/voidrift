import React from "react";
import { Box, Text, useStdout } from "ink";
import type {
  CoreAPI,
  PendingApproval,
  ApprovalResponse,
} from "@voidrift/core";
import type { BoundPanelRegistry } from "../panels/types.js";
import type { Capabilities } from "../terminal.js";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { reduce, pushUser, initialState, withWelcome, seedResume, blockLineCount, type ViewState } from "../state.js";
import { subscribe } from "../events/subscriptions.js";
import { parseCommand, dispatchCommand, confirmRollback } from "../commands.js";
import { cycleMode, enterAgent, type CycleState } from "../input/mode-cycle.js";
import { MODE_CHANGE_BUSY_NOTICE, type TopAgent } from "../mode.js";
import { InputIndex } from "../input/input-index.js";
import { verticalMove } from "../input/visual-lines.js";import { completeCommands, completeFiles, type Candidate } from "../input/autocomplete.js";
import { OutputPane } from "./OutputPane.js";
import { StatusBar } from "./Footer.js";
import { InputBar, type InputKey } from "./InputBar.js";
import { PanelHost } from "./PanelHost.js";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import { ConfirmModeDialog } from "./ConfirmModeDialog.js";
import { RollbackConflictDialog } from "./RollbackConflictDialog.js";
import { FanoutApproval, type FanoutChoice } from "./FanoutApproval.js";
import { AgentMonitor, type WorkerStreamLine } from "./AgentMonitor.js";
import { pasteClipboardImage, type ClipboardDeps } from "../clipboard.js";
import { composeInEditor, editFile, type EditorDeps, type InkControl } from "../editor.js";
import { EXIT } from "../exit-codes.js";

export interface AppProps {
  api: CoreAPI;
  sessionId: string;
  sessionName: string;
  panels: BoundPanelRegistry;
  caps: Capabilities;
  theme: ThemeTokens;
  glyphs: Glyphs;
  version: string;
  workspaceRoot: string;
  scrollbackLines: number;
  reduceMotion: boolean;
  showTips: boolean;
  showThinking: boolean;
  showToolDetails?: boolean | undefined;
  /** The approval request handed to the dialog (set by the onApproval bridge). */
  approvalRequest?: PendingApproval | null;
  /** Resolve the current approval request (bridges onApproval's promise). */
  onApprovalResolve?: (r: ApprovalResponse) => void;
  /** The batch of worker approvals pending in the active fan-out (§6.2). When it
   * holds two or more, the batched FanoutApproval prompt renders instead of N
   * serial single dialogs; the single-action dialog still handles a lone ask. */
  workerApprovals?: PendingApproval[];
  /** Resolve one worker approval by request id (§6.2/§6.3): the monitor's Enter
   * and the batch's a/f/x route each worker's `onApproval` promise. */
  onWorkerResolve?: (requestId: string, r: ApprovalResponse) => void;
  /** The unattended-approval countdown in seconds (`limits.approval.autoDenySeconds`,
   * §9.5): passed to the single and batched approval dialogs so an unattended
   * prompt auto-denies (deny-and-continue) at expiry. 0/absent → no countdown. */
  autoDenySeconds?: number | undefined;
  /** Shut down and leave. An optional POSIX exit code (default clean exit); an
   * idle double-`Ctrl+C` passes 130 (cancelled by SIGINT, §3.9). */
  onQuit: (exitCode?: number) => void;
  /** The initial model/agent for the welcome and footer. */
  initialModel: string;
  initialAgent?: string | undefined;
  /** Prior-chain messages to paint into Static on a resume (§5.1). */
  resumeMessages?: import("../state.js").ResumeMessage[] | undefined;
  /** The resume "where you left off" context (§5.1). */
  resumeContext?: import("../state.js").ResumeContext | undefined;
  /** The resolved `apps.cli.editor` command for `Ctrl+X` / `/editor` (§3.8). */
  editorCommand?: string | undefined;
  /** Ink suspend/resume/cursor hooks a terminal editor drives around (§3.8). */
  inkControl?: InkControl | undefined;
  /** Test seams for the clipboard/editor subprocesses (§3.7, §3.8). */
  clipboardDeps?: ClipboardDeps | undefined;
  editorDeps?: EditorDeps | undefined;
  /** The SIGWINCH/resize source (§5.2). Defaults to Ink's `useStdout().stdout`
   * (the real terminal). A test injects a controllable EventEmitter whose
   * `columns`/`rows` it can change before emitting `resize`, since
   * ink-testing-library's own stdout reports a fixed width. */
  resizeSource?: (NodeJS.EventEmitter & { columns?: number | undefined; rows?: number | undefined }) | undefined;
}

type Overlay =
  | { kind: "none" }
  | { kind: "panel"; name: string }
  | { kind: "dialog" }
  | { kind: "fanout" }
  | { kind: "monitor" }
  | { kind: "confirm_mode"; agent: TopAgent }
  | {
      kind: "rollback_conflict";
      action: "undo" | "redo" | "goto";
      gotoId?: number;
      movePointer: number;
      conflicts: string[];
    };

/** The App root — holds view state only and derives from events/DTOs (§1.1). */
export function App(props: AppProps): React.ReactElement {
  const [state, setState] = React.useState<ViewState>(() => {
    const s = initialState(props.scrollbackLines);
    const withBanner = withWelcome(
      { ...s, model: props.initialModel, activeAgent: props.initialAgent, reasoningExpanded: props.showThinking },
      {
        version: props.version,
        workspaceRoot: props.workspaceRoot,
        sessionId: props.sessionId,
        branch: null,
        showTips: props.showTips,
        columns: props.caps.columns,
      },
    );
    // On a resume, paint prior turns and the "where you left off" line into
    // Static after the banner (§5.1); otherwise show only the banner.
    if (props.resumeMessages !== undefined || props.resumeContext !== undefined) {
      return seedResume(withBanner, props.resumeMessages ?? [], props.resumeContext ?? {});
    }
    return withBanner;
  });
  const [value, setValue] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [overlay, setOverlay] = React.useState<Overlay>({ kind: "none" });
  // Agent-monitor view state (§6.3): the selected worker index and the live
  // stream lines of the selected worker, pulled from `subagents.stream` on
  // WORKER_STATUS_CHANGED and on selection. A worker resolved individually from
  // the monitor opens its own single-action dialog (latched to one decision).
  const [monitorSelected, setMonitorSelected] = React.useState(0);
  const [streamLines, setStreamLines] = React.useState<WorkerStreamLine[]>([]);
  // The single worker approval currently routed to the individual dialog (opened
  // from the monitor's Enter, §6.3). Null when no individual worker ask is open.
  const [workerDialog, setWorkerDialog] = React.useState<PendingApproval | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [candidateCursor, setCandidateCursor] = React.useState(0);
  const [autocompleteOpen, setAutocompleteOpen] = React.useState(false);
  const [pendingCtrlC, setPendingCtrlC] = React.useState(false);
  const [turnActive, setTurnActive] = React.useState(false);
  // History visual-line navigation (§4.10): offset>0 scrolls the committed
  // buffer up by viewport pages; baseline is the block count when scrolling
  // began, so `↓ N new lines` counts content appended while scrolled up.
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const [scrollBaseline, setScrollBaseline] = React.useState(0);
  // §5.2 / §4.10 — reactive terminal dimensions. Capabilities seed the initial
  // size (detected once at boot), but a SIGWINCH resize must re-render the live
  // region and the status bar at the NEW width or the dim rule and status line
  // garble (overlapping fragments, multiple partial `─` rules) because Ink's
  // `<Static>` and the rule do not repaint on their own. We subscribe to the Ink
  // stdout `resize` event with a short debounce and update `columns`/`rows`, so
  // every width-dependent render (OutputPane, StatusBar, scroll viewport)
  // recomputes once per resize — one rule at the new width, no duplicates.
  const { stdout: inkStdout } = useStdout();
  const stdout =
    props.resizeSource ??
    (inkStdout as unknown as
      | (NodeJS.EventEmitter & { columns?: number; rows?: number })
      | undefined);
  const [dimensions, setDimensions] = React.useState<{ columns: number; rows: number }>({
    columns: props.caps.columns,
    rows: props.caps.rows,
  });
  React.useEffect(() => {
    if (!stdout || typeof stdout.on !== "function") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = (): void => {
      if (timer) clearTimeout(timer);
      // Debounce bursts of resize events (a drag emits many) into one repaint.
      timer = setTimeout(() => {
        setDimensions({
          columns: stdout.columns ?? props.caps.columns,
          rows: stdout.rows ?? props.caps.rows,
        });
      }, 16);
    };
    stdout.on("resize", onResize);
    return () => {
      if (timer) clearTimeout(timer);
      stdout.off?.("resize", onResize);
    };
  }, [stdout, props.caps.columns, props.caps.rows]);
  const columns = dimensions.columns;
  const rows = dimensions.rows;
  const viewportHeight = Math.max(4, Math.floor(rows / 2));
  // Capabilities with the LIVE size, so every width-dependent child (OutputPane
  // wrapping, the status rule) repaints at the new width on a resize (§5.2).
  const liveCaps = React.useMemo<Capabilities>(
    () => ({ ...props.caps, columns, rows }),
    [props.caps, columns, rows],
  );

  // The input index (§3.2/§3.3): one axis over history (negative), the live
  // buffer (0), and slash candidates (positive). Wraps an InputHistory for the
  // 500-cap and adjacent-dedupe. `dropdownKind` distinguishes the slash
  // dropdown (positive index axis) from the file dropdown (Tab; candidateCursor
  // highlight only, not on the index axis).
  const nav = React.useRef(new InputIndex());
  const dropdownKind = React.useRef<"none" | "slash" | "file">("none");
  // The goal column preserved across consecutive vertical (Up/Down) visual-line
  // moves in a multi-line buffer (§3.4 pin 2); null resets it so the next
  // vertical move seeds the goal from the current column. Left/Right/typing
  // reset it; see `resetGoalCol`.
  const goalCol = React.useRef<number | null>(null);
  const ctrlCTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownCommands = React.useRef<string[]>([]);
  // Paths of clipboard images pasted into the current buffer (§3.7); attached
  // as structured input in SendRequest.payload on the next send, then cleared.
  const attachedImages = React.useRef<string[]>([]);
  // Slash autocomplete state (§3.3). The command index is read ONCE when the
  // slash dropdown opens and reused while it stays open (null when closed). A
  // monotonic token guards against async races: a stale `listCommands` result
  // (the buffer changed before it resolved) is dropped, never reopening or
  // overwriting the live dropdown. `escapeDismissed` keeps the dropdown closed
  // after `Escape` until the next edit of the first word.
  const commandIndex = React.useRef<string[] | null>(null);
  const slashToken = React.useRef(0);
  const escapeDismissed = React.useRef(false);
  // The top-level agents the Shift+Tab cycle advances through (§3.5), fetched
  // once from `agents.list()` and kept in a ref so the key handler reads the
  // latest without a stale closure. Sorted order is computed in the cycle.
  const [topAgents, setTopAgents] = React.useState<TopAgent[]>([]);
  const topAgentsRef = React.useRef<TopAgent[]>([]);
  topAgentsRef.current = topAgents;
  // The conversation-mode cycle state (§3.5): the client-tracked current agent
  // name, the managed-forbidden set, and the set of agents already confirmed
  // this session. `chat` is always the start (core §2.7). The DISPLAYED agent is
  // `state.mode`, driven by SESSION_MODE_CHANGED (§5.6); this ref only feeds the
  // next-agent computation and is reconciled from the event.
  const cycleState = React.useRef<CycleState>({
    current: "chat",
    forbidden: new Set<string>(),
    confirmed: new Set<string>(),
  });
  // Live mirrors so a burst of keystrokes and the submit handler read the
  // latest buffer/cursor rather than a stale render closure.
  const valueRef = React.useRef(value);
  const cursorRef = React.useRef(cursor);
  valueRef.current = value;
  cursorRef.current = cursor;

  // The two scoped subscriptions, wired once (§1.4). An endpoint resolver
  // (model name → baseUrl/modelId) is snapshotted from `models.list()` so a
  // MODEL_ERROR can be rendered with WHICH endpoint failed, with no config read
  // in the render path (§10.1).
  React.useEffect(() => {
    const endpoints = new Map<string, { baseUrl?: string | undefined; modelId?: string | undefined }>();
    const resolveEndpoint = (name: string): { baseUrl?: string | undefined; modelId?: string | undefined } =>
      endpoints.get(name) ?? {};
    void props.api.models.list().then((r) => {
      if (r.ok) {
        for (const m of r.value as Array<{ name: string; model?: string; baseUrl?: string }>) {
          endpoints.set(m.name, { baseUrl: m.baseUrl, modelId: m.model });
        }
      }
    });
    // §4.2/§10.7 — snapshot the configured per-model price map once (no config
    // read in the render path). The footer `$cost` shows only for a priced
    // active model; `resolvePrice` maps a model name to its price or null, and
    // the price view effect is dispatched at startup and on each MODEL_CHANGED.
    const prices = new Map<string, { costPer1kInput?: number; costPer1kOutput?: number }>();
    const resolvePrice = (name: string): { costPer1kInput?: number; costPer1kOutput?: number } | null => {
      const p = prices.get(name);
      if (!p || (p.costPer1kInput === undefined && p.costPer1kOutput === undefined)) return null;
      return p;
    };
    void props.api.config.get("models").then((r) => {
      if (r.ok && r.value && typeof r.value === "object") {
        for (const [name, e] of Object.entries(r.value as Record<string, { costPer1kInput?: number; costPer1kOutput?: number }>)) {
          const price: { costPer1kInput?: number; costPer1kOutput?: number } = {};
          if (typeof e?.costPer1kInput === "number") price.costPer1kInput = e.costPer1kInput;
          if (typeof e?.costPer1kOutput === "number") price.costPer1kOutput = e.costPer1kOutput;
          prices.set(name, price);
        }
        setState((prev) => reduce(prev, { type: "model_price", price: resolvePrice(props.initialModel) }));
      }
    });
    const unsub = subscribe(
      props.api,
      props.sessionId,
      (effect) => {
        setState((prev) => reduce(prev, effect));
        if (effect.type === "turn_complete" || effect.type === "turn_cancelled" || effect.type === "error") {
          setTurnActive(false);
        }
        // §4.2/§10.7 — a model switch re-points the footer price to the new
        // active endpoint's configured price (or null when it has none).
        if (effect.type === "model_changed") {
          setState((prev) => reduce(prev, { type: "model_price", price: resolvePrice(effect.name) }));
        }
        // §5.6 — the event is the single source of truth: keep the cycle ref's
        // `current` in step with any accepted mode change, including one a host
        // made elsewhere, so the next `Shift+Tab` advances from the real mode.
        if (effect.type === "session_mode_changed") {
          cycleState.current = { ...cycleState.current, current: effect.to };
        }
      },
      resolveEndpoint,
    );
    void props.api.session.listCommands().then((r) => {
      if (r.ok) knownCommands.current = r.value;
    });
    // §3.5/§5.2 — the top-level agents the cycle advances over and the status
    // bar bracket resolves its label/colour from. Data-driven: `kind` filters
    // top-level, and the bracket colour keys on `unlisted: allow`.
    void props.api.agents.list().then((r) => {
      if (r.ok) {
        const tops = (r.value as TopAgent[] & { kind?: string }[])
          .filter((a) => (a as { kind?: string }).kind === "top-level")
          .map((a) => ({
            name: a.name,
            ...(a.label !== undefined ? { label: a.label } : {}),
            ...(a.unlisted !== undefined ? { unlisted: a.unlisted } : {}),
            ...(a.confirm !== undefined ? { confirm: a.confirm } : {}),
            ...(a.order !== undefined ? { order: a.order } : {}),
            ...((a as { source?: TopAgent["source"] }).source !== undefined
              ? { source: (a as { source?: TopAgent["source"] }).source }
              : {}),
            ...((a as { file?: string }).file !== undefined ? { file: (a as { file?: string }).file } : {}),
          }));
        setTopAgents(tops);
      }
    });
    return unsub;
  }, [props.api, props.sessionId]);

  // The approval dialog opens whenever an approval request is present.
  React.useEffect(() => {
    if (props.approvalRequest) setOverlay({ kind: "dialog" });
    else setOverlay((o) => (o.kind === "dialog" ? { kind: "none" } : o));
  }, [props.approvalRequest]);

  // §4.2/§6.1 — while ANY approval or question is pending (a single action, a
  // worker ask routed to the single dialog, or a fan-out batch) the status line
  // reads `Waiting for approval` with a frozen timer and no spinner. Toggle the
  // view-state flag from the live approval sources so the pure reducer owns the
  // display and the normal verb is restored the instant the dialog resolves.
  const approvalPending =
    Boolean(props.approvalRequest) || workerDialog !== null || (props.workerApprovals?.length ?? 0) >= 1;
  React.useEffect(() => {
    setState((prev) => reduce(prev, { type: "approval_pending", pending: approvalPending }));
  }, [approvalPending]);

  // §6.2 — a fan-out with two or more pending worker approvals opens the BATCHED
  // prompt (one a/f/c/x decision) instead of N serial single dialogs. One
  // pending worker ask with no batch falls through to the single-action dialog
  // via `approvalRequest` (the bridge sets it for a lone worker ask). The batch
  // never steals focus from an individual worker dialog opened via the monitor.
  const workerApprovals = props.workerApprovals ?? [];
  React.useEffect(() => {
    if (workerApprovals.length >= 2) {
      setOverlay((o) => (o.kind === "monitor" || o.kind === "dialog" ? o : { kind: "fanout" }));
      setWorkerDialog(null);
    } else if (workerApprovals.length === 1) {
      // A lone worker ask with no batch uses the single-action dialog (§6.1),
      // carrying its `workerId`; not the batched prompt (which needs two+).
      setOverlay((o) => (o.kind === "fanout" ? { kind: "none" } : o));
      setWorkerDialog((d) => d ?? workerApprovals[0]!);
    } else {
      setOverlay((o) => (o.kind === "fanout" ? { kind: "none" } : o));
      setWorkerDialog(null);
    }
  }, [workerApprovals.length]);

  // §6.3 — while the monitor is open, pull the selected worker's live stream
  // from `subagents.stream` as worker status changes. The stream carries reads,
  // writes with diffs, and the final summary (core §7.2); the monitor renders it
  // scrollably. One cheap snapshot per status change keeps render synchronous.
  const workersKey = state.workers.map((w) => `${w.workerId}:${w.status}`).join(",");
  React.useEffect(() => {
    if (overlay.kind !== "monitor") return;
    const sel = state.workers[monitorSelected];
    if (!sel) {
      setStreamLines([]);
      return;
    }
    let cancelled = false;
    void props.api.subagents.stream(sel.workerId).then((r) => {
      if (cancelled) return;
      const events = r.ok ? (r.value as { workerId: string; kind: string; text?: string; status?: string }[]) : [];
      setStreamLines(
        events.map((e) => ({ workerId: e.workerId, text: e.text ?? e.status ?? e.kind })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [overlay.kind, monitorSelected, workersKey, props.api]);

  const clearBuffer = (): void => {
    valueRef.current = "";
    cursorRef.current = 0;
    setValue("");
    setCursor(0);
    setAutocompleteOpen(false);
    setCandidates([]);
    setCandidateCursor(0);
    dropdownKind.current = "none";
    nav.current.setCandidateCount(0);
    attachedImages.current = [];
  };

  const submit = async (buffer: string): Promise<void> => {
    const trimmed = buffer.trim();
    if (trimmed === "") return; // empty submit never starts a turn (§3.1)
    setScrollOffset(0); // any submit returns to the live bottom (§4.10)
    const images = attachedImages.current.slice(); // capture before clearBuffer
    // Push the submitted text (the edited scratch at a negative index, or the
    // live/candidate text at 0) and reset the index to 0 (§3.2). The rendered
    // buffer already equals the text to submit; sync it into the navigator so
    // `submit` pushes and resets through the single source of truth.
    nav.current.edit(buffer);
    nav.current.submit();
    clearBuffer();

    if (trimmed.startsWith("/")) {
      const cmd = parseCommand(trimmed);
      if (!cmd) return;
      const outcome = await dispatchCommand(props.api, props.sessionId, cmd, knownCommands.current);
      switch (outcome.kind) {
        case "open_panel":
          setOverlay({ kind: "panel", name: outcome.name });
          break;
        case "system_message":
          setState((prev) => reduce(prev, { type: "system_block", text: outcome.text }));
          break;
        case "rollback_conflict":
          setOverlay({
            kind: "rollback_conflict",
            action: outcome.action,
            ...(outcome.gotoId !== undefined ? { gotoId: outcome.gotoId } : {}),
            movePointer: outcome.movePointer,
            conflicts: outcome.conflicts,
          });
          break;
        case "editor":
          void doCompose();
          break;
        case "open_file":
          void doEditFile(outcome.path);
          break;
        case "quit":
          await props.api.session.shutdown();
          props.onQuit();
          break;
        case "unknown":
          setState((prev) =>
            reduce(prev, { type: "warning", category: "cli", message: `Unknown command: /${outcome.name} — /help for the command list` }),
          );
          break;
        case "error":
          setState((prev) => reduce(prev, { type: "error", source: "engine", message: outcome.message }));
          break;
        default:
          break;
      }
      return;
    }

    // A normal turn: exactly one CoreAPI op (§1.1).
    setState((prev) => pushUser(prev, buffer));
    setTurnActive(true);
    // Attach any pasted clipboard images as structured input (§3.7, §2.3); the
    // core adds a vision block only when the active model supports vision.
    const req =
      images.length > 0
        ? { input: buffer, payload: { images: images.map((path) => ({ type: "image", path })) } }
        : { input: buffer };
    const res = await props.api.session.send(props.sessionId, req);
    if (!res.ok) {
      setState((prev) => reduce(prev, { type: "error", source: "engine", message: res.error.message }));
      setTurnActive(false);
    }
  };

  const refreshCandidates = async (buffer: string): Promise<void> => {
    if (buffer.startsWith("/")) {
      // A `/`-led buffer behaves as typing would: open/refilter the slash
      // dropdown from the command index (§3.3 pin 5), never the file index.
      syncSlash(buffer, cursorRef.current);
      return;
    }
    const files = await props.api.workspace.files();
    setCandidates(completeFiles(buffer, files.ok ? files.value : []));
    setCandidateCursor(0);
    setAutocompleteOpen(true);
    dropdownKind.current = "file"; // file completion is not on the index axis
  };

  const setBuffer = (v: string, c: number): void => {
    valueRef.current = v;
    cursorRef.current = c;
    setValue(v);
    setCursor(c);
  };

  /**
   * Render the buffer and candidate highlight from the navigator after an
   * index move (§3.2/§3.3). At a positive index the input previews the
   * highlighted candidate's `/{name}` and the dropdown stays open and filtered
   * by the live buffer (the candidate list is unchanged; only the highlighted
   * row moves). At `0` or a negative index the input shows that index's text;
   * returning to `0` re-evaluates the slash dropdown from the live buffer
   * (pin 4). A negative index never opens the dropdown.
   */
  const syncFromNav = (): void => {
    const i = nav.current.index;
    const labels = candidates.map((c) => c.value);
    if (i > 0) {
      const text = nav.current.textAt(labels);
      setBuffer(text, text.length);
      setCandidateCursor(i - 1); // +1 highlights row 0
      return;
    }
    // i <= 0: show the index's text; the dropdown opens only at 0, from the
    // live buffer (a recalled history entry, i < 0, shows no dropdown).
    const text = nav.current.textAt();
    setBuffer(text, text.length);
    if (i === 0) {
      setCandidateCursor(0);
      if (slashEligible(text, text.length)) syncSlash(text, text.length);
      else {
        dropdownKind.current = "none";
        nav.current.setCandidateCount(0);
        setAutocompleteOpen(false);
        setCandidates([]);
      }
    } else {
      // Negative index: a recalled entry opens no dropdown (pin 4).
      dropdownKind.current = "none";
      nav.current.setCandidateCount(0);
      setAutocompleteOpen(false);
      setCandidates([]);
    }
  };

  /** Whether a `/`-led buffer has the cursor in its first word (§3.3): the
   * slash dropdown is eligible only then. A space in the word (argument entry)
   * or a buffer that no longer begins with `/` makes it ineligible. */
  const slashEligible = (buffer: string, cursor: number): boolean => {
    if (!buffer.startsWith("/")) return false;
    const firstSpace = buffer.search(/\s/);
    return firstSpace === -1 || cursor <= firstSpace;
  };

  /** The first-word query (with its leading `/`) the dropdown filters on. */
  const slashQuery = (buffer: string): string => {
    const firstSpace = buffer.search(/\s/);
    return firstSpace === -1 ? buffer : buffer.slice(0, firstSpace);
  };

  /**
   * Reconcile the slash dropdown after an edit of the first word (§3.3 pin 1).
   * Opens as `/` is typed and refilters on every edit; the command index is
   * read ONCE on open and reused while open (pin 3). Closes on a space in the
   * word, a buffer no longer led by `/`, zero matches, or an `Escape` that has
   * not yet been superseded by a fresh edit. Async races are dropped by token.
   */
  const syncSlash = (buffer: string, cursor: number): void => {
    if (!slashEligible(buffer, cursor)) {
      // No longer a slash first-word context: close and forget the index.
      commandIndex.current = null;
      escapeDismissed.current = false;
      slashToken.current++; // invalidate any in-flight fetch
      dropdownKind.current = "none";
      nav.current.setCandidateCount(0);
      setAutocompleteOpen(false);
      setCandidates([]);
      return;
    }
    // An edit of the word supersedes a prior Escape dismissal (pin 1).
    escapeDismissed.current = false;
    const render = (list: string[]): void => {
      const matches = completeCommands(slashQuery(buffer), list);
      if (matches.length === 0) {
        dropdownKind.current = "none";
        nav.current.setCandidateCount(0);
        setAutocompleteOpen(false);
        setCandidates([]);
        return;
      }
      setCandidates(matches);
      setCandidateCursor(0);
      setAutocompleteOpen(true);
      // The slash candidates are the positive axis of the index (§3.3); feed
      // the navigator their count so Down can walk into them and clamp.
      dropdownKind.current = "slash";
      nav.current.setCandidateCount(matches.length);
    };
    if (commandIndex.current !== null) {
      render(commandIndex.current); // reuse the cached index while open
      return;
    }
    // First open: read the index once, guarded against an async race — a result
    // for a buffer that has since changed must not open/overwrite the dropdown.
    const token = ++slashToken.current;
    void props.api.session.listCommands().then((cmds) => {
      if (token !== slashToken.current) return; // stale: the buffer moved on
      const list = cmds.ok ? cmds.value : [];
      commandIndex.current = list;
      // Re-read the live buffer: it may have advanced while awaiting (same word).
      const v = valueRef.current;
      const c = cursorRef.current;
      // The dropdown opens only at index 0 (pin 4); a move to a recalled entry
      // or a candidate preview while awaiting must not reopen it.
      if (nav.current.index !== 0 || !slashEligible(v, c) || escapeDismissed.current) return;
      render(list);
    });
  };

  const insertChar = (ch: string): void => {
    const clean = ch.replace(/\r\n/g, "\n").replace(/[^\P{Cc}\n\t]/gu, "");
    // Typing at a positive index accepts the previewed candidate into the live
    // buffer (index 0) first, then applies the keystroke there (§3.3 pin 3).
    if (nav.current.index > 0) {
      const accepted = nav.current.textAt(candidates.map((c) => c.value));
      nav.current.accept(accepted);
      setBuffer(accepted, accepted.length);
    }
    const v = valueRef.current;
    const c = cursorRef.current;
    const nv = v.slice(0, c) + clean + v.slice(c);
    const nc = c + clean.length;
    setBuffer(nv, nc);
    // Record the edit on the index axis: live buffer at 0, scratch at -n (§3.2).
    nav.current.edit(nv);
    // A slash first-word edit opens/refilters the dropdown (§3.3 pin 1); any
    // other insert that was showing a (file) dropdown closes it (pin 2). The
    // dropdown opens only at index 0 (pin 4) — an edit always lands at 0.
    if (nav.current.index === 0 && slashEligible(nv, nc) && !clean.includes("\n")) syncSlash(nv, nc);
    else if (autocompleteOpen) {
      setAutocompleteOpen(false);
      commandIndex.current = null;
      dropdownKind.current = "none";
      nav.current.setCandidateCount(0);
    }
  };

  /** After a destructive edit (backspace/delete): refilter the slash dropdown
   * when still in a slash first word, else close a stale (file) dropdown — the
   * file dropdown closes on the next edit (§3.3 pin 2). */
  const afterEdit = (buffer: string, cursor: number): void => {
    nav.current.edit(buffer); // record on the index axis (live at 0, scratch at -n)
    if (nav.current.index === 0 && slashEligible(buffer, cursor)) syncSlash(buffer, cursor);
    else if (autocompleteOpen) {
      setAutocompleteOpen(false);
      commandIndex.current = null;
      dropdownKind.current = "none";
      nav.current.setCandidateCount(0);
    }
  };

  const handleCtrlC = (): void => {
    // During a turn: first Ctrl+C cancels, a second within 1s shuts down (§3.9).
    // Idle (no active turn): first Ctrl+C arms "press ctrl+c again to exit", a
    // second within 1s shuts down and exits 130 — Ctrl+C never silently no-ops.
    if (!pendingCtrlC) {
      if (turnActive) void props.api.session.cancel(props.sessionId);
      setPendingCtrlC(true);
      ctrlCTimer.current = setTimeout(() => setPendingCtrlC(false), 1000);
      return;
    }
    if (ctrlCTimer.current) clearTimeout(ctrlCTimer.current);
    void props.api.session.shutdown().then(() => props.onQuit(EXIT.SIGINT));
  };

  // Ctrl+V: read a clipboard image, cache it, insert a reference token, and
  // stage its path for the next send's payload (§3.7). A miss is a silent no-op.
  const doPasteImage = async (): Promise<void> => {
    const result = await pasteClipboardImage(
      props.workspaceRoot,
      props.sessionId,
      props.clipboardDeps ?? {},
    );
    if (!result) return; // no tool / no image / not a PNG — silent no-op
    attachedImages.current = [...attachedImages.current, result.path];
    const v = valueRef.current;
    const c = cursorRef.current;
    const token = (c > 0 && v[c - 1] !== " " ? " " : "") + result.token + " ";
    setBuffer(v.slice(0, c) + token + v.slice(c), c + token.length);
  };

  // Ctrl+X / /editor: compose the buffer in an external editor and return the
  // edited text to InputBar (§3.8). No editor configured is a silent no-op.
  const doCompose = async (): Promise<void> => {
    const edited = await composeInEditor(valueRef.current, props.editorCommand, {
      ...(props.editorDeps ?? {}),
      ...(props.inkControl ? { ink: props.inkControl } : {}),
    });
    setBuffer(edited, edited.length);
  };

  // `/config edit`: open an existing file (the project config) in the external
  // editor (§7.3, §3.8). No editor configured is a silent no-op with a dim hint.
  const doEditFile = async (path: string): Promise<void> => {
    const launched = await editFile(path, props.editorCommand, {
      ...(props.editorDeps ?? {}),
      ...(props.inkControl ? { ink: props.inkControl } : {}),
    });
    if (!launched) {
      setState((prev) =>
        reduce(prev, { type: "warning", category: "cli", message: "no editor configured — set apps.cli.editor or $VISUAL/$EDITOR" }),
      );
    }
  };

  // Shift+Tab cycles the top-level agents (§3.5). The displayed bracket follows
  // SESSION_MODE_CHANGED (§5.6); here we only drive `session.setMode` and open
  // the first-entry confirmation (§6) or show the dim busy notice (§3.5).
  const doCycleMode = async (): Promise<void> => {
    const { outcome, state: next } = await cycleMode(
      props.api,
      props.sessionId,
      topAgentsRef.current,
      cycleState.current,
    );
    cycleState.current = next;
    switch (outcome.kind) {
      case "confirm":
        setOverlay({ kind: "confirm_mode", agent: outcome.agent });
        break;
      case "busy":
        setState((prev) => reduce(prev, { type: "mode_notice", message: MODE_CHANGE_BUSY_NOTICE }));
        break;
      case "changed":
      case "unchanged":
        // On `changed` the SESSION_MODE_CHANGED event drives the bracket; on
        // `unchanged` nothing moves. Either way the ref is already reconciled.
        break;
    }
  };

  // The first-entry confirmation resolved (§6): `y` enters the agent, `n`/Escape
  // cancel and leave the active agent unchanged.
  const resolveModeConfirm = async (agentName: string, enable: boolean): Promise<void> => {
    setOverlay({ kind: "none" });
    if (!enable) return;
    const { outcome, state: next } = await enterAgent(
      props.api,
      props.sessionId,
      topAgentsRef.current,
      agentName,
      cycleState.current,
    );
    cycleState.current = next;
    if (outcome.kind === "busy") {
      setState((prev) => reduce(prev, { type: "mode_notice", message: MODE_CHANGE_BUSY_NOTICE }));
    }
  };

  /** Resolve the rollback conflict dialog (§7.5): `y` re-runs the op with the
   * conflicting paths confirmed for overwrite (all-or-nothing); `n`/`Esc` leaves
   * the tree untouched. Starts no model turn. */
  const resolveRollbackConflict = async (
    conflict: { action: "undo" | "redo" | "goto"; gotoId?: number; conflicts: string[] },
    overwrite: boolean,
  ): Promise<void> => {
    setOverlay({ kind: "none" });
    if (!overwrite) return; // refused → nothing changes
    const res = await confirmRollback(
      props.api,
      props.sessionId,
      conflict.action,
      conflict.conflicts,
      conflict.gotoId,
    );
    if (res.kind === "system_message") {
      setState((prev) => reduce(prev, { type: "system_block", text: res.text }));
    } else if (res.kind === "error") {
      setState((prev) => reduce(prev, { type: "error", source: "engine", message: res.message }));
    }
  };

  /**
   * Resolve the batched fan-out prompt (§6.2). `a` approves every pending
   * worker ask; `f` approves them all (the core already opened the fan-out grant
   * at dispatch, so no extra core call is needed — a force-ask is immune to it
   * regardless); `c` opens the monitor to resolve each worker in turn; `x`
   * rejects the batch (cancelling the workers). The CLI NEVER builds the grant
   * or lifts an always-ask class — it only returns approve/reject per request.
   */
  const resolveFanout = (choice: FanoutChoice): void => {
    const batch = props.workerApprovals ?? [];
    switch (choice) {
      case "approve_all":
      case "approve_all_and_grant":
        for (const p of batch) props.onWorkerResolve?.(p.id, { requestId: p.id, decision: "approve" });
        setOverlay({ kind: "none" });
        break;
      case "review_individually":
        setOverlay({ kind: "monitor" });
        break;
      case "cancel":
        for (const p of batch) props.onWorkerResolve?.(p.id, { requestId: p.id, decision: "reject" });
        setOverlay({ kind: "none" });
        break;
    }
  };

  // §6.3 — resolve one worker's approval from the monitor (Enter on a
  // needs-review worker). Open that worker's full action in the single-action
  // dialog; the dialog's decision routes back through `onWorkerResolve`.
  const openWorkerDialog = (workerId: string): void => {
    const pending = (props.workerApprovals ?? []).find((p) => p.workerId === workerId);
    if (pending) setWorkerDialog(pending);
  };

  /** Complete the highlighted candidate with a trailing space and close the
   * dropdown (§3.3 pin 5), forgetting the cached command index. */
  const completeHighlighted = (): void => {
    const chosen = candidates[candidateCursor];
    if (chosen) {
      const next = chosen.value + " ";
      // Complete at index 0 (§3.3 pin 3): the completed text becomes the live
      // buffer (accept resets the index to 0 even when completing from +n).
      nav.current.accept(next);
      setBuffer(next, next.length);
    }
    setAutocompleteOpen(false);
    setCandidates([]);
    commandIndex.current = null;
    escapeDismissed.current = false;
    dropdownKind.current = "none";
    nav.current.setCandidateCount(0);
  };

  const onKey = (key: InputKey): void => {
    const v = valueRef.current;
    const c = cursorRef.current;
    // A transient mode-change refusal notice (§3.5) clears on the next key.
    if (state.modeNotice && key.type !== "shift_tab") {
      setState((prev) => (prev.modeNotice ? { ...prev, modeNotice: null } : prev));
    }
    // The vertical goal column (§3.4 pin 2) survives only a run of Up/Down;
    // any other key (Left/Right, typing, Home/End, …) resets it.
    if (key.type !== "up" && key.type !== "down") goalCol.current = null;
    switch (key.type) {
      case "char":
        insertChar(key.value);
        break;
      case "backspace":
        if (c > 0) {
          const nv = v.slice(0, c - 1) + v.slice(c);
          const nc = c - 1;
          setBuffer(nv, nc);
          afterEdit(nv, nc);
        }
        break;
      case "delete": {
        const nv = v.slice(0, c) + v.slice(c + 1);
        setBuffer(nv, c);
        afterEdit(nv, c);
        break;
      }
      case "left": {
        const nc = Math.max(0, c - 1);
        setBuffer(v, nc);
        if (slashEligible(v, nc)) syncSlash(v, nc);
        break;
      }
      case "right": {
        const nc = Math.min(v.length, c + 1);
        setBuffer(v, nc);
        if (slashEligible(v, nc)) syncSlash(v, nc);
        break;
      }
      case "home":
        setBuffer(v, 0);
        if (slashEligible(v, 0)) syncSlash(v, 0);
        break;
      case "end":
        setBuffer(v, v.length);
        if (slashEligible(v, v.length)) syncSlash(v, v.length);
        break;
      case "up": {
        // The file dropdown is not on the index axis (§3.3): Up/Down move its
        // highlight only. The slash dropdown and history share the one index
        // axis (§3.2/§3.3): Up walks 0→-1→-2… and +n→+(n-1)→0.
        if (autocompleteOpen && dropdownKind.current === "file") {
          setCandidateCursor((cc) => Math.max(0, cc - 1));
          break;
        }
        // Keep the navigator's candidate count in step with the open slash
        // dropdown (the count may have been set from an async render).
        nav.current.setCandidateCount(
          autocompleteOpen && dropdownKind.current === "slash" ? candidates.length : 0,
        );
        // Multi-line visual navigation (§3.2/§3.4): on a multi-line buffer at
        // index 0 or a recalled history entry (pin 5), Up moves the cursor one
        // visual line up, keeping the goal column (pin 2). Only on the FIRST
        // visual line (a null move) does it fall through to the index axis
        // (pin 3). The slash dropdown (positive axis) owns Up unchanged (pin 4).
        const slashUp = autocompleteOpen && dropdownKind.current === "slash";
        if (!slashUp && nav.current.index <= 0) {
          const mv = verticalMove(v, c, Math.max(1, columns - 2), "up", goalCol.current);
          if (mv) {
            goalCol.current = mv.goalCol;
            setBuffer(v, mv.cursor);
            break;
          }
        }
        nav.current.setLive(v); // keep the live buffer aside before leaving 0
        const beforeU = nav.current.index;
        const afterU = nav.current.up();
        if (afterU !== beforeU) syncFromNav();
        break;
      }
      case "down": {
        if (autocompleteOpen && dropdownKind.current === "file") {
          setCandidateCursor((cc) => Math.min(candidates.length - 1, cc + 1));
          break;
        }
        nav.current.setCandidateCount(
          autocompleteOpen && dropdownKind.current === "slash" ? candidates.length : 0,
        );
        // Multi-line visual navigation (§3.2/§3.4): Down moves one visual line
        // down, keeping the goal column; only on the LAST visual line (a null
        // move) does it fall through to the index axis (pin 3). The slash
        // dropdown (positive axis) owns Down unchanged (pin 4).
        const slashDown = autocompleteOpen && dropdownKind.current === "slash";
        if (!slashDown && nav.current.index <= 0) {
          const mv = verticalMove(v, c, Math.max(1, columns - 2), "down", goalCol.current);
          if (mv) {
            goalCol.current = mv.goalCol;
            setBuffer(v, mv.cursor);
            break;
          }
        }
        nav.current.setLive(v);
        const beforeD = nav.current.index;
        const afterD = nav.current.down();
        if (afterD !== beforeD) syncFromNav();
        break;
      }
      case "newline":
        insertChar("\n");
        break;
      case "submit":
        void submit(valueRef.current);
        break;
      case "tab":
        // With a dropdown open, Tab completes the highlighted candidate (§3.3
        // pin 5); closed, it opens file completion — or, for a `/`-led buffer,
        // the slash dropdown (refreshCandidates routes by the buffer).
        if (autocompleteOpen) completeHighlighted();
        else void refreshCandidates(valueRef.current);
        break;
      case "autocomplete_select": {
        // Enter with the dropdown open completes the highlighted candidate with
        // a trailing space and closes it; a second Enter submits (§3.3 pin 5).
        completeHighlighted();
        break;
      }
      case "shift_tab":
        void doCycleMode();
        break;
      case "toggle_reasoning":
        setState((prev) => ({ ...prev, reasoningExpanded: !prev.reasoningExpanded }));
        break;
      case "toggle_tools":
        setState((prev) => ({ ...prev, toolGroupExpanded: !prev.toolGroupExpanded }));
        break;
      case "open_monitor":
        // §6.3 — Ctrl+G toggles the agent monitor overlay. It never opens over a
        // policy dialog or the batched prompt; Esc (handled below) closes it.
        setOverlay((o) =>
          o.kind === "monitor" ? { kind: "none" } : o.kind === "none" || o.kind === "fanout" ? { kind: "monitor" } : o,
        );
        break;
      case "escape":
        if (autocompleteOpen) {
          // Escape at a positive index (previewing a slash candidate) returns
          // to 0 with the live text restored (§3.3 pin 3); the dropdown is then
          // dismissed and kept closed until the next edit of the word.
          if (nav.current.index > 0) {
            nav.current.toLive();
            const text = nav.current.textAt();
            setBuffer(text, text.length);
          }
          // Dismiss the dropdown; for a slash context keep it closed until the
          // next edit of the word (§3.3 pin 1).
          setAutocompleteOpen(false);
          setCandidates([]);
          commandIndex.current = null;
          dropdownKind.current = "none";
          nav.current.setCandidateCount(0);
          if (slashEligible(valueRef.current, cursorRef.current)) escapeDismissed.current = true;
        } else if (overlay.kind !== "none") setOverlay({ kind: "none" });
        else if (turnActive) void props.api.session.cancel(props.sessionId);
        break;
      case "ctrl_c":
        handleCtrlC();
        break;
      case "paste_image":
        void doPasteImage();
        break;
      case "compose":
        void doCompose();
        break;
      case "page_up":
        setScrollOffset((o) => {
          // Capture the display-LINE count at scroll-start so the §4.10
          // indicator counts new display LINES below the window (including
          // progressively-committed streamed fragments), not block count.
          if (o === 0) setScrollBaseline(blockLineCount(state.blocks));
          const max = Math.max(0, blockLineCount(state.blocks) - 1);
          return Math.min(max, o + viewportHeight);
        });
        break;
      case "page_down":
        setScrollOffset((o) => Math.max(0, o - viewportHeight));
        break;
      case "half_page_up":
        // §4.4 — while a live fan-out panel is up, Ctrl+U moves the selection up
        // (navigate only). Otherwise it keeps its default: scroll the committed
        // buffer by half a viewport page (§4.10). Ctrl+D (EOF in some terminals)
        // is only ever a selection/scroll key here — the input never reads it as
        // EOF, so it cannot exit.
        if (state.fanout && state.fanout.rows.length >= 2) {
          setState((prev) => reduce(prev, { type: "fanout_select", delta: -1 }));
          break;
        }
        setScrollOffset((o) => {
          if (o === 0) setScrollBaseline(blockLineCount(state.blocks));
          const max = Math.max(0, blockLineCount(state.blocks) - 1);
          return Math.min(max, o + Math.max(1, Math.floor(viewportHeight / 2)));
        });
        break;
      case "half_page_down":
        // §4.4 — while a live fan-out panel is up, Ctrl+D moves the selection
        // down (navigate only); otherwise scroll down half a page.
        if (state.fanout && state.fanout.rows.length >= 2) {
          setState((prev) => reduce(prev, { type: "fanout_select", delta: 1 }));
          break;
        }
        setScrollOffset((o) => Math.max(0, o - Math.max(1, Math.floor(viewportHeight / 2))));
        break;
      case "scroll_bottom":
        setScrollOffset(0); // End returns to the live bottom (§4.10)
        break;
    }
  };

  const inputActive = overlay.kind === "none";

  return (
    <Box flexDirection="column">
      {state.housekeeping && state.housekeeping.idleSessions > 0 ? (
        <Text {...(props.theme.dim ? { color: props.theme.dim } : {})}>
          {props.glyphs.info} {state.housekeeping.idleSessions} sessions idle over {state.housekeeping.idleDays} days — /sessions to review
        </Text>
      ) : null}
      <OutputPane
        state={state}
        theme={props.theme}
        glyphs={props.glyphs}
        caps={liveCaps}
        reduceMotion={props.reduceMotion}
        showToolDetails={props.showToolDetails}
        workspaceRoot={props.workspaceRoot}
        scroll={{ offset: scrollOffset, height: viewportHeight, baseline: scrollBaseline }}
        columns={columns}
        {...(props.workerApprovals ? { workerApprovals: props.workerApprovals } : {})}
      />
      {overlay.kind === "panel" ? (
        <PanelHost
          name={overlay.name}
          registry={props.panels}
          onClose={() => setOverlay({ kind: "none" })}
          theme={props.theme}
          glyphs={props.glyphs}
          columns={columns}
          rows={rows}
        />
      ) : null}
      {overlay.kind === "dialog" && props.approvalRequest && props.onApprovalResolve ? (
        <ConfirmationDialog
          request={props.approvalRequest}
          onResolve={(r) => {
            props.onApprovalResolve!(r);
            setOverlay({ kind: "none" });
          }}
          theme={props.theme}
          glyphs={props.glyphs}
          columns={dimensions.columns}
          onReveal={(text) => setState((p) => reduce(p, { type: "system_block", text }))}
          autoDenySeconds={props.autoDenySeconds}
        />
      ) : null}
      {overlay.kind === "fanout" && props.workerApprovals && props.workerApprovals.length > 0 ? (
        <FanoutApproval
          pending={props.workerApprovals}
          onChoice={resolveFanout}
          theme={props.theme}
          glyphs={props.glyphs}
          autoDenySeconds={props.autoDenySeconds}
        />
      ) : null}
      {overlay.kind === "monitor" && !workerDialog ? (
        <AgentMonitor
          workers={state.workers}
          selected={monitorSelected}
          streamLines={streamLines}
          onSelect={setMonitorSelected}
          onResolve={openWorkerDialog}
          onClose={() => setOverlay({ kind: "none" })}
          theme={props.theme}
          glyphs={props.glyphs}
        />
      ) : null}
      {workerDialog && props.onWorkerResolve ? (
        <ConfirmationDialog
          request={workerDialog}
          onResolve={(r) => {
            props.onWorkerResolve!(workerDialog.id, r);
            setWorkerDialog(null);
          }}
          theme={props.theme}
          glyphs={props.glyphs}
          columns={dimensions.columns}
          onReveal={(text) => setState((p) => reduce(p, { type: "system_block", text }))}
          autoDenySeconds={props.autoDenySeconds}
        />
      ) : null}
      {overlay.kind === "confirm_mode" ? (
        <ConfirmModeDialog
          agent={overlay.agent}
          onResolve={(enable) => void resolveModeConfirm(overlay.agent.name, enable)}
          theme={props.theme}
        />
      ) : null}
      {overlay.kind === "rollback_conflict" ? (
        <RollbackConflictDialog
          action={overlay.action}
          movePointer={overlay.movePointer}
          conflicts={overlay.conflicts}
          onResolve={(overwrite) =>
            void resolveRollbackConflict(
              {
                action: overlay.action,
                ...(overlay.gotoId !== undefined ? { gotoId: overlay.gotoId } : {}),
                conflicts: overlay.conflicts,
              },
              overwrite,
            )
          }
          theme={props.theme}
        />
      ) : null}
      {state.modeNotice ? (
        <Text {...(props.theme.dim ? { color: props.theme.dim } : {})}>{state.modeNotice}</Text>
      ) : null}
      <InputBar
        value={value}
        cursor={cursor}
        active={inputActive}
        turnActive={turnActive}
        pendingCtrlC={pendingCtrlC}
        autocompleteOpen={autocompleteOpen}
        candidates={candidates}
        candidateCursor={candidateCursor}
        columns={columns}
        theme={props.theme}
        placeholder="ask a question or describe a task"
        {...(overlay.kind === "panel" ? { inactiveNotice: "panel open · esc to close" } : {})}
        onKey={onKey}
      />
      <StatusBar
        state={state}
        topAgents={topAgents}
        workspaceRoot={props.workspaceRoot}
        width={columns}
        theme={props.theme}
        glyphs={props.glyphs}
      />
    </Box>
  );
}
