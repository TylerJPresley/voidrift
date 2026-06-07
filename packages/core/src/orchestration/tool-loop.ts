/**
 * Tool Execution Loop as RunnableSequence.
 *
 * Replaces the manual for-loop in graph.ts with a LangChain Runnable pipeline:
 * model.stream → check tool calls → execute tools → feed ToolMessages → repeat
 *
 * Benefits:
 * - Traceable in LangSmith (each step is a named Runnable)
 * - Composable (can add steps without modifying the loop)
 * - Retryable per-step
 */
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mergeMessageRuns } from "@langchain/core/messages";
import type { StreamChunk, ToolCallChunk, ModelResponse } from "../adapters/types.js";
import { streamModel, type OnChunk } from "../adapters/stream.js";
import type { ContextManager } from "../session/context.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { EventBus } from "../events/bus.js";
import type { AgentManifest } from "../agents/registry.js";
import { PermissionGate } from "../security/permission-gate.js";

export interface ToolLoopInput {
  messages: BaseMessage[];
  client: BaseChatModel;
  onChunk: OnChunk;
  signal?: AbortSignal;
  context?: ContextManager;
  config?: VoidRiftConfig;
  agent?: AgentManifest;
  bus?: EventBus;
  workspaceRoot: string;
  executeToolCall: (name: string, argsJson: string, wsRoot: string, ctx?: ContextManager, cfg?: VoidRiftConfig) => Promise<string>;
}

export interface ToolLoopOutput {
  response: ModelResponse;
  messages: BaseMessage[];
}

const MAX_TOOL_ROUNDS = 10;

/**
 * Creates the tool execution loop as a RunnableSequence.
 * Each iteration: stream model → execute tool calls → append results → repeat.
 */
export function createToolLoop() {
  return RunnableLambda.from(async (input: ToolLoopInput): Promise<ToolLoopOutput> => {
    const { client, onChunk, signal, context, config, agent, bus, workspaceRoot, executeToolCall } = input;
    const gate = bus ? new PermissionGate(bus, workspaceRoot) : null;

    // Merge consecutive same-role messages to reduce token waste
    let currentMessages = mergeMessageRuns(input.messages) as BaseMessage[];
    let finalResponse: ModelResponse | null = null;
    const executedCalls = new Set<string>();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) break;
      if (round > 0) onChunk({ type: "status", message: "Thinking..." });

      const response = await streamModel(client, currentMessages, onChunk, signal);
      finalResponse = response;

      if (signal?.aborted) break;
      if (response.toolCalls.length === 0) break;

      // Deduplicate
      const callKey = response.toolCalls.map(tc => `${tc.name}:${tc.args}`).join("|");
      if (executedCalls.has(callKey)) break;
      executedCalls.add(callKey);

      // Add AI message with tool calls
      currentMessages.push(new AIMessage({
        content: response.text || "",
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          args: JSON.parse(tc.args || "{}"),
        })),
      }));

      // Execute each tool call
      for (const tc of response.toolCalls) {
        const args = JSON.parse(tc.args || "{}");
        onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "executing" } as any);

        // Permission gate
        if (agent && gate) {
          const check = await gate.check(tc.name, args, agent);
          if (!check.approved) {
            const errMsg = check.reason || "Error: Operation rejected by permission gate.";
            bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "error", output: errMsg });
            onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" } as any);
            currentMessages.push(new ToolMessage({ content: errMsg, tool_call_id: tc.id }));
            continue;
          }
        }

        bus?.publish("BEFORE_TOOL_EXECUTE", { toolName: tc.name, arguments: args });
        const result = await executeToolCall(tc.name, tc.args, workspaceRoot, context, config);
        bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "success", output: result.slice(0, 200) });
        onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "success" } as any);
        currentMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
      }
    }

    return {
      response: finalResponse || { text: "", toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      messages: currentMessages,
    };
  }).withConfig({ runName: "tool_execution_loop" });
}
