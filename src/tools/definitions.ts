/**
 * Tool Schema Definitions — derived from Zod schemas in langchain-tools.ts.
 * Zod is the single source of truth. This module provides the metadata view
 * (name, description, parameters, actionLayer, safetyProfile) for panels and display.
 */
import type { ToolSchema, ActionLayer, SafetyProfile, ToolParameter } from "./types.js";
import { langchainTools } from "./langchain-tools.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// Metadata that can't be inferred from Zod (display/security concerns)
const toolMeta: Record<string, { actionLayer: ActionLayer; safetyProfile: SafetyProfile }> = {
  read_file: { actionLayer: "file-ops", safetyProfile: "auto-approved" },
  glob_files: { actionLayer: "file-ops", safetyProfile: "auto-approved" },
  workspace_map: { actionLayer: "file-ops", safetyProfile: "auto-approved" },
  search_contents: { actionLayer: "file-ops", safetyProfile: "auto-approved" },
  write_file: { actionLayer: "file-ops", safetyProfile: "gated" },
  edit_file: { actionLayer: "file-ops", safetyProfile: "gated" },
  execute_command: { actionLayer: "system-exec", safetyProfile: "gated" },
  web_search: { actionLayer: "web", safetyProfile: "auto-approved" },
  web_fetch: { actionLayer: "web", safetyProfile: "auto-approved" },
  spawn_subagent: { actionLayer: "orchestration", safetyProfile: "gated" },
  run_task_agent: { actionLayer: "orchestration", safetyProfile: "gated" },
  read_plan: { actionLayer: "partition", safetyProfile: "auto-approved" },
  add_plan: { actionLayer: "partition", safetyProfile: "auto-approved" },
  remove_plan: { actionLayer: "partition", safetyProfile: "auto-approved" },
  prioritize_plan: { actionLayer: "partition", safetyProfile: "auto-approved" },
  update_plan: { actionLayer: "partition", safetyProfile: "auto-approved" },
  save_memory: { actionLayer: "partition", safetyProfile: "auto-approved" },
  delete_memory: { actionLayer: "partition", safetyProfile: "auto-approved" },
  list_memory: { actionLayer: "partition", safetyProfile: "auto-approved" },
  list_skills: { actionLayer: "partition", safetyProfile: "auto-approved" },
  schedule: { actionLayer: "orchestration", safetyProfile: "auto-approved" },
  background_exec: { actionLayer: "orchestration", safetyProfile: "auto-approved" },
  check_task: { actionLayer: "orchestration", safetyProfile: "auto-approved" },
  escalate: { actionLayer: "orchestration", safetyProfile: "gated" },
  deescalate: { actionLayer: "orchestration", safetyProfile: "auto-approved" },
};

function extractParameters(schema: any): ToolParameter[] {
  const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" }) as any;
  const props = jsonSchema.properties ?? {};
  const required = new Set(jsonSchema.required ?? []);

  return Object.entries(props).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type ?? "string",
    description: prop.description ?? "",
    required: required.has(name),
  }));
}

export const TOOL_SCHEMAS: ToolSchema[] = langchainTools.map((t) => {
  const meta = toolMeta[t.name] ?? { actionLayer: "external" as ActionLayer, safetyProfile: "gated" as SafetyProfile };
  return {
    name: t.name,
    description: t.description,
    actionLayer: meta.actionLayer,
    safetyProfile: meta.safetyProfile,
    parameters: extractParameters(t.schema),
  };
});

export function getToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((t) => t.name === name);
}
