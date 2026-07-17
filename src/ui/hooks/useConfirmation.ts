/**
 * useConfirmation — hook for tool confirmation dialog state.
 * Encapsulates: request state, option building, index, response handling.
 */
import React, { useState, useCallback, useEffect, useMemo } from "react";
import type { CoreAPI } from "../../plugins/interface.js";

export interface ConfirmOption {
  label: string;
  approved: boolean;
  persist?: boolean;
  scope?: "workspace" | "global";
  pattern?: string;
}

export interface ConfirmState {
  request: { tool: string; args: Record<string, unknown>; requestId: string; diff?: string[]; inferredPatterns?: string[] } | null;
  options: ConfirmOption[];
  idx: number;
  setIdx: (fn: (i: number) => number) => void;
  respond: (optionIdx: number) => void;
}

export function useConfirmation(core: CoreAPI): ConfirmState {
  const [request, setRequest] = useState<ConfirmState["request"]>(null);
  const [idx, setIdx] = useState(0);

  const options = useMemo(() => {
    if (!request) return [];
    const opts: ConfirmOption[] = [
      { label: "Yes, allow once", approved: true },
    ];
    const patterns = request.inferredPatterns || [];
    for (const p of patterns) {
      const displayPattern = p.startsWith("mcp_") ? p.replace(/^mcp_([^_]+)_(.+)$/, "MCP:$1:$2").replace(/^mcp_([^_]+)_\*$/, "MCP:$1:*") : p;
      opts.push({ label: `Allow this session, "${displayPattern}"`, approved: true, pattern: p });
      opts.push({ label: `Always allow (project), "${displayPattern}"`, approved: true, persist: true, scope: "workspace", pattern: p });
      opts.push({ label: `Always allow (user), "${displayPattern}"`, approved: true, persist: true, scope: "global", pattern: p });
    }
    opts.push({ label: "No", approved: false });
    return opts;
  }, [request]);

  useEffect(() => {
    return core.events.subscribe("TOOL_CONFIRMATION_REQUEST", (event: any) => {
      setRequest(event.payload);
      setIdx(0);
    });
  }, []);

  const respond = useCallback((optionIdx: number) => {
    if (request && options[optionIdx]) {
      const opt = options[optionIdx];
      core.events.emit("TOOL_CONFIRMATION_RESPONSE", {
        requestId: request.requestId,
        approved: opt.approved,
        persist: opt.persist,
        scope: opt.scope,
        chosenPattern: opt.pattern,
      } as any);
      setRequest(null);
    }
  }, [request, options]);

  return { request, options, idx, setIdx, respond };
}
