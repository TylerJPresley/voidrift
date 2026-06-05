/**
 * Turn execution — business logic extracted from the App component.
 * Handles model routing, state construction, and orchestration invocation.
 */
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { runTurn } from "./orchestration/graph.js";
import { createTierAdapter, createAdapter } from "./adapters/factory.js";
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

  // Derive mode from active agent's approvalMode
  const modeMap = { deny: "plan", prompt: "chat", autonomous: "vibe" } as const;
  const activeMode = modeMap[engine.agents.active.approvalMode] || "chat";

  // Resolve the model tier: use static override if declared, otherwise delegate to the Model Router
  let tier = engine.agents.active.modelTier || "auto";
  if (tier === "auto") {
    tier = routeTier({ 
      activeNode: null, 
      activeMode, 
      inputLength: userMessage.length, 
      mentionedFiles: 0 
    });
  }
  const isTierKey = tier === "flash" || tier === "utility" || tier === "dense";
  const resolved = isTierKey
    ? createTierAdapter(tier as any, engine.container.config)
    : createAdapter(tier, engine.container.config);

  // Emit resolved model name so the UI can display it
  callbacks.onChunk({ type: "status", message: `model:${resolved.name}` });

  const state: GraphState = {
    activePlan: engine.context.context.workspace.activePlan,
    focusedFiles: engine.context.context.workspace.focusedFiles.map(f => f.path),
    diagnostics: engine.context.context.work.diagnostics,
    routingFlag: null,
    messages: [],
    activeMode,
    activePersona: engine.context.context.governance.activePersona,
  };

  // Resolve skills for this turn (agent-bound + trigger-based)
  const resolvedSkills = engine.skills.resolve(
    {
      focusedFiles: engine.context.context.workspace.focusedFiles.map(f => f.path),
      userInput: userMessage,
      activePlan: engine.context.context.workspace.activePlan,
    },
    engine.agents.active.id,
  );
  engine.context.setSkills(resolvedSkills);

  // Compile the full three-partition context via the Prompt Cache Optimizer
  const compiled = compilePrompt(engine.context.context);

  // Extract system prompt: merge all system messages (governance + workspace) into one block
  const systemParts = compiled.filter(m => m.role === "system").map(m => m.content);
  const systemPrompt = systemParts.join("\n\n") || engine.context.context.governance.activePersona;

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
      state,
      onChunk: callbacks.onChunk,
      signal: callbacks.signal,
      context: engine.context,
      config: engine.container.config,
      tier,
      agent: engine.agents.active,
    }, engine.container.bus);
  });

  if (result) {
    engine.logger.logModelResponse(resolved.name, result.response.text, result.response.toolCalls, result.response.usage, result.response.timing);
    engine.stats.recordTurn(resolved.name, result.response.usage.promptTokens, result.response.usage.completionTokens || 0, 0, 0);
    engine.context.addMessage({ role: "assistant", content: result.response.text });
    engine.budget.add(result.response.usage.totalTokens || 0);
    if (result.stateUpdates.activePlan !== undefined) engine.context.setPlan(result.stateUpdates.activePlan);
  }

  return result;
}
