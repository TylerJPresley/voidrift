/**
 * Shared frame-polling test helper (cli-blueprint.md §11.1).
 *
 * Ink paints asynchronously, and a keystroke that drives an async core
 * round-trip (`session.setMode` → `SESSION_MODE_CHANGED` → re-render) does not
 * settle on a single fixed `setTimeout`: under heavy parallel load the frame is
 * read before the event lands, which is the mode-cycling / startup / resume
 * flake. Polling asserts the SAME end state deterministically — it waits for the
 * condition up to a bounded timeout rather than guessing a delay — and throws
 * with the last frame when the bound elapses so a failure is diagnosable.
 */

/** Options for {@link waitForFrame}; both bounds have load-tolerant defaults. */
export interface WaitForFrameOptions {
  /** Upper bound before giving up and throwing with the last frame. */
  timeoutMs?: number;
  /** Delay between polls. */
  intervalMs?: number;
}

/** A renderer exposing the current frame, e.g. ink-testing-library's render(). */
export interface FrameSource {
  lastFrame: () => string | undefined;
}

/**
 * Poll `source.lastFrame()` until `predicate(frame)` holds, up to `timeoutMs`.
 * Resolves with the matching frame; throws with the last frame on timeout.
 * `onTick` runs once per poll before the next wait — used to re-send a
 * keystroke Ink may drop before its input handler activates (idempotent while
 * the end state is not reached).
 */
export async function waitForFrame(
  source: FrameSource,
  predicate: (frame: string) => boolean,
  options: WaitForFrameOptions = {},
  onTick?: (frame: string) => void,
): Promise<string> {
  const { timeoutMs = 4_000, intervalMs = 10 } = options;
  const start = Date.now();
  for (;;) {
    const frame = source.lastFrame() ?? "";
    if (predicate(frame)) return frame;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `frame never satisfied the predicate within ${timeoutMs}ms; last frame:\n${frame}`,
      );
    }
    onTick?.(frame);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Poll until the frame contains EVERY expected substring. A convenience over
 * {@link waitForFrame} for the common "frame includes these" assertion; the
 * timeout message names the substrings that never appeared.
 */
export async function waitForFrameIncludes(
  source: FrameSource,
  expected: string[],
  options: WaitForFrameOptions = {},
): Promise<string> {
  try {
    return await waitForFrame(source, (f) => expected.every((e) => f.includes(e)), options);
  } catch {
    const frame = source.lastFrame() ?? "";
    const missing = expected.filter((e) => !frame.includes(e));
    throw new Error(
      `frame never contained ${JSON.stringify(missing)}; last frame:\n${frame}`,
    );
  }
}
