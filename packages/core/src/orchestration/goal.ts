import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EventBus } from "../events/bus.js";
import type { OnChunk } from "../adapters/stream.js";
import { directChat, type OrchestrationInput } from "./graph.js";

const MAX_GOAL_TURNS = 25;
const COMPLETION_TOKEN = "<!-- GOAL_COMPLETE -->";

const GOAL_SYSTEM_PROMPT = `You are in autonomous goal execution mode. You will work continuously until the goal is complete.

Rules:
- Execute tools freely without waiting for user input.
- If a command fails, read the error, fix the issue, and retry.
- Do NOT stop to ask for clarification — make reasonable decisions and continue.
- When you believe you are done, verify your work: confirm files exist, tests pass, and requirements are met.
- Only when you have verified completion with evidence, output exactly: <!-- GOAL_COMPLETE -->
- Do NOT output <!-- GOAL_COMPLETE --> until you have real evidence of success.
- "Having spent effort" is not the same as "being done." Only verified results count.`;

const CONTINUATION_MESSAGE = "The goal is not yet complete. You have not output <!-- GOAL_COMPLETE -->. Continue working toward the objective.";

export interface GoalResult {
  success: boolean;
  turns: number;
  terminationReason: "complete" | "budget" | "interrupted";
}

/**
 * Autonomous Execution Loop (/goal).
 *
 * Runs directChat in a forced loop until:
 * - The model outputs <!-- GOAL_COMPLETE --> (verified completion)
 * - Turn budget exceeded
 * - User interrupts (ctrl+c)
 */
export async function runGoal(
  instruction: string,
  client: BaseChatModel,
  bus: EventBus,
  onChunk: OnChunk,
  signal?: { interrupted: boolean }
): Promise<GoalResult> {
  let turns = 0;

  while (turns < MAX_GOAL_TURNS) {
    if (signal?.interrupted) return { success: false, turns, terminationReason: "interrupted" };

    const userMessage = turns === 0
      ? instruction
      : CONTINUATION_MESSAGE;

    const input: OrchestrationInput = {
      userMessage,
      client,
      systemPrompt: GOAL_SYSTEM_PROMPT,
      history: [],
      onChunk,
    };

    const result = await directChat(input, bus);
    turns++;

    // Check for explicit completion signal
    if (result.response.text.includes(COMPLETION_TOKEN)) {
      return { success: true, turns, terminationReason: "complete" };
    }
  }

  return { success: false, turns, terminationReason: "budget" };
}
