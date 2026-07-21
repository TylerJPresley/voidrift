/**
 * VoidRift Operator DTOs — serializable data transfer objects.
 *
 * All types here are plain JSON-safe objects. No class instances, no functions.
 * Zod schemas provide runtime validation for inputs from external frontends.
 */
import { z } from "zod";

// ─── Session ───────────────────────────────────────────────────────────────

export const SendInputParamsSchema = z.object({
  text: z.string().min(1),
});
export type SendInputParams = z.infer<typeof SendInputParamsSchema>;
export interface SendInputResult { turnId: string }

export const ConfirmToolParamsSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  persist: z.boolean().optional(),
  chosenPattern: z.string().optional(),
});
export type ConfirmToolParams = z.infer<typeof ConfirmToolParamsSchema>;

// ─── Model ─────────────────────────────────────────────────────────────────

export interface ModelInfo {
  name: string;
  protocol: string;
  model: string;
  contextLimit: number;
  tiers: string[]; // which tiers this model is assigned to
}

export interface ModelListResult {
  models: ModelInfo[];
  modelSelected: string;
}

export const ModelSwitchParamsSchema = z.object({
  name: z.string().min(1),
  tier: z.enum(["selected", "utility", "escalation"]).optional(),
});
export type ModelSwitchParams = z.infer<typeof ModelSwitchParamsSchema>;

export interface StatsResult {
  sessionId: string;
  turns: number;
  duration: string;
  tools: { total: number; success: number; failed: number; totalTimeMs: number; perTool: Record<string, number> };
  models: Array<{ name: string; turns: number; inputTokens: number; outputTokens: number; totalTimeMs: number }>;
}

export interface ContextStatsResult {
  percentage: number;
  used: number;
  limit: number;
  layers: {
    agent: number;
    orbit: number;
    drift: number;
    void: number;
  };
}

export interface ContextDetailResult {
  limit: number;
  agent: {
    persona: string;
    personaTokens: number;
    tools: string[];
    toolsTokens: number;
    boundSkills: number;
    boundSkillsTokens: number;
    skillIndex: number;
    skillIndexTokens: number;
    memoryIndex: number;
    memoryIndexTokens: number;
  };
  orbit: {
    activeSkills: number;
    activeSkillsTokens: number;
    activeMemory: number;
    memoryTokens: number;
    plan: string | null;
    planTokens: number;
  };
  drift: {
    focusedFiles: Array<{ path: string; totalLines: number; readRanges: Array<[number, number]> }>;
    filesTokens: number;
    codeMapTokens: number;
    gitStatus: string | null;
    gitTokens: number;
  };
  void: {
    messageCount: number;
    messagesTokens: number;
    toolResultTokens: number;
    diagnostics: string | null;
    diagnosticsTokens: number;
  };
}

// ─── Agents ────────────────────────────────────────────────────────────────

export interface AgentDTO {
  id: string;
  name: string;
  description: string;
  type: "interactive" | "passive";
  role: string;
  tools: string[];
  approvalMode: "prompt" | "deny" | "autonomous";
  active: boolean;
  source?: string;
  prompt?: string;
  overridePath?: string;
  overrideStatus?: "default" | "global" | "workspace";
  configOverride?: "default" | "global" | "workspace";
  promptOverride?: "default" | "global" | "workspace";
  skills?: string[];
  resources?: string[];
  welcomeMessage?: string;
}

export type AgentListResult = { agents: AgentDTO[] };
export type AgentGetResult = { agent: AgentDTO };
export type AgentIdParams = { id: string };
export type AgentGetParams = { id: string };

