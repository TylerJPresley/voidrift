/**
 * Turn execution — business logic extracted from the App component.
 * Handles model routing, state construction, and orchestration invocation.
 */
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { runTurn } from "./orchestration/graph.js";
import { createTierAdapter } from "./adapters/factory.js";
import { routeTier } from "./router/index.js";
import { compilePrompt } from "./session/compiler.js";
import type { EngineContext } from "./engine.js";
import type { StreamChunk } from "./adapters/types.js";
import type { OrchestrationResult } from "./orchestration/graph.js";
import type { GraphState } from "./orchestration/nodes.js";

export interface TurnCallbacks {
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
}

export async function executeTurn(engine: EngineContext, userMessage: string, callbacks: TurnCallbacks): Promise<OrchestrationResult | null> {
  engine.context.addMessage({ role: "user", content: userMessage });

  const tier = routeTier({ activeNode: null, activeMode: engine.cycler.mode, inputLength: userMessage.length, mentionedFiles: 0 });
  const resolved = createTierAdapter(tier, engine.container.config);

  const state: GraphState = {
    activePlan: engine.context.context.workspace.activePlan,
    focusedFiles: engine.context.context.workspace.focusedFiles.map(f => f.path),
    diagnostics: engine.context.context.work.diagnostics,
    routingFlag: null,
    messages: [],
    activeMode: engine.cycler.mode,
    activePersona: engine.context.context.governance.activePersona,
  };

  // Compile the full three-partition context via the Prompt Cache Optimizer
  const compiled = compilePrompt(engine.context.context);

  // Extract system prompt: merge all system messages (governance + workspace) into one block
  const systemParts = compiled.filter(m => m.role === "system").map(m => m.content);
  const systemPrompt = systemParts.join("\n\n");

  // Extract conversation history (everything except system messages and the last user message we just added)
  const history = compiled
    .filter(m => m.role !== "system")
    .slice(0, -1) // exclude the current user message (already passed as userMessage)
    .map(m => m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content));

  engine.logger.logModelPrompt(resolved.name, history.length + 2, systemPrompt.length);

  const result = await engine.guard.run(async () => {
    return runTurn({
      userMessage,
      client: resolved.client,
      systemPrompt,
      history,
      state,
      onChunk: callbacks.onChunk,
      signal: callbacks.signal,
      context: engine.context,
      config: engine.container.config,
    }, engine.container.bus);
  });

  if (result) {
    engine.logger.logModelResponse(resolved.name, result.response.text, result.response.toolCalls, result.response.usage);
    engine.stats.recordTurn(resolved.name, result.response.usage.promptTokens, result.response.usage.completionTokens || 0, 0, 0);
    engine.context.addMessage({ role: "assistant", content: result.response.text });
    engine.budget.add(result.response.usage.totalTokens || 0);
    if (result.stateUpdates.activePlan !== undefined) engine.context.setPlan(result.stateUpdates.activePlan);
  }

  return result;
}
