import React from "react";
import { Text } from "ink";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../render/theme.js";

/**
 * A spinner with configurable glyph frames, repainting at most every 120 ms
 * (§4.2) — the CLI's own component so `ink-spinner` is not a dependency (§1.3).
 * Defaults to BRAILLE frames for backward compatibility. Under `reduceMotion`
 * (§4.2) the caller renders static text instead and never mounts this.
 * `interval` is injectable so a test can assert the repaint cadence with a fake
 * clock; it defaults to the 120 ms §4.2 cadence. `frames` selects the glyph
 * set (§4.2 spinner group selection).
 */
export function Spinner({
  color,
  interval = SPINNER_INTERVAL,
  frames = SPINNER_FRAMES,
}: {
  color?: string | undefined;
  interval?: number | undefined;
  /** Spinner frame array (e.g., BRAILLE, ARC, HALF_CIRCLE, BOUNCE) */
  frames?: ReadonlyArray<string> | undefined;
}): React.ReactElement {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), interval);
    return () => clearInterval(timer);
  }, [interval, frames.length]);
  return <Text {...(color ? { color } : {})}>{frames[frame]}</Text>;
}
