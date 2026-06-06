import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EventBus } from "../events/bus.js";
import type { OnChunk } from "../adapters/stream.js";
import { directChat, type OrchestrationInput } from "./graph.js";
import type { GraphState } from "./nodes.js";

const MAX_GOAL_TURNS = 15;

export interface GoalResult {
  success: boolean;
  turns: number;
  terminationReason: "done" | "budget" | "interrupted";
}

/**
 * Autonomous Execution Loop (/goal).
 *
 * Runs directChat in a loop with auto-approval until:
 * - The model stops calling tools (signals completion)
 * - Turn budget exceeded
 * - User interrupts
 */
export async function runGoal(
  instruction: string,
  client: BaseChatModel,
  bus: EventBus,
  onChunk: OnChunk,
  signal?: { interrupted: boolean }
): Promise<GoalResult> {
  let turns = 0;

  const state: GraphState = {
    activePlan: null,
    focusedFiles: [],
    diagnostics: null,
    routingFlag: null,
    messages: [],
    activeMode: "vibe",
    activePersona: "",
  };

  while (turns < MAX_GOAL_TURNS) {
    if (signal?.interrupted) return { success: false, turns, terminationReason: "interrupted" };

    const input: OrchestrationInput = {
      userMessage: turns === 0 ? instruction : "Continue. If the task is complete, say so without calling any tools.",
      client,
      systemPrompt: "",
      history: [],
      state,
      onChunk,
    };

    const result = await directChat(input, bus);
    turns++;

    // If the model responded with text and no tool calls, it's done
    if (result.response.toolCalls.length === 0 && result.response.text.trim()) {
      return { success: true, turns, terminationReason: "done" };
    }
  }

  return { success: false, turns, terminationReason: "budget" };
}
