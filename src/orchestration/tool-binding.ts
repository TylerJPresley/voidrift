/**
 * Dynamic Tool Binding — context-aware tool category activation.
 *
 * Instead of binding all 27 tools on every turn (which overwhelms smaller models),
 * this module selects relevant tool categories based on user input and session state.
 *
 * Categories:
 * - read: always active (baseline capability)
 * - write: activated on modification intent
 * - plan: activated when plans are in context or referenced
 * - memory: activated on memory-related keywords
 * - orchestration: activated on delegation/scheduling keywords
 *
 * Recovery: if the model tries to call an unbound tool, the category is dynamically
 * added and the turn retries.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// ─── Categories ──────────────────────────────────────────────────────────────

export const TOOL_CATEGORIES: Record<string, string[]> = {
  read: [
    "read_file", "glob_files", "workspace_map", "search_contents",
    "web_search", "web_fetch", "list_skills", "list_memory", "deescalate",
  ],
  write: [
    "write_file", "edit_file", "execute_command",
  ],
  plan: [
    "read_plan", "add_plan", "remove_plan", "prioritize_plan", "update_plan",
  ],
  memory: [
    "save_memory", "delete_memory",
  ],
  orchestration: [
    "spawn_subagent", "run_task_agent", "schedule", "background_exec",
    "check_task", "register_task", "invoke_task", "escalate",
  ],
};

/** Baseline tools — always bound regardless of classification */
/** Always-bound tools — covers read, write, execute, research, plan, and self-management.
 *  The classifier only adds exotic tools (orchestration, MCP, memory, scheduling) on top. */
export const BASELINE_TOOLS = [
  // Read
  "read_file", "glob_files", "workspace_map", "search_contents",
  // Write
  "write_file", "edit_file", "execute_command",
  // Research
  "web_search", "web_fetch",
  // Plan
  "read_plan", "add_plan",
  // Self-management
  "escalate", "deescalate", "search_tools", "load_skill",
];

/**
 * Given a tool name that the model tried to call but wasn't bound,
 * find which category it belongs to.
 */
export function findCategoryForTool(toolName: string): string | null {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName)) return category;
  }
  return null;
}

/**
 * Expand the active tool set by adding a category.
 * Returns the new full list of tool names.
 */
export function expandWithCategory(currentTools: string[], category: string, agentTools: string[]): string[] {
  const expanded = new Set(currentTools);
  const categoryTools = TOOL_CATEGORIES[category] || [];
  for (const tool of categoryTools) {
    if (agentTools.includes(tool)) {
      expanded.add(tool);
    }
  }
  return [...expanded];
}

/**
 * Get all tool names as a lightweight index string (for system prompt injection).
 * One line, just names — so the model knows what exists even if not all are bound.
 */
// ─── Tool TOC Compiler ───────────────────────────────────────────────────────

import { TOOL_SCHEMAS } from "../tools/definitions.js";

/**
 * Compiles a text-only Table of Contents of all available tools.
 * Used by the preflight classifier and search_tools executor.
 */
export function compileToolTOC(agentTools: string[], mcpServers?: Array<{ name: string; tools: Array<{ name: string; description: string }> }>): string {
  const parts: string[] = [];
  for (const name of agentTools) {
    const schema = TOOL_SCHEMAS.find(t => t.name === name);
    if (schema) {
      parts.push(`- ${name}: ${schema.description.slice(0, 80)}`);
    }
  }
  if (mcpServers) {
    for (const server of mcpServers) {
      for (const tool of server.tools) {
        parts.push(`- mcp_${server.name}_${tool.name}: ${(tool.description || tool.name).slice(0, 80)}`);
      }
    }
  }
  return parts.join("\n");
}

// ─── Contextual Query Compiler ───────────────────────────────────────────────

/**
 * Builds the contextual query for the preflight classifier.
 * Combines user input + last assistant text + active plan to give
 * the classifier enough signal even on short confirmations like "yes".
 */
export function buildContextualQuery(userInput: string, lastAssistantText?: string, activePlan?: string | null): string {
  const parts: string[] = [];
  if (activePlan) parts.push(`Active Plan: "${activePlan.slice(0, 200)}"`);
  if (lastAssistantText) parts.push(`Last Assistant: "${lastAssistantText.slice(0, 300)}"`);
  parts.push(`User: "${userInput}"`);
  return parts.join("\n");
}

// ─── LLM-Guided Preflight Tool Selection ─────────────────────────────────────

/**
 * Uses the flash-tier model to select specific tools from the TOC.
 * Contextual query ensures short confirmations ("yes", "do it") still resolve correctly.
 * Fallback: returns write + plan categories on failure (safe — never locks model out).
 */
