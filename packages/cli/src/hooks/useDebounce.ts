import { useState, useEffect, useRef } from "react";

/**
 * Debounce a value — only updates after `delay` ms of no changes.
 * Used for footer/status line to prevent excessive re-renders during streaming.
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);

  return debounced;
}
