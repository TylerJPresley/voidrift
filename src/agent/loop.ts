/**
 * Agent loop: API calls, tool dispatch, retry, hooks (REQ-ARCH-4).
 */

import { appendFileSync } from "node:fs";
import type { Message, ToolCall, LoopState, ProgressData, ParsedResponse } from "./types.js";
import type { ToolDef } from "../tools/registry.js";
import type { ModelInterface } from "../models.js";
import type { ProtocolAdapter } from "./protocol.js";
import { getAdapter } from "./protocol.js";
import { TokenBudget, BudgetExhaustedError } from "./budget.js";
import { isAbortRequested, registerLoop, unregisterLoop, abortAwareSleep, AbortRequested } from "./abort.js";
import { stripThinkTags } from "./think.js";
import { detectStall, buildSigSet } from "./stall.js";
import { snipOldToolResults, trimMessages } from "./context.js";
import { loadPrompt } from "../prompts.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETRY_MAX = 3;
const RETRY_BASE = 1.0;
const RETRY_MULT = 2.0;
const RETRY_CAP = 30.0;
const MAX_CONCURRENT_BATCH = 10;

function jitter(delay: number): number {
  return delay * (0.7 + Math.random() * 0.6);
}

// ---------------------------------------------------------------------------
// Normalize tool arguments (REQ-ARCH-17)
// ---------------------------------------------------------------------------

