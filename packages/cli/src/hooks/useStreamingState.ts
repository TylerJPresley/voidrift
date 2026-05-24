import { useState, useCallback } from "react";
import type { ConfirmResult } from "../tools/registry.js";

export type StreamingPhase =
  | { type: "idle" }
  | { type: "responding"; text: string; elapsed: number; tokens: number }
  | { type: "tool_pending"; name: string; args: string }
  | { type: "confirming"; name: string; args: string; resolve: (r: ConfirmResult) => void }
  | { type: "error"; message: string };

export function useStreamingState() {
  const [phase, setPhase] = useState<StreamingPhase>({ type: "idle" });

  const toIdle = useCallback(() => setPhase({ type: "idle" }), []);
  const toResponding = useCallback((text: string, elapsed: number, tokens: number) =>
    setPhase({ type: "responding", text, elapsed, tokens }), []);
  const toToolPending = useCallback((name: string, args: string) =>
    setPhase({ type: "tool_pending", name, args }), []);
  const toConfirming = useCallback((name: string, args: string, resolve: (r: ConfirmResult) => void) =>
    setPhase({ type: "confirming", name, args, resolve }), []);
  const toError = useCallback((message: string) =>
    setPhase({ type: "error", message }), []);

  const isBusy = phase.type !== "idle" && phase.type !== "error";

  return { phase, isBusy, toIdle, toResponding, toToolPending, toConfirming, toError };
}
