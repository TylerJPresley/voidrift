/**
 * VoidRift Operator Protocol — shared contract between core host and frontends.
 *
 * This file defines:
 * - Request method names (frontend → host)
 * - Notification event names (host → frontend)
 * - Param/result type mappings for each method
 *
 * Both the headless host and any frontend (TUI, VS Code) import this file
 * as their shared language. JSON-RPC 2.0 is the wire format.
 */

// ─── Protocol Version ──────────────────────────────────────────────────────

export const PROTOCOL_VERSION = "0.1.0";

// ─── Request Methods (frontend → host) ─────────────────────────────────────

export const Methods = {
  // Session
  SESSION_SEND_INPUT: "session.sendInput",
  SESSION_CANCEL: "session.cancel",
  SESSION_CLEAR: "session.clear",
  SESSION_COMPACT: "session.compact",
  SESSION_CONFIRM_TOOL: "session.confirmTool",
  SESSION_EXECUTE_COMMAND: "session.executeCommand",
  SESSION_LIST_COMMANDS: "session.listCommands",

  // Model
  MODEL_LIST: "model.list",
  MODEL_SWITCH: "model.switch",
  MODEL_GET_STATS: "model.getStats",
  MODEL_GET_CONTEXT: "model.getContext",

  // Agents
  AGENT_LIST: "agent.list",
  AGENT_GET: "agent.get",
  AGENT_CREATE: "agent.create",
  AGENT_UPDATE: "agent.update",
  AGENT_DELETE: "agent.delete",
  AGENT_ACTIVATE: "agent.activate",
  AGENT_CYCLE: "agent.cycle",

  // Plan
  PLAN_LIST: "plan.list",
  PLAN_GET: "plan.get",
  PLAN_ADD: "plan.add",
  PLAN_UPDATE_PRIORITY: "plan.updatePriority",
  PLAN_UPDATE_BODY: "plan.updateBody",
  PLAN_REMOVE: "plan.remove",

  // Skills
  SKILL_LIST: "skill.list",
  SKILL_TOGGLE: "skill.toggle",
  SKILL_REINDEX: "skill.reindex",

  // Templates
  TEMPLATE_LIST: "template.list",
  TEMPLATE_GET: "template.get",
  TEMPLATE_UPSERT_OVERRIDE: "template.upsertOverride",
  TEMPLATE_DELETE_OVERRIDE: "template.deleteOverride",

  // Prompts
  PROMPT_LIST: "prompt.list",
  PROMPT_GET: "prompt.get",
  PROMPT_UPSERT_OVERRIDE: "prompt.upsertOverride",
  PROMPT_DELETE_OVERRIDE: "prompt.deleteOverride",

  // MCP
  MCP_LIST_SERVERS: "mcp.listServers",
  MCP_CONNECT: "mcp.connect",
  MCP_DISCONNECT: "mcp.disconnect",

  // Memory
  MEMORY_LIST: "memory.list",
  MEMORY_LOAD: "memory.load",
  MEMORY_UNLOAD: "memory.unload",
} as const;

export type MethodName = (typeof Methods)[keyof typeof Methods];

// ─── Notifications (host → frontend) ───────────────────────────────────────

export const Notifications = {
  // Streaming
  TOKEN_STREAM: "stream.token",
  STREAM_END: "stream.end",

  // Tool execution
  TOOL_CALL_START: "tool.callStart",
  TOOL_CALL_END: "tool.callEnd",
  TOOL_CONFIRMATION_REQUEST: "tool.confirmationRequest",

  // Session lifecycle
  TURN_COMPLETE: "session.turnComplete",
  MODE_CHANGED: "session.modeChanged",
  ERROR: "session.error",

  // Output
  OUTPUT: "output.message",
  PANEL_OPEN: "output.panelOpen",

  // Workspace
  WORKSPACE_CHANGED: "workspace.changed",
  CONTEXT_UPDATED: "workspace.contextUpdated",

  // Subagents
  SUBAGENT_SPAWNED: "subagent.spawned",
  SUBAGENT_COMPLETED: "subagent.completed",
} as const;

export type NotificationName = (typeof Notifications)[keyof typeof Notifications];

// ─── Param/Result Type Map ─────────────────────────────────────────────────

import type {
  SendInputParams, SendInputResult,
  ConfirmToolParams,
  ModelListResult, ModelSwitchParams,
  StatsResult, ContextStatsResult,
  AgentListResult, AgentGetParams, AgentGetResult,
  CreateAgentInput, UpdateAgentInput,
  AgentIdParams,
  PlanListResult, PlanGetParams, PlanGetResult,
  AddPlanItemInput, UpdatePlanPriorityInput, UpdatePlanBodyInput,
  PlanRemoveParams,
  SkillListResult, SkillToggleParams,
  TemplateListResult, TemplateGetParams, TemplateGetResult,
  UpsertOverrideInput, DeleteOverrideInput,
  PromptListResult, PromptGetParams, PromptGetResult,
  MCPServerListResult, MCPConnectParams, MCPDisconnectParams,
  MemoryListResult, MemoryIdParams,
} from "./dto.js";

