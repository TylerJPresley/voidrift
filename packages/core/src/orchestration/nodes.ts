import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { streamModel, type OnChunk } from "../adapters/stream.js";
import type { ModelResponse } from "../adapters/types.js";
import { bindTools } from "../tools/binding.js";
import type { Mode, NodeType } from "../router/index.js";

export type RoutingFlag = "pass" | "rework" | null;

export interface GraphState {
  activePlan: string | null;
  focusedFiles: string[];
  diagnostics: string | null;
  routingFlag: RoutingFlag;
  messages: BaseMessage[];
  activeMode: Mode;
  activePersona: string;
}

export interface NodeResult {
  stateUpdates: Partial<GraphState>;
  response: ModelResponse;
  nextNode: NodeType | "end";
}

const ARCHITECT_PERSONA = `You are the Architect. Your role is to evaluate the user's intent and produce a clear, step-by-step implementation plan. You CANNOT write files or execute commands. Output your plan in markdown.`;

const ENGINEER_PERSONA = `You are the Engineer. Execute the active plan step by step. Use write_file, edit_file, and execute_command to implement changes. Do NOT modify the plan itself.`;

const AUDITOR_PERSONA = `You are the Auditor. Verify the Engineer's work by reading modified files and running tests/linters. Set your routing decision: "pass" if everything works, "rework" if there are issues. Include diagnostics.`;

export function getPersona(node: NodeType): string {
  switch (node) {
    case "architect": return ARCHITECT_PERSONA;
    case "engineer": return ENGINEER_PERSONA;
    case "auditor": return AUDITOR_PERSONA;
    default: return "You are a helpful AI assistant.";
  }
}

export function getToolSchemas(node: NodeType, mode: Mode) {
  return bindTools(node, mode);
}

/**
 * Executes a node persona: streams the model with the appropriate persona and tools,
 * then determines the next node based on the result.
 */
export async function executeNode(
  node: NodeType,
  client: BaseChatModel,
  messages: BaseMessage[],
  state: GraphState,
  onChunk: OnChunk
): Promise<NodeResult> {
  const response = await streamModel(client, messages, onChunk);

  switch (node) {
    case "architect":
      return {
        stateUpdates: { activePlan: response.text, activePersona: ARCHITECT_PERSONA },
        response,
        nextNode: state.activeMode === "plan" ? "end" : "engineer",
      };

    case "engineer":
      return {
        stateUpdates: { focusedFiles: extractFilePaths(response.text) },
        response,
        nextNode: "auditor",
      };

    case "auditor": {
      const flag = extractRoutingFlag(response.text);
      return {
        stateUpdates: { diagnostics: response.text, routingFlag: flag },
        response,
        nextNode: flag === "rework" ? "engineer" : "end",
      };
    }

    default:
      return { stateUpdates: {}, response, nextNode: "end" };
  }
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  const matches = text.matchAll(/(?:write_file|edit_file|read_file).*?["']([^"']+)["']/g);
  for (const m of matches) paths.push(m[1]);
  return [...new Set(paths)];
}

function extractRoutingFlag(text: string): RoutingFlag {
  const lower = text.toLowerCase();
  if (lower.includes("rework") || lower.includes("fail") || lower.includes("error")) return "rework";
  if (lower.includes("pass") || lower.includes("success") || lower.includes("verified")) return "pass";
  return "pass"; // Default to pass if unclear
}
