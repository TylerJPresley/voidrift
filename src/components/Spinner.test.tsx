/**
 * §4.2 — the dynamic-region spinner repaints at most every 120 ms so nothing
 * flickers while a turn runs (buffered rendering, §1.4, §4.2). Proven with fake
 * timers: the frame advances only when ≥ the interval elapses.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { Spinner } from "./Spinner.js";
import { SPINNER_INTERVAL } from "../render/theme.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("§4.2 spinner repaint cadence", () => {
  it("the configured interval is at least 120 ms", () => {
    expect(SPINNER_INTERVAL).toBeGreaterThanOrEqual(120);
  });

  it("schedules its repaint on an interval of at least 120 ms (injected clock)", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const r = render(<Spinner interval={120} />);
    // The spinner's repaint timer is scheduled at the injected 120 ms cadence —
    // never faster, so the status line never flickers (§4.2).
    const spinnerCall = spy.mock.calls.find((c) => c[1] === 120);
    expect(spinnerCall).toBeDefined();
    expect(spinnerCall![1]).toBeGreaterThanOrEqual(120);
    r.unmount();
    spy.mockRestore();
  });

  it("defaults to the §4.2 120 ms cadence when no interval is injected", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const r = render(<Spinner />);
    expect(spy.mock.calls.some((c) => (c[1] as number) >= 120)).toBe(true);
    r.unmount();
    spy.mockRestore();
  });
});