export interface RequestMap {
  [Methods.SESSION_SEND_INPUT]: { params: SendInputParams; result: SendInputResult };
  [Methods.SESSION_CANCEL]: { params: void; result: void };
  [Methods.SESSION_CLEAR]: { params: void; result: void };
  [Methods.SESSION_COMPACT]: { params: void; result: { before: number; after: number } };
  [Methods.SESSION_CONFIRM_TOOL]: { params: ConfirmToolParams; result: void };

  [Methods.MODEL_LIST]: { params: void; result: ModelListResult };
  [Methods.MODEL_SWITCH]: { params: ModelSwitchParams; result: void };
  [Methods.MODEL_GET_STATS]: { params: void; result: StatsResult };
  [Methods.MODEL_GET_CONTEXT]: { params: void; result: ContextStatsResult };

  [Methods.AGENT_LIST]: { params: void; result: AgentListResult };
  [Methods.AGENT_GET]: { params: AgentGetParams; result: AgentGetResult };
  [Methods.AGENT_CREATE]: { params: CreateAgentInput; result: AgentGetResult };
  [Methods.AGENT_UPDATE]: { params: UpdateAgentInput; result: AgentGetResult };
  [Methods.AGENT_DELETE]: { params: AgentIdParams; result: void };
  [Methods.AGENT_ACTIVATE]: { params: AgentIdParams; result: void };
  [Methods.AGENT_CYCLE]: { params: void; result: AgentGetResult };

  [Methods.PLAN_LIST]: { params: void; result: PlanListResult };
  [Methods.PLAN_GET]: { params: PlanGetParams; result: PlanGetResult };
  [Methods.PLAN_ADD]: { params: AddPlanItemInput; result: PlanGetResult };
  [Methods.PLAN_UPDATE_PRIORITY]: { params: UpdatePlanPriorityInput; result: void };
  [Methods.PLAN_UPDATE_BODY]: { params: UpdatePlanBodyInput; result: void };
  [Methods.PLAN_REMOVE]: { params: PlanRemoveParams; result: void };

  [Methods.SKILL_LIST]: { params: void; result: SkillListResult };
  [Methods.SKILL_TOGGLE]: { params: SkillToggleParams; result: void };
  [Methods.SKILL_REINDEX]: { params: void; result: SkillListResult };

  [Methods.TEMPLATE_LIST]: { params: void; result: TemplateListResult };
  [Methods.TEMPLATE_GET]: { params: TemplateGetParams; result: TemplateGetResult };
  [Methods.TEMPLATE_UPSERT_OVERRIDE]: { params: UpsertOverrideInput; result: void };
  [Methods.TEMPLATE_DELETE_OVERRIDE]: { params: DeleteOverrideInput; result: void };

  [Methods.PROMPT_LIST]: { params: void; result: PromptListResult };
  [Methods.PROMPT_GET]: { params: PromptGetParams; result: PromptGetResult };
  [Methods.PROMPT_UPSERT_OVERRIDE]: { params: UpsertOverrideInput; result: void };
  [Methods.PROMPT_DELETE_OVERRIDE]: { params: DeleteOverrideInput; result: void };

  [Methods.MCP_LIST_SERVERS]: { params: void; result: MCPServerListResult };
  [Methods.MCP_CONNECT]: { params: MCPConnectParams; result: void };
  [Methods.MCP_DISCONNECT]: { params: MCPDisconnectParams; result: void };

  [Methods.MEMORY_LIST]: { params: void; result: MemoryListResult };
  [Methods.MEMORY_LOAD]: { params: MemoryIdParams; result: void };
  [Methods.MEMORY_UNLOAD]: { params: MemoryIdParams; result: void };
}

// ─── Notification Payloads ─────────────────────────────────────────────────

export interface NotificationPayloadMap {
  [Notifications.TOKEN_STREAM]: { token: string; done: boolean };
  [Notifications.STREAM_END]: { model: string; inputTokens: number; outputTokens: number; elapsed: number };
  [Notifications.TOOL_CALL_START]: { id: string; name: string; args: string };
  [Notifications.TOOL_CALL_END]: { id: string; name: string; status: "success" | "error"; output: string; elapsed: number };
  [Notifications.TOOL_CONFIRMATION_REQUEST]: { requestId: string; tool: string; args: Record<string, unknown>; diff?: string[]; patterns?: string[] };
  [Notifications.TURN_COMPLETE]: { turnId: string };
  [Notifications.MODE_CHANGED]: { previous: string; current: string };
  [Notifications.ERROR]: { message: string; source?: string };
  [Notifications.OUTPUT]: { text: string };
  [Notifications.PANEL_OPEN]: { name: string };
  [Notifications.WORKSPACE_CHANGED]: { paths: string[]; type: "create" | "update" | "delete" };
  [Notifications.CONTEXT_UPDATED]: { percentage: number; used: number; limit: number };
  [Notifications.SUBAGENT_SPAWNED]: { id: string; worktreePath: string };
  [Notifications.SUBAGENT_COMPLETED]: { id: string; status: "success" | "failed" };
}
