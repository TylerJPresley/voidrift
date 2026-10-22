import React from "react";
import { Text } from "ink";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../render/theme.js";

/**
 * A yellow braille spinner cycling `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, repainting at most every
 * 120 ms (§4.2) — the CLI's own component so `ink-spinner` is not a dependency
 * (§1.3). Under `reduceMotion` (§4.2) the caller renders static text instead and
 * never mounts this. `interval` is injectable so a test can assert the repaint
 * cadence with a fake clock; it defaults to the 120 ms §4.2 cadence.
 */
export function Spinner({
  color,
  interval = SPINNER_INTERVAL,
}: {
  color?: string | undefined;
  interval?: number | undefined;
}): React.ReactElement {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return <Text {...(color ? { color } : {})}>{SPINNER_FRAMES[frame]}</Text>;
}