export async function selectTools(client: BaseChatModel, contextualQuery: string, toolTOC: string): Promise<string[]> {
  const prompt = `Identify the specific tools needed to execute the next step in this conversation.

Context:
${contextualQuery}

Available Tools:
${toolTOC}

Respond ONLY with a valid JSON array containing the matching tool names (e.g. ["write_file", "execute_command"]). If no specific tools are needed beyond reading, output [].`;

  try {
    const response = await client.invoke([
      new SystemMessage(prompt),
    ], { max_tokens: 50, temperature: 0 } as any);

    const text = typeof response.content === "string" ? response.content : "";
    const match = text.match(/\[.*\]/);
    if (!match) return failSafeTools();
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return failSafeTools();
    // Sanitize: only keep non-empty strings (model may return null, numbers, etc.)
    const clean = parsed.filter((t): t is string => typeof t === "string" && t.trim() !== "");
    if (clean.length === 0) return [];
    return clean;
  } catch {
    return failSafeTools();
  }
}

/** Fail-safe: bind write + plan so the model is never locked out of basic operations */
function failSafeTools(): string[] {
  return [...TOOL_CATEGORIES.write, ...TOOL_CATEGORIES.plan];
}

// ─── Unified Preflight Classifier (Skills + Memories) ────────────────────────

export interface PreflightResult {
  tools: string[];
  skills: string[];
  memories: string[];
}

/**
 * Unified semantic classifier: resolves tools, skills, AND memories in one call.
 * Replaces keyword matching across the entire framework.
 * Cost: ~200-300 token prompt, ~30 token response. Flash tier.
 */
export async function classifyTurnContext(
  client: BaseChatModel,
  userInput: string,
  availableSkills: string[],
  availableMemories: string[],
): Promise<PreflightResult> {
  const prompt = `Classify this user request. Return a JSON object with the relevant items from each category.

Tool categories (select which are needed):
- "write": modify, create, edit, fix, delete files or run commands
- "plan": create/manage plans, checklists, todos
- "memory": remember, store, recall, forget facts
- "orchestration": delegate, background tasks, schedule, subagents

Available skills (select 0-3 most relevant):
${availableSkills.join("\n")}

Available memories (select 0-3 most relevant):
${availableMemories.join("\n")}

Respond ONLY with valid JSON: {"tools": [...], "skills": [...], "memories": [...]}
Empty arrays for categories not needed.`;

  try {
    const response = await client.invoke([
      new SystemMessage(prompt),
      new HumanMessage(userInput),
    ], { max_tokens: 80, temperature: 0 } as any);

    const text = typeof response.content === "string" ? response.content : "";
    const match = text.match(/\{.*\}/s);
    if (!match) return { tools: ["write", "plan", "memory", "orchestration"], skills: [], memories: [] };
    const parsed = JSON.parse(match[0]);
    return {
      tools: Array.isArray(parsed.tools) ? parsed.tools : ["write", "plan", "memory", "orchestration"],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    };
  } catch {
    return { tools: ["write", "plan", "memory", "orchestration"], skills: [], memories: [] };
  }
}

/**
 * Fast-path: skip classification for trivial conversational messages.
 */
export function isSimpleConversational(input: string): boolean {
  const words = input.trim().split(/\s+/);
  if (words.length > 5) return false;
  const conversationalWords = new Set(["hi", "hello", "thanks", "thank", "hey", "help", "who", "status", "ok", "yes", "no", "sure", "bye"]);
  return words.every(w => conversationalWords.has(w.toLowerCase().replace(/[^\w]/g, "")));
}

/**
 * Trivial greetings/status checks that should always bypass preflight analysis.
 */
export function isTrivialGreetingOrStatus(input: string): boolean {
  const words = input.trim().split(/\s+/);
  if (words.length > 3) return false;
  const trivialWords = new Set(["hi", "hello", "hey", "thanks", "thank", "bye", "status", "clear", "help"]);
  return words.every(w => trivialWords.has(w.toLowerCase().replace(/[^\w]/g, "")));
}

/**
 * Map category names to tool names, respecting the agent's allowed tools.
 */
export function getToolsForCategories(categories: string[], agentTools: string[]): string[] {
  const tools = new Set<string>();
  for (const cat of categories) {
    const categoryTools = TOOL_CATEGORIES[cat];
    if (!categoryTools) continue;
    for (const tool of categoryTools) {
      if (agentTools.includes(tool)) tools.add(tool);
    }
  }
  return [...tools];
}

// ─── On-Demand Tool Discovery Index ──────────────────────────────────────────

/**
 * Compiles a lightweight TOC of tools NOT in the baseline that agents can activate via search_tools.
 * Injected into the system prompt so the model knows what's available without binding all schemas.
 */
export function compileOnDemandTOC(agentTools: string[], mcpServers?: Array<{ name: string; tools: Array<{ name: string; description: string }> }>): string {
  const onDemand: string[] = [];
  for (const name of agentTools) {
    if (BASELINE_TOOLS.includes(name)) continue;
    const schema = TOOL_SCHEMAS.find(t => t.name === name);
    if (schema) {
      onDemand.push(`- ${name}: ${schema.description.slice(0, 80)}`);
    }
  }
  if (mcpServers) {
    for (const server of mcpServers) {
      for (const tool of server.tools) {
        onDemand.push(`- mcp_${server.name}_${tool.name}: ${(tool.description || tool.name).slice(0, 80)}`);
      }
    }
  }
  if (onDemand.length === 0) return "";
  return `## Additional Tools (activate with search_tools)\n${onDemand.join("\n")}`;
}
