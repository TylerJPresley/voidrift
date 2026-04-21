/**
 * Per-agent progress formatting (REQ-UI-17).
 */

const ITALIC = "\x1b[3m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function italic(s: string): string { return `${ITALIC}${s}${RESET}`; }
export function bold(s: string): string { return `${BOLD}${s}${RESET}`; }

export function elapsedStr(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function tokenStr(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function ctxIcon(pct: number): string {
  if (pct <= 0) return "○";
  if (pct <= 25) return "◔";
  if (pct <= 50) return "◑";
  if (pct <= 75) return "◕";
  return "●";
}

export function ctxColor(pct: number): string {
  if (pct <= 50) return "#4ec9b0";
  if (pct <= 75) return "#e5c07b";
  return "#e06c75";
}

/** Convert hex color to ANSI 256-color escape. */
function ansiColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function statsStr(elapsed: number, tokensIn: number, tokensOut: number, ctxPct: number | undefined, status: string): string {
  const parts: string[] = [];
  if (elapsed >= 1) parts.push(elapsedStr(elapsed));
  if (tokensIn) parts.push(`↓ ${tokenStr(tokensIn)}`);
  if (tokensOut) parts.push(`↑ ${tokenStr(tokensOut)}`);
  if (ctxPct !== undefined) parts.push(`${ansiColor(ctxColor(ctxPct))}${ctxIcon(ctxPct)}${RESET} ${ctxPct}%`);
  parts.push(status);
  return parts.join(" · ");
}

export interface AgentProgress {
  label: string;
  elapsed: number;
  tokensIn: number;
  tokensOut: number;
  ctxPct?: number;
  status: "queued" | "thinking" | "complete" | "failed" | "cached";
}

/** Format a file-level progress line: italic stats after the label. */
export function formatAgentProgress(p: AgentProgress): string {
  if (p.status === "cached") return `${p.label} ${italic("✓ cached")}`;
  const statusText = p.status === "complete" ? "✓ complete" : p.status === "failed" ? "⚠ failed" : p.status;
  return `${p.label} ${italic(statsStr(p.elapsed, p.tokensIn, p.tokensOut, p.ctxPct, statusText))}`;
}

/** Format a stage header with italic stats appended. */
export function formatStageHeader(header: string, stats: string): string {
  return `${header} ${italic(stats)}`;
}

type AgentLike = {
  send: (msg: string) => Promise<string>;
  onProgress?: (data: { prompt_tokens?: number; completion_tokens?: number; ctx_pct?: number }) => void;
};

export interface TrackResult {
  result: string;
  stats: string;       // raw stats string for stage headers
  progress: AgentProgress;  // full progress data for file-level formatting
}

/** Track an agent call, returning result + stats + progress data. Calls onUpdate with live progress. */
export async function trackAgentWithStats(
  agent: AgentLike, message: string, label: string,
  onUpdate?: (p: AgentProgress) => void,
): Promise<TrackResult> {
  const start = Date.now();
  let tokensIn = 0, tokensOut = 0, ctxPct: number | undefined;
  let status: AgentProgress["status"] = "queued";
  const elapsed = () => (Date.now() - start) / 1000;
  onUpdate?.({ label, elapsed: elapsed(), tokensIn, tokensOut, ctxPct, status });
  const origProgress = agent.onProgress;
  agent.onProgress = (data) => {
    if (data.prompt_tokens) tokensIn = data.prompt_tokens;
    if (data.completion_tokens) tokensOut += data.completion_tokens;
    if (data.ctx_pct !== undefined) ctxPct = data.ctx_pct;
    onUpdate?.({ label, elapsed: elapsed(), tokensIn, tokensOut, ctxPct, status: "thinking" });
    origProgress?.(data);
  };
  status = "thinking";
  onUpdate?.({ label, elapsed: elapsed(), tokensIn, tokensOut, ctxPct, status });
  const timer = onUpdate ? setInterval(() => {
    if (status === "thinking") onUpdate({ label, elapsed: elapsed(), tokensIn, tokensOut, ctxPct, status });
  }, 1000) : undefined;
  if (timer) (timer as NodeJS.Timeout).unref();
  try {
    const result = await agent.send(message);
    clearInterval(timer);
    const e = elapsed();
    const progress: AgentProgress = { label, elapsed: e, tokensIn, tokensOut, ctxPct, status: "complete" };
    onUpdate?.(progress);
    return { result, stats: statsStr(e, tokensIn, tokensOut, ctxPct, "✓ complete"), progress };
  } catch (err) {
    clearInterval(timer);
    const e = elapsed();
    const progress: AgentProgress = { label, elapsed: e, tokensIn, tokensOut, ctxPct, status: "failed" };
    onUpdate?.(progress);
    throw Object.assign(err as Error, { stats: statsStr(e, tokensIn, tokensOut, ctxPct, "⚠ failed"), progress });
  }
}

/** Convenience: track + emit formatted progress line with live updates. */
export async function trackAgent(agent: AgentLike, message: string, label: string, emit: (msg: string) => void): Promise<string> {
  const { result } = await trackAgentWithStats(agent, message, label, (p) => emit(formatAgentProgress(p)));
  return result;
}
