/**
 * Concurrent Agent Executor.
 *
 * Manages parallel task agent execution with:
 * - Bounded concurrency via LangChain's maxConcurrency
 * - Fallback chains per agent (flash → utility → dense)
 * - Event bus notifications for spawn/complete/fail
 * - Queuing when at capacity
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EventBus } from "../events/bus.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { AgentManifest } from "../agents/registry.js";
import type { ContextManager } from "../session/context.js";
import { createFallbackChain } from "../adapters/fallbacks.js";
import type { Tier } from "../adapters/factory.js";

interface TaskRequest {
  agentId: string;
  instruction: string;
  systemPrompt: string;
  manifest: AgentManifest;
  tier: Tier;
}

interface TaskResult {
  agentId: string;
  output: string;
  status: "success" | "failed";
}

export class ConcurrentExecutor {
  private active = 0;
  private queue: Array<{ request: TaskRequest; resolve: (r: TaskResult) => void }> = [];

  constructor(
    private config: VoidRiftConfig,
    private bus?: EventBus
  ) {}

  get maxConcurrency(): number {
    return this.config.maxConcurrentAgents ?? 1;
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }

  /**
   * Submit a task agent for execution.
   * If at capacity, queues the task and resolves when it completes.
   */
  async submit(request: TaskRequest, context?: ContextManager, signal?: AbortSignal): Promise<TaskResult> {
    if (this.active < this.maxConcurrency) {
      return this.execute(request, context, signal);
    }

    // Queue and wait
    return new Promise<TaskResult>((resolve) => {
      this.queue.push({ request, resolve });
    });
  }

  /**
   * Submit multiple tasks and run them with bounded concurrency.
   * Uses LangChain's native batch concurrency control.
   */
  async submitBatch(requests: TaskRequest[], context?: ContextManager, signal?: AbortSignal): Promise<TaskResult[]> {
    return Promise.all(requests.map(r => this.submit(r, context, signal)));
  }

  private async execute(request: TaskRequest, context?: ContextManager, signal?: AbortSignal): Promise<TaskResult> {
    this.active++;
    this.bus?.publish("SUBAGENT_SPAWNED", { subagentId: request.agentId });

    try {
      const client = createFallbackChain(request.tier, this.config);
      const { directChat } = await import("../orchestration/graph.js");

      const result = await directChat({
        userMessage: request.instruction,
        client,
        systemPrompt: request.systemPrompt,
        history: [],
        onChunk: () => {},
        signal,
        context,
        config: this.config,
        agent: request.manifest,
      }, this.bus);

      const output = result.response.text || "Task agent returned no output.";
      this.bus?.publish("SUBAGENT_COMPLETED", { subagentId: request.agentId, status: "success" });
      return { agentId: request.agentId, output, status: "success" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.bus?.publish("SUBAGENT_COMPLETED", { subagentId: request.agentId, status: "failed" });
      return { agentId: request.agentId, output: `Error: ${msg}`, status: "failed" };
    } finally {
      this.active--;
      this.drain();
    }
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.execute(next.request).then(next.resolve);
    }
  }
}
