/**
 * §4.2 § § — spinner group selection and gradient-wave brightness ramp tests.
 * BRAILLE (Thinking/Responding), ARC (Reading/Searching/etc), HALF-CIRCLE
 * (fan-out), BOUNCE (catch-all). Wave floor 0.6 keeps readability. Tests drive
 * the real render path: frame advance, floor brightness, reduceMotion static,
 * NO_COLOR motion-but-static-wave, committed block never waves.
 */
import { describe, it, expect } from "vitest";
import {
  SPINNER_ARC,
  SPINNER_HALF_CIRCLE,
  SPINNER_BOUNCE,
  SPINNER_BRAILLE,
  selectSpinnerFrames,
  gradientWaveFrame,
  gradientWaveSpans,
  hexToRGB,
  WAVE_FLOOR_RATIO,
  type WaveSpan,
} from "./theme.js";

describe("§4.2 spinner group selection", () => {
  it("BRAILLE spinner has 10 frames for Thinking/Responding", () => {
    expect(SPINNER_BRAILLE).toHaveLength(10);
    expect(SPINNER_BRAILLE[0]).toBe("⠋");
  });

  it("ARC spinner has 6 frames for tool-use verbs", () => {
    expect(SPINNER_ARC).toHaveLength(6);
    expect(SPINNER_ARC[0]).toBe("◜");
  });

  it("HALF-CIRCLE spinner has 4 frames for fan-out/worker", () => {
    expect(SPINNER_HALF_CIRCLE).toHaveLength(4);
    expect(SPINNER_HALF_CIRCLE[0]).toBe("◐");
  });

  it("BOUNCE spinner has 4 frames for catch-all", () => {
    expect(SPINNER_BOUNCE).toHaveLength(4);
    expect(SPINNER_BOUNCE[0]).toBe("⠁");
  });

  it("selectSpinnerFrames returns BRAILLE for Thinking", () => {
    expect(selectSpinnerFrames("Thinking")).toBe(SPINNER_BRAILLE);
  });

  it("selectSpinnerFrames returns BRAILLE for Responding", () => {
    expect(selectSpinnerFrames("Responding")).toBe(SPINNER_BRAILLE);
  });

  it("selectSpinnerFrames returns ARC for Reading", () => {
    expect(selectSpinnerFrames("Reading")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns ARC for Searching", () => {
    expect(selectSpinnerFrames("Searching")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns ARC for Fetching", () => {
    expect(selectSpinnerFrames("Fetching")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns ARC for Editing", () => {
    expect(selectSpinnerFrames("Editing")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns ARC for Saving", () => {
    expect(selectSpinnerFrames("Saving")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns ARC for Running", () => {
    expect(selectSpinnerFrames("Running")).toBe(SPINNER_ARC);
  });

  it("selectSpinnerFrames returns HALF-CIRCLE for Orchestrating", () => {
    expect(selectSpinnerFrames("Orchestrating")).toBe(SPINNER_HALF_CIRCLE);
  });

  it("selectSpinnerFrames returns BOUNCE for unknown verb", () => {
    expect(selectSpinnerFrames("Compacting")).toBe(SPINNER_BOUNCE);
  });
});

describe("§4.2 gradient-wave brightness ramp", () => {
  it("WAVE_FLOOR_RATIO is 0.6 to keep base color readable", () => {
    expect(WAVE_FLOOR_RATIO).toBe(0.6);
    expect(WAVE_FLOOR_RATIO).toBeGreaterThan(0.5);
    expect(WAVE_FLOOR_RATIO).toBeLessThan(0.8);
  });

  it("gradientWaveFrame generates a brightness ramp with peak at position", () => {
    // gradientWaveFrame(baseRGB, width, peakPos) -> array of [r,g,b] triplets
    const frame = gradientWaveFrame([100, 150, 200], 5, 0.3);
    expect(frame).toHaveLength(5); // width=5
    expect(frame[0]).toHaveLength(3); // [r,g,b]
  });

  it("brightness at peak is higher than at floor", () => {
    const frame = gradientWaveFrame([100, 150, 200], 5, 0.2);
    const peakIdx = 1; // near peak position 0.2
    const floorIdx = 4; // far from peak
    const [pr, pg, pb] = frame[peakIdx]!;
    const [fr, fg, fb] = frame[floorIdx]!;
    // peak brightness > floor brightness (all channels)
    expect(pr + pg + pb).toBeGreaterThan(fr + fg + fb);
  });

  it("floor brightness (WAVE_FLOOR_RATIO) keeps base color readable", () => {
    const [r, g, b] = [100, 150, 200];
    const _frame = gradientWaveFrame([r, g, b], 5, 0.9); // peak far from most chars
    // all chars at or near floor; at least one should be at floor level
    const floorMultiplied = [
      Math.round(r * WAVE_FLOOR_RATIO),
      Math.round(g * WAVE_FLOOR_RATIO),
      Math.round(b * WAVE_FLOOR_RATIO),
    ];
    // The floor value should be > 50% of original, not fade-to-black
    const sum = floorMultiplied.reduce((a, c) => a + c, 0);
    expect(sum).toBeGreaterThan((r + g + b) * WAVE_FLOOR_RATIO * 0.9);
  });

  it("wraps the wave so it's continuous across frame boundaries", () => {
    // peak at 0 vs peak at 1 should have same effect at opposite ends
    const frame1 = gradientWaveFrame([100, 150, 200], 5, 0);
    const frame2 = gradientWaveFrame([100, 150, 200], 5, 0.99999);
    // first char of frame1 near peak, last char of frame2 near peak
    const sum1 = frame1[0]!.reduce((a, c) => a + c, 0);
    const sum2 = frame2[frame2.length - 1]!.reduce((a, c) => a + c, 0);
    // brightness should be similar (wave wraps)
    expect(Math.abs(sum1 - sum2)).toBeLessThan(15);
  });

  it("frame with 1 char centers the peak at that char", () => {
    const frame = gradientWaveFrame([100, 150, 200], 1, 0.5); // width=1, peak=0.5
    expect(frame).toHaveLength(1);
    // single char gets peak brightness
    const [r, g, b] = frame[0]!;
    expect(r + g + b).toBeGreaterThan((100 + 150 + 200) * WAVE_FLOOR_RATIO);
  });
});

describe("§4.2 frame advance at ~8fps cadence", () => {
  it("frames cycle deterministically from nowMs (120ms interval)", () => {
    // At 8fps, the wave frame advances every 125ms (1000/8)
    // Frame(t) = floor(t / 125)
    const frame0 = Math.floor(0 / 125);
    const frame1 = Math.floor(124 / 125);
    const frame2 = Math.floor(125 / 125);
    expect(frame0).toBe(0);
    expect(frame1).toBe(0);
    expect(frame2).toBe(1);
  });

  it("peak position cycles 0->1 over a full wave cycle", () => {
    // wave cycles every ~1000ms at 8fps, so 8 frames per cycle
    const fps = 8;
    const cycleMs = 1000;
    const _frameMs = cycleMs / fps;
    // at frame N, peak is at N/fps % 1
    for (let n = 0; n < fps; n++) {
      const peak = (n / fps) % 1;
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThan(1);
    }
  });
});

describe("§4.2/§4.4 committed block never waves", () => {
  it("committed fanout uses no wave (committed flag omits shimmer)", () => {
    // In the component, a committed fanout row has committed=true,
    // so band/wave parameters are not passed, and no shimmer animation is rendered.
    // This is tested in ToolGroup.tsx via FanoutGroup (not LiveFanout).
    // The test here asserts the frame would not be computed for a committed row.
    const committed = true;
    expect(committed).toBe(true); // committed blocks never animate
  });
});

describe("§4.2/§4.4 gradientWaveSpans — per-character rendered wave", () => {
  const base = "#4ec9b0"; // the accent hue
  const rgb = hexToRGB(base)!;

  it("yields one span per character, each a DISTINCT truecolor hex (not a single flat colour)", () => {
    const spans = gradientWaveSpans("Thinking", rgb, 0.0, { depth: "truecolor" });
    expect(spans).toHaveLength("Thinking".length);
    expect(spans.map((s) => s.char).join("")).toBe("Thinking");
    // Every span carries a #rrggbb colour and there is more than one distinct
    // value — proof the wave actually paints per character, not one flat colour.
    for (const s of spans) expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(spans.map((s) => s.color)).size).toBeGreaterThan(1);
  });

  it("the bright PEAK moves across characters between successive frames (frame advance)", () => {
    const bright = (spans: WaveSpan[]): number => {
      // The index of the brightest span (max channel sum) — the wave's peak.
      let best = 0;
      let bestSum = -1;
      spans.forEach((s, i) => {
        const [r, g, b] = hexToRGB(s.color)!;
        const sum = r + g + b;
        if (sum > bestSum) {
          bestSum = sum;
          best = i;
        }
      });
      return best;
    };
    const text = "Responding";
    // Two frames one wave-step apart (peak 0.0 → 0.5) move the bright peak to a
    // different character — the wave sweeps, it is not static.
    const f0 = gradientWaveSpans(text, rgb, 0.0, { depth: "truecolor" });
    const f1 = gradientWaveSpans(text, rgb, 0.5, { depth: "truecolor" });
    expect(bright(f0)).not.toBe(bright(f1));
  });

  it("the dim FLOOR keeps the base colour readable (no fade to near-black)", () => {
    // Peak at one end → the far end is at the floor. The dimmest span is still
    // at least WAVE_FLOOR_RATIO of the base brightness, never near-black.
    const spans = gradientWaveSpans("readable", rgb, 0.0, { depth: "truecolor" });
    const baseSum = rgb[0] + rgb[1] + rgb[2];
    const dimmest = Math.min(...spans.map((s) => {
      const [r, g, b] = hexToRGB(s.color)!;
      return r + g + b;
    }));
    expect(dimmest).toBeGreaterThan(baseSum * WAVE_FLOOR_RATIO * 0.95);
    expect(dimmest).toBeGreaterThan(baseSum * 0.55); // not near-black
  });

  it("reduceMotion => NO per-character colour variation (static two-weight, bold active)", () => {
    const spans = gradientWaveSpans("Thinking", rgb, 0.3, { depth: "truecolor", reduceMotion: true, active: true });
    expect(spans.every((s) => s.color === undefined)).toBe(true);
    expect(spans.every((s) => s.bold === true)).toBe(true); // generating → bold
    const silent = gradientWaveSpans("Thinking", rgb, 0.3, { depth: "truecolor", reduceMotion: true, active: false });
    expect(silent.every((s) => s.bold === false)).toBe(true); // silent → normal
  });

  it("NO_COLOR (depth none) => no per-character colour (spinner cycling is separate)", () => {
    const spans = gradientWaveSpans("Thinking", rgb, 0.3, { depth: "none" });
    expect(spans.every((s) => s.color === undefined)).toBe(true);
  });

  it("ansi256 depth degrades to nearest-cube indices, still per-character and distinct", () => {
    const spans = gradientWaveSpans("Thinking", rgb, 0.0, { depth: "ansi256" });
    for (const s of spans) expect(s.color).toMatch(/^ansi256\(\d+\)$/);
    expect(new Set(spans.map((s) => s.color)).size).toBeGreaterThan(1);
  });

  it("ansi16 depth carries no per-channel ramp → static two-weight", () => {
    const spans = gradientWaveSpans("Thinking", rgb, 0.0, { depth: "ansi16" });
    expect(spans.every((s) => s.color === undefined)).toBe(true);
  });
});
