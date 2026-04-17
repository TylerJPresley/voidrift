/**
 * Per-agent progress formatting (REQ-UI-17).
 */

export function elapsedStr(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function tokenStr(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function statsStr(elapsed: number, tokensIn: number, tokensOut: number, ctxPct: number | undefined, status: string): string {
  const parts: string[] = [];
  if (elapsed >= 1) parts.push(elapsedStr(elapsed));
  if (tokensIn || tokensOut) {
    let tkns = "tkns:";
    if (tokensIn) tkns += ` ↓ ${tokenStr(tokensIn)}`;
    if (tokensIn && tokensOut) tkns += " -";
    if (tokensOut) tkns += ` ↑ ${tokenStr(tokensOut)}`;
    parts.push(tkns);
  }
  if (ctxPct !== undefined) parts.push(`ctx ${ctxPct}%`);
  parts.push(status);
  return `(${parts.join(" · ")})`;
}

export interface AgentProgress {
  label: string;       // operation name (e.g. "backend/main.py")
  elapsed: number;
  tokensIn: number;
  tokensOut: number;
  ctxPct?: number;
  status: "thinking" | "complete" | "failed" | "cached";
}

export function formatAgentProgress(p: AgentProgress): string {
  if (p.status === "cached") return `  · ${p.label} (cached)`;
  const icon = p.status === "complete" ? "▸" : p.status === "failed" ? "▸" : "▸";
  const statusText = p.status === "complete" ? "✓ complete" : p.status === "failed" ? "⚠ failed" : "thinking";
  return `  ${icon} ${p.label} ${statsStr(p.elapsed, p.tokensIn, p.tokensOut, p.ctxPct, statusText)}`;
}

/** Wrap an agent.send() call with progress tracking. */
export async function trackAgent(
  agent: { send: (msg: string) => Promise<string>; onProgress?: (data: { prompt_tokens?: number; completion_tokens?: number; ctx_pct?: number }) => void },
  message: string,
  label: string,
  emit: (msg: string) => void,
): Promise<string> {
  const start = Date.now();
  let tokensIn = 0, tokensOut = 0, ctxPct: number | undefined;
  const origProgress = agent.onProgress;
  agent.onProgress = (data) => {
    if (data.prompt_tokens) tokensIn = data.prompt_tokens;
    if (data.completion_tokens) tokensOut += data.completion_tokens;
    if (data.ctx_pct !== undefined) ctxPct = data.ctx_pct;
    origProgress?.(data);
  };
  try {
    const result = await agent.send(message);
    const elapsed = (Date.now() - start) / 1000;
    emit(formatAgentProgress({ label, elapsed, tokensIn, tokensOut, ctxPct, status: "complete" }));
    return result;
  } catch (e) {
    const elapsed = (Date.now() - start) / 1000;
    emit(formatAgentProgress({ label, elapsed, tokensIn, tokensOut, ctxPct, status: "failed" }));
    throw e;
  }
}
