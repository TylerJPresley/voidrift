import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { EventBus } from "../events/bus.js";
import type { OnChunk } from "../adapters/stream.js";
import { executeNode, getPersona, type GraphState } from "./nodes.js";

const MAX_GOAL_TURNS = 15;
const MAX_GOAL_TOKENS = 500_000;

export interface GoalResult {
  success: boolean;
  turns: number;
  totalTokens: number;
  terminationReason: "pass" | "budget_turns" | "budget_tokens" | "interrupted";
}

/**
 * Autonomous Execution Loop (/goal).
 *
 * Runs the full Architect → Engineer → Auditor cycle without operator intervention.
 * Permission gate is bypassed. Terminates on Auditor Pass or budget exceeded.
 */
export async function runGoal(
  instruction: string,
  client: BaseChatModel,
  bus: EventBus,
  onChunk: OnChunk,
  signal?: { interrupted: boolean }
): Promise<GoalResult> {
  let turns = 0;
  let totalTokens = 0;
  let state: GraphState = {
    activePlan: null,
    focusedFiles: [],
    diagnostics: null,
    routingFlag: null,
    messages: [],
    activeMode: "vibe", // Auto-approve everything
    activePersona: "",
  };

  // Phase 1: Architect compiles the plan
  const archMessages: BaseMessage[] = [
    new SystemMessage(getPersona("architect")),
    new HumanMessage(instruction),
  ];
  const archResult = await executeNode("architect", client, archMessages, state, onChunk);
  state.activePlan = archResult.stateUpdates.activePlan ?? archResult.response.text;
  totalTokens += archResult.response.usage.totalTokens;
  turns++;

  // Phase 2: Engineer → Auditor loop
  while (turns < MAX_GOAL_TURNS && totalTokens < MAX_GOAL_TOKENS) {
    if (signal?.interrupted) return { success: false, turns, totalTokens, terminationReason: "interrupted" };

    // Engineer
    const engMessages: BaseMessage[] = [
      new SystemMessage(getPersona("engineer")),
      new SystemMessage(`Active Plan:\n${state.activePlan}`),
      ...(state.diagnostics ? [new SystemMessage(`Rework Required:\n${state.diagnostics}`)] : []),
      new HumanMessage("Execute the next steps in the plan."),
    ];
    const engResult = await executeNode("engineer", client, engMessages, state, onChunk);
    Object.assign(state, engResult.stateUpdates);
    totalTokens += engResult.response.usage.totalTokens;
    turns++;

    if (signal?.interrupted) return { success: false, turns, totalTokens, terminationReason: "interrupted" };

    // Auditor
    const audMessages: BaseMessage[] = [
      new SystemMessage(getPersona("auditor")),
      new HumanMessage("Verify the engineer's work. Run tests if applicable. Set Pass or Rework."),
    ];
    const audResult = await executeNode("auditor", client, audMessages, state, onChunk);
    Object.assign(state, audResult.stateUpdates);
    totalTokens += audResult.response.usage.totalTokens;
    turns++;

    if (state.routingFlag === "pass") {
      bus.publish("TURN_COMPLETE", { turnId: `goal-turn-${turns}` });
      return { success: true, turns, totalTokens, terminationReason: "pass" };
    }

    // Rework — diagnostics are already in state, loop continues
    state.routingFlag = null;
  }

  bus.publish("TURN_COMPLETE", { turnId: `goal-turn-${turns}` });
  return {
    success: false,
    turns,
    totalTokens,
    terminationReason: turns >= MAX_GOAL_TURNS ? "budget_turns" : "budget_tokens",
  };
}
