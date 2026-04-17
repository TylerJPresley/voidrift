import { useState, useEffect } from "react";
import type { Region } from "./regions/Region.js";

/** React hook: subscribes to a Region and re-renders on change. */
export function useRegion<T extends Region>(region: T): T {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return region.subscribe(() => forceUpdate(v => v + 1));
  }, [region]);
  return region;
}
