import React, { useState, useEffect } from "react";
import { Text } from "ink";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function ToolElapsedTime({ startTime, showAfter = 3000 }: { startTime: number; showAfter?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - startTime;
  if (elapsed < showAfter) return null;

  return <Text dimColor>{formatElapsed(elapsed)}</Text>;
}
