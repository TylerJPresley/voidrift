/**
 * Turn execution — event-driven orchestrator.
 *
 * The turn flow:
 * 1. Image extraction + user message (inline — produces local vars)
 * 2. Tier resolution + de-escalation (inline — determines model)
 * 3. await bus.publishAndWait("TURN_BEFORE") — subscribers enrich context
 * 4. Compile prompt + invoke model
 * 5. Record result (inline — updates context chain)
 * 6. await bus.publishAndWait("TURN_AFTER") — subscribers react to result
 * 7. bus.publish("TURN_COMPLETE") — fire-and-forget persistence
 *
 * All pre/post concerns live as subscribers registered in bootstrap.
 */
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { runTurn } from "./orchestration/graph.js";
import { createTierAdapter, createAdapter } from "./adapters/factory.js";
import type { Tier } from "./adapters/factory.js";
import { shouldEscalate, escalateTier } from "./router/index.js";
import { compilePrompt } from "./session/compiler.js";
import { extractImages } from "./infrastructure/image-extraction.js";
import type { EngineContext } from "./engine.js";
import type { StreamChunk } from "./adapters/types.js";
import type { OrchestrationResult } from "./orchestration/graph.js";

export interface TurnCallbacks {
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
}

export async function executeTurn(engine: EngineContext, userMessage: string, callbacks: TurnCallbacks): Promise<OrchestrationResult | null> {
  engine.context.clearTurnContext();

  // ─── Inline: Image extraction + user message ───────────────────────────
  const { text: cleanedMessage, contentBlocks } = extractImages(userMessage, engine.workspaceRoot);
  engine.context.addMessage({ role: "user", content: cleanedMessage, contentBlocks: contentBlocks.length ? contentBlocks : undefined });

  // ─── Inline: Model resolution ─────────────────────────────────────────
  let tier: Tier | string;
  if (engine.agents.active.type === "task") {
    // Task agents use their declared role (utility/flash/dense/auto)
    tier = engine.agents.active.role || "utility";
    if (tier === "auto") tier = "utility";
  } else {
    // Interactive agents use the session's modelSelected
    const modelSelected = engine.container.config.modelSelected || "auto";
    if (modelSelected === "auto") {
      tier = "flash";
    } else {
      tier = modelSelected; // specific model name
    }
  }
  // De-escalation: if was escalated to dense but context usage has dropped, revert
  if (engine.agents.active.autoEscalated && tier === "dense") {
    const modelKey = engine.container.config.modelTierDense;
    const modelConfig = modelKey ? engine.container.config.models[modelKey] : undefined;
    const contextLimit = modelConfig?.contextLimit ?? 32768;
    if (engine.budget.state.used < contextLimit * 0.5) {
      engine.agents.active.autoEscalated = false;
      tier = engine.agents.active.type === "task" ? "utility" : "flash";
    }
  }
  const isTierKey = tier === "flash" || tier === "utility" || tier === "dense";
  const resolved = isTierKey
    ? createTierAdapter(tier as Tier, engine.container.config)
    : createAdapter(tier, engine.container.config);

  // Emit resolved model name so the UI can display it
  callbacks.onChunk({ type: "status", message: `model:${resolved.name}` });
  engine.container.bus.publish("MODEL_RESOLVED", { name: resolved.name, tier: isTierKey ? tier as string : "custom", protocol: resolved.config.protocol });

  // ─── TURN_BEFORE: subscribers enrich context ──────────────────────────────
  await engine.container.bus.publishAndWait("TURN_BEFORE", {
    userMessage: cleanedMessage,
    activeTools: engine.context.context.agent.activeTools,
    activePlan: engine.context.context.orbit.activePlan,
    recentSummaries: engine.context.context.void.messages.filter(m => m.role === "assistant" && m.summary).slice(-3).map(m => m.summary!),
    recentTools: engine.context.context.void.messages.filter(m => m.role === "assistant").slice(-3).flatMap(m => m.toolCalls || []),
  });

  // ─── Compile prompt ────────────────────────────────────────────────────
  const compiled = compilePrompt(engine.context.context, {
    workspaceRoot: engine.workspaceRoot,
    modelName: resolved.name,
    sessionId: engine.sessionId,
    contextLimit: resolved.config.contextLimit,
    maxOutputTokens: resolved.config.maxOutputTokens,
    prompts: engine.prompts,
    tier: isTierKey && engine.container.config.modelTierFlash !== engine.container.config.modelTierDense ? tier as string : undefined,
  });

  const systemParts = compiled.filter(m => m.role === "system").map(m => m.content);
  const mcpInstructions = engine.mcp.getAllInstructions();
  if (mcpInstructions.length) systemParts.push(mcpInstructions.join("\n"));
  const systemPrompt = systemParts.join("\n\n") || engine.context.context.agent.activePersona;

  const history = compiled
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map(m => {
      if (m.role === "user" && m.contentBlocks?.length) {
        return new HumanMessage({ content: m.contentBlocks as any });
      }
      if (m.role === "user") return new HumanMessage(m.content);
      return new AIMessage(m.content);
    });

  engine.logger.logModelPrompt(resolved.name, compiled);

  // ─── Invoke model ──────────────────────────────────────────────────────
  let reasoningBuffer = "";
  const wrappedOnChunk = (chunk: StreamChunk) => {
    if (chunk.type === "reasoning") {
      reasoningBuffer += chunk.text;
    }
    callbacks.onChunk(chunk);
  };

  const result = await engine.guard.run(async () => {
    return runTurn({
      userMessage: cleanedMessage,
      client: resolved.client,
      systemPrompt,
      history,
      onChunk: wrappedOnChunk,
      signal: callbacks.signal,
      context: engine.context,
      config: engine.container.config,
      tier: isTierKey ? tier as Tier : undefined,
      agent: engine.agents.active,
      mcp: engine.mcp,
      workspaceRoot: engine.workspaceRoot,
      planManager: engine.planManager,
      scheduler: engine.scheduler,
    }, engine.container.bus);
  });

  // Log accumulated reasoning/thinking if any was produced
  if (reasoningBuffer) {
    engine.logger.local("info", "model", "reasoning", { text: reasoningBuffer.slice(0, 2000) });
  }

  // ─── Handle failures ───────────────────────────────────────────────────
  if (!result && contentBlocks.length) {
    const msgs = engine.context.getMessages();
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.content.includes("Error:")) {
      engine.context.setMessages(msgs.slice(0, -1));
      engine.context.addMessage({ role: "assistant", content: "This model doesn't support images. Try switching to a vision-capable model (e.g. Gemini, GPT-4o, Qwen-VL, Claude)." });
    }
  }
  if (!result && !contentBlocks.length) {
    callbacks.onChunk({ type: "error", message: "Request failed — no response from model.", retryable: true });
  }

  // ─── Record result (inline — must complete before TURN_AFTER) ───────────
  if (result) {
    engine.context.addMessage({ role: "assistant", content: result.response.text, toolCalls: result.response.toolCalls.map(tc => tc.name) });
    engine.budget.set(result.response.usage.promptTokens || engine.context.getTokenCount());
    engine.logger.logModelResponse(resolved.name, result.response.text, result.response.toolCalls, result.response.usage, result.response.timing);
  }

  // ─── TURN_AFTER: subscribers react to result ────────────────────────────
  if (result) {
    await engine.container.bus.publishAndWait("TURN_AFTER", {
      userMessage: cleanedMessage,
      responseText: result.response.text,
      toolsUsed: result.response.toolCalls.map(tc => tc.name),
      turnId: `turn-${Date.now()}`,
      model: resolved.name,
      usage: { promptTokens: result.response.usage.promptTokens, completionTokens: result.response.usage.completionTokens || 0 },
      timingMs: result.response.timing ? result.response.timing.endAt - result.response.timing.requestStart : 0,
    });
  }

  // ─── TURN_COMPLETE: fire-and-forget persistence ─────────────────────────
  engine.container.bus.publish("TURN_COMPLETE", { turnId: `turn-${Date.now()}` });

  return result;
}
