/**
 * Terminal capability detection and cursor control
 * (cli-blueprint.md §1.5, §4.9, §4.10, §10.2).
 *
 * Capabilities are detected once at boot from the environment and threaded
 * through every renderer (§4.9); nothing re-queries the terminal mid-session.
 * The CLI renders INLINE on the primary screen — it never enters the alternate
 * screen — so the terminal's native scrollback, mouse wheel/trackpad and text
 * selection keep working (§1.5 step 2, §4.10). The controller therefore owns
 * only the cursor: it hides the cursor while Ink draws (so Ink's inverse-video
 * block cursor is the only one shown) and guarantees the cursor is restored on
 * every exit path — clean, SIGINT, SIGTERM, and an uncaught exception — so a
 * crash never strands the user with a hidden cursor (§10.2).
 */

export type ColorDepth = "none" | "ansi16" | "ansi256" | "truecolor";

/** The detected terminal capabilities, computed once (§4.9). */
export interface Capabilities {
  colorDepth: ColorDepth;
  /** True when any color may be emitted (false under NO_COLOR / TERM=dumb). */
  color: boolean;
  /** True when OSC 8 hyperlinks are supported (§4.8). */
  hyperlinks: boolean;
  /** True when the locale indicates UTF-8; false selects ASCII glyphs (§4.9). */
  unicode: boolean;
  columns: number;
  rows: number;
}

/** The subset of the environment capability detection reads (testable seam). */
export interface DetectEnv {
  NO_COLOR?: string | undefined;
  TERM?: string | undefined;
  COLORTERM?: string | undefined;
  TERM_PROGRAM?: string | undefined;
  LANG?: string | undefined;
  LC_ALL?: string | undefined;
  LC_CTYPE?: string | undefined;
}

/** Terminals whose `TERM_PROGRAM` is known to support OSC 8 hyperlinks (§4.9). */
const OSC8_PROGRAMS = new Set(["iTerm.app", "WezTerm", "vscode", "Hyper", "ghostty"]);

function detectColorDepth(env: DetectEnv): ColorDepth {
  if (env.NO_COLOR !== undefined) return "none";
  const term = env.TERM ?? "";
  if (term === "dumb") return "none";
  const colorterm = env.COLORTERM ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if (/-256color$/.test(term)) return "ansi256";
  return "ansi16";
}

function detectUnicode(env: DetectEnv): boolean {
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? "";
  return /utf-?8/i.test(locale);
}

/** Detect terminal capabilities from the environment and TTY size (§4.9). */
export function detectCapabilities(
  env: DetectEnv = process.env,
  size: { columns?: number | undefined; rows?: number | undefined } = {
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  },
): Capabilities {
  const colorDepth = detectColorDepth(env);
  const unicode = detectUnicode(env);
  const hyperlinks =
    colorDepth !== "none" && OSC8_PROGRAMS.has(env.TERM_PROGRAM ?? "");
  return {
    colorDepth,
    color: colorDepth !== "none",
    hyperlinks,
    unicode,
    columns: size.columns ?? 80,
    rows: size.rows ?? 24,
  };
}

const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
/** Clear the visible screen and home the cursor — NEVER the scrollback-erasing
 * `ESC[3J`. Emitted once at startup on a TTY so the banner lands on the first
 * row with the terminal's scrollback preserved (§1.5 step 2, §10.2). */
const CLEAR_HOME = "\x1b[2J\x1b[H";

/** The side a controller writes to; `process.stdout` by default. */
export interface Writable {
  write(s: string): unknown;
}

/**
 * Owns the cursor and guarantees it is restored on every exit path. The CLI
 * renders inline on the primary screen (no alternate screen, no clear), so the
 * controller never touches scrollback: `enter()` only hides the cursor while
 * Ink draws, and a single idempotent restore hook shows the cursor again on
 * clean exit, SIGINT, SIGTERM, and an uncaught exception (§1.5 step 2, §4.10,
 * §10.2).
 */
export class TerminalController {
  private entered = false;
  private restored = false;
  private cleared = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly out: Writable = process.stdout) {}

  /** Hide the cursor while Ink draws; stays on the primary screen (§1.5 step 2). */
  enter(): void {
    if (this.entered) return;
    this.entered = true;
    this.restored = false;
    this.out.write(CURSOR_HIDE);
  }

  /**
   * Clear the visible screen and home the cursor ONCE at startup, so the banner
   * lands on the first row with scrollback preserved (§1.5 step 2, §10.2).
   * Emits `ESC[2J ESC[H` (never `ESC[3J`) only on a TTY; a non-TTY or headless
   * run emits nothing. Fires only at startup — never on resize or `/clear`.
   * Idempotent: a second call is a no-op.
   */
  clearScreen(isTty: boolean): void {
    if (this.cleared || !isTty) return;
    this.cleared = true;
    this.out.write(CLEAR_HOME);
  }

  /** Re-hide the cursor after an external editor returns (§3.8, §10.2). */
  hideCursor(): void {
    this.out.write(CURSOR_HIDE);
  }

  /** Show the cursor again; idempotent. No alternate screen to leave (§10.2). */
  restore(): void {
    if (!this.entered || this.restored) return;
    this.restored = true;
    this.out.write(CURSOR_SHOW);
  }

  /** True once the controller has hidden the cursor (taken over the terminal). */
  get isEntered(): boolean {
    return this.entered;
  }

  /** True once restore has run. */
  get isRestored(): boolean {
    return this.restored;
  }

  /**
   * Register the restore hook for every process exit path (§1.5, §10.2). The
   * returned function removes the listeners. The restore is idempotent so
   * running it more than once is safe.
   */
  installRestoreHook(proc: NodeJS.Process = process): () => void {
    const onExit = (): void => this.restore();
    const onSignal = (sig: NodeJS.Signals): void => {
      this.restore();
      proc.exit(sig === "SIGINT" ? 130 : 143);
    };
    const onUncaught = (err: unknown): void => {
      this.restore();
      // Re-throw after restore so the fault is still visible (§10.2).
      throw err;
    };
    proc.on("exit", onExit);
    proc.on("SIGINT", onSignal);
    proc.on("SIGTERM", onSignal);
    proc.on("uncaughtException", onUncaught);
    const remove = (): void => {
      proc.off("exit", onExit);
      proc.off("SIGINT", onSignal);
      proc.off("SIGTERM", onSignal);
      proc.off("uncaughtException", onUncaught);
    };
    this.cleanups.push(remove);
    return remove;
  }

  /** Remove any installed hooks (used on clean shutdown). */
  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
  }
}
