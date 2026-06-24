/**
 * Turn execution — business logic extracted from the App component.
 * Handles model routing, state construction, and orchestration invocation.
 */
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { runTurn } from "./orchestration/graph.js";
import { createTierAdapter, createAdapter } from "./adapters/factory.js";
import type { Tier } from "./adapters/factory.js";
import { shouldEscalate, escalateTier } from "./router/index.js";
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

  // Context pressure warning — inform the model when budget is getting tight
  const contextPct = engine.budget.getContextPct(engine.context.getTokenCount());
  if (contextPct >= 50 && contextPct < 80) {
    engine.context.injectTurnContext("Context Budget", `Context usage: ${contextPct}%. Be concise. Avoid loading large files without offset/limit.`);
  } else if (contextPct >= 80) {
    engine.context.injectTurnContext("Context Budget", `⚠️ Context usage: ${contextPct}% — critically high. Summarize rather than quote. Avoid new file reads unless essential. Consider calling \`escalate\` to switch to a model with a larger context window.`);
  }

  // Message decay — summarize old turns to free context budget
  const decayAfter = engine.container.config.decayAfterTurns ?? 20;
  if (decayAfter > 0) {
    const msgs = engine.context.getMessages();
    const userCount = msgs.filter(m => m.role === "user").length;
    if (userCount > decayAfter) {
      const { compactHistory } = await import("./session/compactor.js");
      const result = compactHistory(msgs, engine.budget.state.used, engine.budget.state.limit * 0.5);
      if (result.compacted) engine.context.setMessages(result.messages);
    }
  }

  // Detect image paths in user input and attach as content blocks
  const { text: cleanedMessage, contentBlocks } = extractImages(userMessage, engine.workspaceRoot);
  engine.context.addMessage({ role: "user", content: cleanedMessage, contentBlocks: contentBlocks.length ? contentBlocks : undefined });
  const userMessage_ = cleanedMessage;

  // Resolve the model tier: use static override if declared, otherwise delegate to the Model Router
  let tier: Tier | string = engine.agents.active.modelTier || "auto";
  if (tier === "auto") {
    tier = engine.agents.active.type === "task" ? "utility" : "flash";
  }
  // De-escalation: if tier was escalated to dense but context usage has dropped, revert to auto routing
  if (engine.agents.active.modelTier === "dense") {
    const modelKey = engine.container.config.tiers["dense"];
    const modelConfig = modelKey ? engine.container.config.models[modelKey] : undefined;
    const contextLimit = modelConfig?.contextLimit ?? 32768;
    if (engine.budget.state.used < contextLimit * 0.5) {
      engine.agents.active.modelTier = "auto";
      tier = engine.agents.active.type === "task" ? "utility" : "flash";
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
  // Inject MCP server instructions if any connected servers provide them
  const mcpInstructions = engine.mcp.getAllInstructions();
  if (mcpInstructions.length) systemParts.push(mcpInstructions.join("\n"));
  const systemPrompt = systemParts.join("\n\n") || engine.context.context.agent.activePersona;

  // Extract conversation history (only user/assistant messages, exclude current turn)
  const history = compiled
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(0, -1) // exclude the current user message (already passed as userMessage)
    .map(m => {
      if (m.role === "user" && m.contentBlocks?.length) {
        return new HumanMessage({ content: m.contentBlocks as any });
      }
      return m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content);
    });

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

  // If turn failed and images were attached, provide a friendly message
  if (!result && contentBlocks.length) {
    const msgs = engine.context.getMessages();
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.content.includes("Error:")) {
      engine.context.setMessages(msgs.slice(0, -1));
      engine.context.addMessage({ role: "assistant", content: "This model doesn't support images. Try switching to a vision-capable model (e.g. Gemini, GPT-4o, Qwen-VL, Claude)." });
    }
  }

  // General failure — emit error so UI always shows feedback
  if (!result && !contentBlocks.length) {
    callbacks.onChunk({ type: "error", message: "Request failed — no response from model.", retryable: true });
  }

  if (result) {
    engine.logger.logModelResponse(resolved.name, result.response.text, result.response.toolCalls, result.response.usage, result.response.timing);
    engine.stats.recordTurn(resolved.name, result.response.usage.promptTokens, result.response.usage.completionTokens || 0, 0, result.response.timing ? result.response.timing.endAt - result.response.timing.requestStart : 0);
    engine.context.addMessage({ role: "assistant", content: result.response.text });
    engine.budget.set(engine.context.getTokenCount());

    // Compact large tool results — replace with pointers since summaries are in drift cache
    const msgs = engine.context.getMessages();
    let compacted = false;
    for (let i = 0; i < msgs.length - 2; i++) {
      const m = msgs[i];
      if (m.role === "tool" && m.content.length > 2000) {
        const firstLine = m.content.split("\n")[0];
        msgs[i] = { ...m, content: `${firstLine}\n[full content available via read_file — summary cached in drift]` };
        compacted = true;
      }
    }
    if (compacted) engine.context.setMessages(msgs);

    // Post-turn escalation check: if context usage is high, escalate tier for next turn
    if (isTierKey) {
      // Model-requested escalation/de-escalation via tool calls
      const toolNames = result.response.toolCalls.map(tc => tc.name);
      if (toolNames.includes("escalate") && engine.agents.active.modelTier !== "dense") {
        engine.agents.active.modelTier = "dense";
        callbacks.onChunk({ type: "status", message: `escalated:dense` });
      } else if (toolNames.includes("deescalate")) {
        engine.agents.active.modelTier = "auto";
        callbacks.onChunk({ type: "status", message: `deescalated:flash` });
      } else {
        // Automatic escalation: context overflow
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
  }

  return result;
}

// ─── Image Detection ─────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import type { ContentBlock } from "./session/context.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const IMAGE_PATH_REGEX = /(?:^|\s)((?:\.\/|\/|~\/)?[\w./_-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$)/gi;

function extractImages(input: string, workspaceRoot: string): { text: string; contentBlocks: ContentBlock[] } {
  const blocks: ContentBlock[] = [];
  let text = input;

  const matches = [...input.matchAll(IMAGE_PATH_REGEX)];
  for (const match of matches) {
    const rawPath = match[1];
    const resolved = rawPath.startsWith("~/")
      ? join(process.env.HOME || "", rawPath.slice(2))
      : isAbsolute(rawPath)
        ? rawPath
        : join(workspaceRoot, rawPath);

    if (!existsSync(resolved)) continue;

    try {
      const data = readFileSync(resolved);
      const ext = resolved.split(".").pop()?.toLowerCase() || "png";
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const base64 = data.toString("base64");
      blocks.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
      text = text.replace(rawPath, `[image: ${rawPath}]`);
    } catch {}
  }

  if (blocks.length) {
    blocks.unshift({ type: "text", text });
  }

  return { text, contentBlocks: blocks };
}