export const CreateAgentInputSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  type: z.enum(["interactive", "passive"]),
  role: z.string().default("auto"),
  prompt: z.string(),
  tools: z.array(z.string()),
  approvalMode: z.enum(["prompt", "deny", "autonomous"]).default("prompt"),
  allowedTools: z.array(z.string()).default([]),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export const UpdateAgentInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  role: z.string().optional(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  approvalMode: z.enum(["prompt", "deny", "autonomous"]).optional(),
  allowedTools: z.array(z.string()).optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

// ─── Plan ──────────────────────────────────────────────────────────────────

export interface PlanItemDTO {
  filename: string;
  description: string;
  rationale: string;
  priority: "now" | "next" | "later" | "complete";
  body: string;
}

export type PlanListResult = { items: PlanItemDTO[] };
export type PlanGetResult = { item: PlanItemDTO };
export type PlanGetParams = { filename: string };
export type PlanRemoveParams = { filename: string };

export const AddPlanItemInputSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  rationale: z.string().default(""),
  priority: z.enum(["now", "next", "later"]).default("now"),
  body: z.string().default(""),
});
export type AddPlanItemInput = z.infer<typeof AddPlanItemInputSchema>;

export const UpdatePlanPriorityInputSchema = z.object({
  filename: z.string().min(1),
  priority: z.enum(["now", "next", "later"]),
});
export type UpdatePlanPriorityInput = z.infer<typeof UpdatePlanPriorityInputSchema>;

export const UpdatePlanBodyInputSchema = z.object({
  filename: z.string().min(1),
  search: z.string().min(1),
  replace: z.string(),
});
export type UpdatePlanBodyInput = z.infer<typeof UpdatePlanBodyInputSchema>;

// ─── Skills ────────────────────────────────────────────────────────────────

export interface SkillDTO {
  name: string;
  description: string;
  filePath: string;
  location: "workspace" | "global";
  active: boolean;
  triggers: {
    extensions: string[];
    files: string[];
    keywords: string[];
  };
  agents: string[];
  overrideLevel?: string;
}

export type SkillListResult = { skills: SkillDTO[] };

export const SkillToggleParamsSchema = z.object({
  name: z.string().min(1),
  active: z.boolean(),
});
export type SkillToggleParams = z.infer<typeof SkillToggleParamsSchema>;

// ─── Templates ─────────────────────────────────────────────────────────────

export interface TemplateDTO {
  key: string;
  label: string;
  description: string;
  source: string;
  activeLevel: "default" | "global" | "workspace";
}

export type TemplateListResult = { templates: TemplateDTO[] };
export type TemplateGetParams = { key: string };
export type TemplateGetResult = { key: string; content: string; source: string };

export const UpsertOverrideInputSchema = z.object({
  key: z.string().min(1),
  content: z.string(),
  scope: z.enum(["workspace", "global"]),
});
export type UpsertOverrideInput = z.infer<typeof UpsertOverrideInputSchema>;

export const DeleteOverrideInputSchema = z.object({
  key: z.string().min(1),
  scope: z.enum(["workspace", "global"]),
});
export type DeleteOverrideInput = z.infer<typeof DeleteOverrideInputSchema>;

// ─── Prompts ───────────────────────────────────────────────────────────────

export interface PromptDTO {
  key: string;
  label: string;
  description: string;
  source: string;
  activeLevel: "default" | "global" | "workspace";
}

export type PromptListResult = { prompts: PromptDTO[] };
export type PromptGetParams = { key: string };
export type PromptGetResult = { key: string; content: string; source: string };

// ─── MCP ───────────────────────────────────────────────────────────────────

export interface MCPServerDTO {
  name: string;
  status: "connected" | "disconnected" | "error";
  transport: "stdio" | "http-sse";
  url?: string;
  toolCount: number;
  autoConnect: boolean;
}

export type MCPServerListResult = { servers: MCPServerDTO[] };

export const MCPConnectParamsSchema = z.object({
  name: z.string().min(1),
});
export type MCPConnectParams = z.infer<typeof MCPConnectParamsSchema>;

export const MCPDisconnectParamsSchema = z.object({
  name: z.string().min(1),
});
export type MCPDisconnectParams = z.infer<typeof MCPDisconnectParamsSchema>;

// ─── Memory ────────────────────────────────────────────────────────────────

export interface MemoryDTO {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  scope: "local" | "global";
  filePath?: string;
  loaded: boolean;
}

export type MemoryListResult = { memories: MemoryDTO[] };
export type MemoryIdParams = { id: string };
