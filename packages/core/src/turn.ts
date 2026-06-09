/**
 * Turn execution — business logic extracted from the App component.
 * Handles model routing, state construction, and orchestration invocation.
 */
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { runTurn } from "./orchestration/graph.js";
import { createTierAdapter, createAdapter } from "./adapters/factory.js";
import type { Tier } from "./adapters/factory.js";
import { routeTier, shouldEscalate, escalateTier } from "./router/index.js";
import { compilePrompt } from "./session/compiler.js";
import type { EngineContext } from "./engine.js";
import type { StreamChunk } from "./adapters/types.js";
import type { OrchestrationResult } from "./orchestration/graph.js";

export interface TurnCallbacks {
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
}

export async function executeTurn(engine: EngineContext, userMessage: string, callbacks: TurnCallbacks): Promise<OrchestrationResult | null> {
  engine.context.clearTurnContext();
  engine.context.addMessage({ role: "user", content: userMessage });

  // Resolve the model tier: use static override if declared, otherwise delegate to the Model Router
  let tier: Tier | string = engine.agents.active.modelTier || "auto";
  if (tier === "auto") {
    tier = routeTier({ 
      inputLength: userMessage.length, 
      mentionedFiles: 0 
    });
  }
  // De-escalation: if tier was escalated but context usage has dropped, revert to auto routing
  if (tier !== "auto" && engine.agents.active.modelTier !== "auto") {
    const modelKey = engine.container.config.tiers[tier as keyof typeof engine.container.config.tiers];
    const modelConfig = modelKey ? engine.container.config.models[modelKey] : undefined;
    const contextLimit = modelConfig?.contextLimit ?? 32768;
    if (engine.budget.state.used < contextLimit * 0.5) {
      engine.agents.active.modelTier = "auto";
      tier = routeTier({ inputLength: userMessage.length, mentionedFiles: 0 });
    }
  }
  const isTierKey = tier === "flash" || tier === "utility" || tier === "dense";
  const resolved = isTierKey
    ? createTierAdapter(tier as Tier, engine.container.config)
    : createAdapter(tier, engine.container.config);

  // Emit resolved model name so the UI can display it
  callbacks.onChunk({ type: "status", message: `model:${resolved.name}` });

  // Resolve skills for this turn (agent-bound + trigger-based)
  const resolvedSkills = engine.skills.resolve(
    {
      focusedFiles: engine.context.context.drift.focusedFiles.map(f => f.path),
      userInput: userMessage,
      activePlan: engine.context.context.orbit.activePlan,
    },
    engine.agents.active.id,
  );
  engine.context.setActiveSkills(resolvedSkills);

  // Compile the full three-partition context via the Prompt Cache Optimizer
  const compiled = compilePrompt(engine.context.context, {
    workspaceRoot: engine.workspaceRoot,
    modelName: resolved.name,
    prompts: engine.prompts,
  });

  // Extract system prompt: merge all system messages (governance + workspace) into one block
  const systemParts = compiled.filter(m => m.role === "system").map(m => m.content);
  const systemPrompt = systemParts.join("\n\n") || engine.context.context.agent.activePersona;

  // Extract conversation history (only user/assistant messages, exclude current turn)
  const history = compiled
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(0, -1) // exclude the current user message (already passed as userMessage)
    .map(m => m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content));

  engine.logger.logModelPrompt(resolved.name, compiled);

  const result = await engine.guard.run(async () => {
    return runTurn({
      userMessage,
      client: resolved.client,
      systemPrompt,
      history,
      onChunk: callbacks.onChunk,
      signal: callbacks.signal,
      context: engine.context,
      config: engine.container.config,
      tier: isTierKey ? tier as Tier : undefined,
      agent: engine.agents.active,
      mcp: engine.mcp,
    }, engine.container.bus);
  });

  if (result) {
    engine.logger.logModelResponse(resolved.name, result.response.text, result.response.toolCalls, result.response.usage, result.response.timing);
    engine.stats.recordTurn(resolved.name, result.response.usage.promptTokens, result.response.usage.completionTokens || 0, 0, 0);
    engine.context.addMessage({ role: "assistant", content: result.response.text });
    engine.budget.add(result.response.usage.totalTokens || 0);

    // Post-turn escalation check: if context usage is high, escalate tier for next turn
    if (isTierKey) {
      const modelConfig = engine.container.config.models[engine.container.config.tiers[tier as keyof typeof engine.container.config.tiers]];
      const contextLimit = modelConfig?.contextLimit ?? 32768;
      if (shouldEscalate(engine.budget.state.used, contextLimit, 0)) {
        const next = escalateTier(tier as Tier);
        if (next && engine.agents.active.modelTier === "auto") {
          engine.agents.active.modelTier = next;
          callbacks.onChunk({ type: "status", message: `escalated:${next}` });
        }
      }
    }
  }

  return result;
}
