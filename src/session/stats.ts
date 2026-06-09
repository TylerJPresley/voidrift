import type { EventBus } from "../events/bus.js";

export interface ModelUsage {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTimeMs: number;
}

export interface ToolStats {
  total: number;
  success: number;
  failed: number;
  totalTimeMs: number;
}

export interface SessionStats {
  sessionId: string;
  startedAt: number;
  turns: number;
  modelUsage: Map<string, ModelUsage>;
  tools: ToolStats;
}

/**
 * Tracks real-time session metrics: duration, turns, per-model token usage,
 * tool call success/failure counts, and timing breakdowns.
 */
export class StatsTracker {
  private stats: SessionStats;

  constructor(sessionId: string) {
    this.stats = {
      sessionId,
      startedAt: Date.now(),
      turns: 0,
      modelUsage: new Map(),
      tools: { total: 0, success: 0, failed: 0, totalTimeMs: 0 },
    };
  }

  get current(): SessionStats {
    return this.stats;
  }

  get durationMs(): number {
    return Date.now() - this.stats.startedAt;
  }

  get durationFormatted(): string {
    const s = Math.floor(this.durationMs / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  recordTurn(modelName: string, inputTokens: number, outputTokens: number, cacheTokens: number, timeMs: number): void {
    this.stats.turns++;
    const existing = this.stats.modelUsage.get(modelName) ?? { turns: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTimeMs: 0 };
    existing.turns++;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheTokens += cacheTokens;
    existing.totalTimeMs += timeMs;
    this.stats.modelUsage.set(modelName, existing);
  }

  recordToolCall(success: boolean, timeMs: number): void {
    this.stats.tools.total++;
    if (success) this.stats.tools.success++;
    else this.stats.tools.failed++;
    this.stats.tools.totalTimeMs += timeMs;
  }

  attach(bus: EventBus): () => void {
    return bus.subscribe("TURN_COMPLETE", () => {
      // Turn count is tracked via recordTurn calls from the orchestration layer
    });
  }
}