function normalizeArgs(name: string, args: Record<string, unknown>, logFn: LogFn): Record<string, unknown> {
  if (name === "file") {
    if (typeof args.path === "string") {
      const raw = args.path;
      let normalized = raw.replace(/^\.\//, "").replace(/^\//, "");
      if (normalized !== raw) {
        logFn(`[TOOL_NORMALIZE tool=${name} field=path raw=${raw} normalized=${normalized}]`);
        args = { ...args, path: normalized };
      }
    }
    if (Array.isArray(args.content)) {
      const raw = args.content;
      args = { ...args, content: raw.join("\n") };
      logFn(`[TOOL_NORMALIZE tool=${name} field=content raw=array normalized=string]`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Concurrent-safe check
// ---------------------------------------------------------------------------

const FILE_SAFE_ACTIONS = new Set(["read", "list"]);
const HTTP_SAFE_ACTIONS = new Set(["get"]);

function isConcurrentSafe(tc: ToolCall, toolDefs: ToolDef[]): boolean {
  const name = tc.function.name;
  const def = toolDefs.find(t => t.function.name === name);
  if (def?.concurrent_safe) return true;
  try {
    const args = JSON.parse(tc.function.arguments || "{}");
    if (name === "file") return FILE_SAFE_ACTIONS.has(args.action);
    if (name === "http") return HTTP_SAFE_ACTIONS.has(args.action);
  } catch { /* */ }
  return false;
}

type LogFn = (msg: string) => void;
type Handler = (...args: unknown[]) => string;

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export interface AgentLoopOptions {
  model: ModelInterface;
  systemPrompt: string;
  tools?: ToolDef[];
  toolHandlers?: Record<string, Handler>;
  stream?: boolean;
  maxTokens?: number;
  logPath?: string;
  showSpinner?: boolean;
  toolChoice?: "required" | "auto";
  tokenBudget?: TokenBudget;
  // Hooks
  maxTurns?: number;
  stopCheck?: (state: LoopState) => string | null;
  transformContext?: (messages: Message[]) => Message[];
  beforeToolCall?: (name: string, args: string) => string | null;
  afterToolCall?: (name: string, result: string) => string;
  getSteeringMessages?: (state: LoopState) => Message[];
  getFollowUpMessages?: (state: LoopState) => Message[];
}

export class AgentLoop {
  messages: Message[];
  private _model: ModelInterface;
  private _adapter: ProtocolAdapter;
  private _client: unknown;
  private _tools: ToolDef[];
  private _toolHandlers: Record<string, Handler>;
  private _stream: boolean;
  private _maxTokens: number;
  private _logPath?: string;
  private _toolChoice: "required" | "auto";
  private _tokenBudget?: TokenBudget;
  private _inputTotal = 0;
  private _outputTotal = 0;
  private _loopId?: number;

  // Hooks
  private _maxTurns: number;
  private _stopCheck?: (state: LoopState) => string | null;
  private _transformContext?: (messages: Message[]) => Message[];
  beforeToolCall?: (name: string, args: string) => string | null;
  afterToolCall?: (name: string, result: string) => string;
  private _getSteeringMessages?: (state: LoopState) => Message[];
  private _getFollowUpMessages?: (state: LoopState) => Message[];

  // Callbacks
  onToken?: (token: string) => void;
  onProgress?: (data: ProgressData) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, result: string) => void;
  onComplete?: (stats: Record<string, unknown>) => void;

  // Queues
  private _steeringQueue: Message[][] = [];
  private _followUpQueue: Array<{ messages: Message[]; drain: string }> = [];

  // Stall state
  private _prevSigs = new Set<string>();
  private _nudgeCount = 0;

  // Reactive compact counter
  private _compactAttempts = 0;

  constructor(opts: AgentLoopOptions) {
    this._model = opts.model;
    this._adapter = (opts.model as Record<string, unknown>).adapter as ProtocolAdapter ?? getAdapter(opts.model.config.protocol);
    this._client = this._adapter.createClient(opts.model.config);
    this._tools = opts.tools ?? [];
    this._toolHandlers = opts.toolHandlers ?? {};
    this._stream = opts.stream ?? false;
    this._maxTokens = opts.maxTokens ?? opts.model.config.maxTokens;
    this._logPath = opts.logPath;
    this._toolChoice = opts.toolChoice ?? (this._tools.length ? "required" : "auto");
    this._tokenBudget = opts.tokenBudget;
    this._maxTurns = opts.maxTurns ?? 0;
    this._stopCheck = opts.stopCheck;
    this._transformContext = opts.transformContext;
    this.beforeToolCall = opts.beforeToolCall;
    this.afterToolCall = opts.afterToolCall;
    this._getSteeringMessages = opts.getSteeringMessages;
    this._getFollowUpMessages = opts.getFollowUpMessages;

    this.messages = [{ role: "system", content: opts.systemPrompt }];
  }

  steer(msgs: Message[]): void { this._steeringQueue.push(msgs); }
  followUp(msgs: Message[], drain = "one-at-a-time"): void {
    this._followUpQueue.push({ messages: msgs, drain });
  }

  async send(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });
    this._loopId = registerLoop({ close: () => this._closeClient() });
    try {
      return await this._runLoop();
    } finally {
      if (this._loopId !== undefined) unregisterLoop(this._loopId);
      this._closeClient();
    }
  }

  private async _runLoop(): Promise<string> {
    let turnCount = 0;
    let accumulatedText = "";
    let maxTokensRecoveries = 0;

    while (true) {
      // Budget check
      this._tokenBudget?.checkBefore();

      // Transform context hook
      let callMessages = [...this.messages];
      if (this._transformContext) callMessages = this._transformContext(callMessages);

      // Build request
      const toolChoice = this._tools.length
        ? (this._toolChoice === "required" ? "required" : "auto")
        : undefined;
      const reqOpts = {
        model: this._model.config.modelId,
        messages: callMessages,
        tools: this._tools.length ? this._tools : undefined,
        toolChoice,
        maxTokens: this._maxTokens,
        stream: this._stream,
        provider: this._model.config.provider,
      };
      const wireReq = this._adapter.buildRequest(reqOpts);

      // API call with retry
      let parsed: ParsedResponse;
      try {
        const raw = await this._callWithRetry(wireReq);
        parsed = this._adapter.parseResponse(raw);
      } catch (e: unknown) {
        // Context-length error → reactive compaction
        if (this._isContextLengthError(e) && this._compactAttempts < 2) {
          this._compactAttempts++;
          this._log(`[REACTIVE_COMPACT attempt=${this._compactAttempts}]`);
          this.messages = trimMessages(this.messages);
          continue;
        }
        throw e;
      }

      // Record usage
      this._inputTotal += parsed.usage.prompt_tokens;
      this._outputTotal += parsed.usage.completion_tokens;
      this._tokenBudget?.record(parsed.usage.prompt_tokens, parsed.usage.completion_tokens);
      this.onProgress?.({
        prompt_tokens: parsed.usage.prompt_tokens,
        completion_tokens: parsed.usage.completion_tokens,
        ctx_pct: this._model.config.maxContext
          ? Math.round((parsed.usage.prompt_tokens / this._model.config.maxContext) * 100)
          : undefined,
        turn: turnCount,
      });

      // Strip think tags
      let text = stripThinkTags(parsed.text, (msg) => this._log(msg));

      // Max-tokens recovery (REQ-ARCH-11)
      if (parsed.finishReason === "length") {
        if (parsed.toolCalls.length) {
          this._log(`[MAX_TOKENS_TOOL_DISCARD] Discarded ${parsed.toolCalls.length} truncated tool calls`);
          this.messages.push({ role: "assistant", content: text || null });
          const resume = loadPrompt("system", "MAX-TOKENS-TOOL-RESUME");
          this.messages.push({ role: "user", content: resume || "Re-emit your tool calls." });
          continue;
        }
        if (maxTokensRecoveries < 2) {
          maxTokensRecoveries++;
          accumulatedText += text;
          this.messages.push({ role: "assistant", content: text });
          const resume = loadPrompt("system", "MAX-TOKENS-RESUME");
          this.messages.push({ role: "user", content: resume || "Continue from where you stopped." });
          this._log(`[MAX_TOKENS_RECOVERY attempt=${maxTokensRecoveries}]`);
          continue;
        }
        this._log("[MAX_TOKENS_EXHAUSTED]");
        return accumulatedText + text;
      }

      // Text-only response (no tool calls)
      if (!parsed.toolCalls.length) {
        const finalText = accumulatedText + text;
        this.messages.push({ role: "assistant", content: finalText });

        // Follow-up hooks
        const state = this._loopState(turnCount);
        state.toolsCalledThisTurn = [];
        const followUp = this._getFollowUpMessages?.(state) ?? [];
        if (followUp.length) {
          this.messages.push(...followUp);
          continue;
        }
        // Follow-up queue
        const queued = this._followUpQueue.shift();
        if (queued) {
          this.messages.push(...queued.messages);
          continue;
        }

        this._log(`[LOOP_EXIT reason=natural_stop turns=${turnCount} total_input=${this._inputTotal} total_output=${this._outputTotal}]`);
        this.onComplete?.({ prompt_tokens: this._inputTotal, completion_tokens: this._outputTotal });
        return finalText;
      }

      // Tool calls present
      turnCount++;
      accumulatedText = "";

      // Stall detection
      const currentSigs = buildSigSet(parsed.toolCalls);
      if (detectStall(parsed.toolCalls, this._prevSigs)) {
        this._nudgeCount++;
        this._log(`[STALL nudge=${this._nudgeCount}]`);
        if (this._nudgeCount > 2) {
          // Force final text call — strip to write tools only
          this.messages.push({ role: "assistant", content: text, tool_calls: parsed.toolCalls });
          this.messages.push({ role: "user", content: "Stop repeating. Write your output now." });
          this._tools = [];
          continue;
        }
        const nudge = loadPrompt("system", "STALL-NUDGE");
        this.messages.push({ role: "assistant", content: text, tool_calls: parsed.toolCalls });
        // Still need to provide tool results for the calls
        for (const tc of parsed.toolCalls) {
          this.messages.push({ role: "tool", content: "Stall detected — move on.", tool_call_id: tc.id, name: tc.function.name });
        }
        this.messages.push({ role: "user", content: nudge || "Move on to the next step." });
        this._prevSigs = currentSigs;
        continue;
      }
      this._prevSigs = currentSigs;
      this._nudgeCount = 0;

      // Deduplicate (REQ-ARCH-16)
      const { unique, idMap } = this._dedup(parsed.toolCalls);

      // Append assistant message with tool calls
      this.messages.push({ role: "assistant", content: text || null, tool_calls: parsed.toolCalls });

      // Execute tool calls
      const toolsCalledThisTurn: string[] = [];
      const results = await this._executeCalls(unique, toolsCalledThisTurn);

      // Map results to all IDs (dedup)
      for (const tc of parsed.toolCalls) {
        const sig = `${tc.function.name}:${tc.function.arguments}`;
        const result = results.get(sig) ?? "Error: no result";
        this.messages.push({ role: "tool", content: result, tool_call_id: tc.id, name: tc.function.name });
      }

      // Steering hooks
      const state = this._loopState(turnCount);
      state.toolsCalledThisTurn = toolsCalledThisTurn;
      const steering = this._getSteeringMessages?.(state) ?? [];
      if (steering.length) this.messages.push(...steering);
      for (const batch of this._steeringQueue.splice(0)) this.messages.push(...batch);

      // Stop checks
      if (this._maxTurns > 0 && turnCount >= this._maxTurns) {
        this._log(`[LOOP_STOP reason=max_turns]`);
        break;
      }
      const stopReason = this._stopCheck?.(state);
      if (stopReason) {
        this._log(`[LOOP_STOP reason=${stopReason}]`);
        break;
      }
      if (isAbortRequested()) throw new AbortRequested();

      this._log(`[ITERATION turn=${turnCount} tools=[${toolsCalledThisTurn.join(",")}]]`);
    }

    // Final text-only call after stop
    this._tools = [];
    const finalReq = this._adapter.buildRequest({
      model: this._model.config.modelId,
      messages: this.messages,
      maxTokens: this._maxTokens,
      stream: false,
      provider: this._model.config.provider,
    });
    const finalRaw = await this._callWithRetry(finalReq);
    const finalParsed = this._adapter.parseResponse(finalRaw);
    const finalText = stripThinkTags(finalParsed.text, (msg) => this._log(msg));
    this.messages.push({ role: "assistant", content: finalText });
    this._log(`[LOOP_EXIT reason=forced_stop turns=${turnCount} total_input=${this._inputTotal} total_output=${this._outputTotal}]`);
    return finalText;
  }

  // ---------------------------------------------------------------------------
  // API call with retry (REQ-ARCH-10)
  // ---------------------------------------------------------------------------

  private async _callWithRetry(wireReq: Record<string, unknown>): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        return await this._rawCall(wireReq);
      } catch (e: unknown) {
        lastError = e;
        if (!this._isRetryable(e)) throw e;
        if (isAbortRequested()) throw new AbortRequested();

        let delay = Math.min(RETRY_BASE * Math.pow(RETRY_MULT, attempt - 1), RETRY_CAP);
        // Retry-After header
        const retryAfter = this._getRetryAfter(e);
        if (retryAfter) delay = Math.min(retryAfter, RETRY_CAP);
        delay = jitter(delay);

        this._log(`[RETRY attempt=${attempt} delay=${delay.toFixed(1)}s reason=${this._errorReason(e)}]`);
        await abortAwareSleep(delay);
      }
    }

    // Fallback (REQ-MC-4)
    if (this._model.config.fallback) {
      this._log(`[MODEL_FALLBACK primary=${this._model.config.alias} fallback=${this._model.config.fallback}]`);
      const { resolveModel } = require("../models.js");
      const fallback = resolveModel(this._model.config.fallback);
      this._closeClient();
      this._model = fallback;
      this._adapter = getAdapter(fallback.config.protocol);
      this._client = this._adapter.createClient(fallback.config);
      // Rebuild request for new model
      wireReq.model = fallback.config.modelId;
      return this._rawCall(wireReq);
    }

    throw lastError;
  }

  private async _rawCall(wireReq: Record<string, unknown>): Promise<unknown> {
    return this._adapter.call(this._client, wireReq);
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  private _dedup(calls: ToolCall[]): { unique: ToolCall[]; idMap: Map<string, string[]> } {
    const idMap = new Map<string, string[]>();
    const unique: ToolCall[] = [];
    for (const tc of calls) {
      const sig = `${tc.function.name}:${tc.function.arguments}`;
      const existing = idMap.get(sig);
      if (existing) {
        existing.push(tc.id);
      } else {
        idMap.set(sig, [tc.id]);
        unique.push(tc);
      }
    }
    const dedupCount = calls.length - unique.length;
    if (dedupCount > 0) {
      for (const [sig, ids] of idMap) {
        if (ids.length > 1) {
          const name = sig.split(":")[0];
          this._log(`[DEDUP] ${ids.length} identical calls to ${name} reduced to 1`);
        }
      }
    }
    return { unique, idMap };
  }

  private async _executeCalls(calls: ToolCall[], toolsCalledThisTurn: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Partition into batches
    const batches: Array<{ calls: ToolCall[]; concurrent: boolean }> = [];
    let currentBatch: ToolCall[] = [];
    let currentConcurrent = false;

    for (const tc of calls) {
      const safe = isConcurrentSafe(tc, this._tools);
      if (!currentBatch.length) {
        currentBatch = [tc];
        currentConcurrent = safe;
      } else if (safe === currentConcurrent && safe) {
        currentBatch.push(tc);
      } else {
        batches.push({ calls: currentBatch, concurrent: currentConcurrent });
        currentBatch = [tc];
        currentConcurrent = safe;
      }
    }
    if (currentBatch.length) batches.push({ calls: currentBatch, concurrent: currentConcurrent });

    for (const batch of batches) {
      if (batch.concurrent && batch.calls.length > 1) {
        const promises = batch.calls.map(tc => this._executeOne(tc, toolsCalledThisTurn));
        const batchResults = await Promise.all(promises);
        for (let i = 0; i < batch.calls.length; i++) {
          const sig = `${batch.calls[i].function.name}:${batch.calls[i].function.arguments}`;
          results.set(sig, batchResults[i]);
        }
      } else {
        for (const tc of batch.calls) {
          const result = await this._executeOne(tc, toolsCalledThisTurn);
          const sig = `${tc.function.name}:${tc.function.arguments}`;
          results.set(sig, result);
        }
      }
    }

    return results;
  }

  private async _executeOne(tc: ToolCall, toolsCalledThisTurn: string[]): Promise<string> {
    const name = tc.function.name;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
    args = normalizeArgs(name, args, (msg) => this._log(msg));

    this.onToolCall?.(name, tc.function.arguments);
    toolsCalledThisTurn.push(name);

    // Before hook
    if (this.beforeToolCall) {
      const intercepted = this.beforeToolCall(name, JSON.stringify(args));
      if (intercepted !== null && intercepted !== undefined) {
        this.onToolResult?.(name, intercepted);
        return intercepted;
      }
    }

    const handler = this._toolHandlers[name];
    let result: string;
    if (!handler) {
      result = `Error: no handler for tool '${name}'`;
    } else {
      try {
        result = handler(...Object.values(args));
      } catch (e: unknown) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // After hook
    if (this.afterToolCall) {
      result = this.afterToolCall(name, result);
    }

    this.onToolResult?.(name, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _loopState(turnCount: number): LoopState {
    return {
      messages: this.messages,
      turnCount,
      inputTokensTotal: this._inputTotal,
      outputTokensTotal: this._outputTotal,
      toolsCalledThisTurn: [],
    };
  }

  private _isRetryable(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as Record<string, unknown>)?.status as number | undefined;
    if (status === 429) return true;
    if (status && status >= 500) return true;
    if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return true;
    if (status && status >= 400 && status < 500) return false;
    return false;
  }

  private _isContextLengthError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as Record<string, unknown>)?.status as number | undefined;
    return status === 413 || msg.includes("context length") || msg.includes("tokens exceed");
  }

  private _getRetryAfter(e: unknown): number | undefined {
    const headers = (e as Record<string, unknown>)?.headers as Record<string, string> | undefined;
    const val = headers?.["retry-after"];
    if (val) {
      const n = parseInt(val, 10);
      return isNaN(n) ? undefined : n;
    }
    return undefined;
  }

  private _errorReason(e: unknown): string {
    const status = (e as Record<string, unknown>)?.status as number | undefined;
    if (status) return `HTTP_${status}`;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED")) return "connection_refused";
    return "unknown";
  }

  private _closeClient(): void {
    try {
      const c = this._client as Record<string, unknown>;
      if (typeof c?.close === "function") (c.close as () => void)();
    } catch { /* */ }
  }

  private _log(msg: string): void {
    if (!this._logPath) return;
    try { appendFileSync(this._logPath, msg + "\n"); } catch { /* */ }
  }
}
