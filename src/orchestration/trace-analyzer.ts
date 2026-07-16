/**
 * Trace Analyzer — learns from session failure patterns.
 *
 * Accumulates signals from tool failures, guardrail blocks, and struggles.
 * When a pattern repeats N times, suggests creating a skill or memory
 * to prevent future occurrences.
 *
 * Subscribes to:
 * - AFTER_TOOL_EXECUTE (status: "error")
 * - WARNING_EMITTED (guardrail advisories)
 * - STRUGGLE_DETECTED (model intent without action)
 *
 * Emits:
 * - IMPROVEMENT_SUGGESTED — surfaced to the user via callout or /stats
 */
import type { EventBus } from "../events/bus.js";

export interface ImprovementSuggestion {
  type: "skill" | "memory" | "policy";
  title: string;
  reason: string;
  pattern: string;
  occurrences: number;
}

interface FailurePattern {
  key: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  samples: string[];
}

const SUGGESTION_THRESHOLD = 3;
const MAX_SAMPLES = 5;

export class TraceAnalyzer {
  private patterns = new Map<string, FailurePattern>();
  private suggestions: ImprovementSuggestion[] = [];
  private unsubs: Array<() => void> = [];

  constructor(private bus: EventBus, private threshold = SUGGESTION_THRESHOLD) {}

  attach(): () => void {
    this.unsubs.push(
      this.bus.subscribe("AFTER_TOOL_EXECUTE", (event) => {
        if (event.payload.status === "error") {
          const tool = event.payload.toolName;
          const output = event.payload.output.slice(0, 150);
          // Normalize the error to a pattern key (tool + error type)
          const key = this.normalizeError(tool, output);
          this.record(key, `${tool}: ${output}`);
        }
      }),

      this.bus.subscribe("WARNING_EMITTED", (event) => {
        if (event.payload.category === "block") {
          const key = `guardrail:${event.payload.source}:${event.payload.message.slice(0, 50)}`;
          this.record(key, event.payload.message);
        }
      }),

      this.bus.subscribe("STRUGGLE_DETECTED", (event) => {
        const key = `struggle:${event.payload.expectedAction}`;
        this.record(key, event.payload.text.slice(0, 100));
      }),
    );

    return () => { this.unsubs.forEach(u => u()); };
  }

  private record(key: string, sample: string): void {
    const existing = this.patterns.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      if (existing.samples.length < MAX_SAMPLES) existing.samples.push(sample);
      if (existing.count === this.threshold) {
        this.suggest(existing);
      }
    } else {
      this.patterns.set(key, { key, count: 1, firstSeen: Date.now(), lastSeen: Date.now(), samples: [sample] });
    }
  }

  private suggest(pattern: FailurePattern): void {
    const suggestion = this.buildSuggestion(pattern);
    if (suggestion) {
      this.suggestions.push(suggestion);
      this.bus.publish("WARNING_EMITTED", {
        message: `Recurring pattern detected (${pattern.count}x): ${suggestion.title}. Consider saving a memory or skill.`,
        source: "trace-analyzer",
        category: "suggestion",
      });
    }
  }

  private buildSuggestion(pattern: FailurePattern): ImprovementSuggestion | null {
    if (pattern.key.startsWith("guardrail:")) {
      return {
        type: "skill",
        title: `Guardrail fires repeatedly: ${pattern.key.split(":").slice(2).join(":")}`,
        reason: `Blocked ${pattern.count} times this session. The model keeps attempting the same invalid pattern.`,
        pattern: pattern.key,
        occurrences: pattern.count,
      };
    }
    if (pattern.key.startsWith("struggle:")) {
      return {
        type: "skill",
        title: `Model struggles with: ${pattern.key.slice(9)}`,
        reason: `Model expressed intent to act ${pattern.count} times without calling tools. May need clearer guidance.`,
        pattern: pattern.key,
        occurrences: pattern.count,
      };
    }
    if (pattern.key.startsWith("tool:")) {
      return {
        type: "memory",
        title: `Recurring tool failure: ${pattern.samples[0]?.slice(0, 60)}`,
        reason: `Same error ${pattern.count} times. Save the fix as a memory so future sessions don't repeat.`,
        pattern: pattern.key,
        occurrences: pattern.count,
      };
    }
    return null;
  }

  private normalizeError(tool: string, output: string): string {
    // Normalize to reduce noise — strip line numbers, paths, etc.
    const normalized = output
      .replace(/line \d+/gi, "line N")
      .replace(/:\d+:\d+/g, ":N:N")
      .replace(/\/[\w/.]+\.(ts|js|py|rs)/g, "<file>")
      .slice(0, 80);
    return `tool:${tool}:${normalized}`;
  }

  get pendingSuggestions(): ImprovementSuggestion[] {
    return [...this.suggestions];
  }

  get activePatterns(): Map<string, FailurePattern> {
    return new Map(this.patterns);
  }
}
