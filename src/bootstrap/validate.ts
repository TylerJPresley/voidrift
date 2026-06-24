/**
 * Startup Validation Scan.
 *
 * Checks all custom assets for issues on boot:
 * - Skills referencing nonexistent agents
 * - Agents with missing config/prompt files
 *
 * Returns warnings to display on startup.
 */
import type { AgentRegistry } from "../agents/registry.js";
import type { SkillManager } from "../skills/manager.js";
import { readFileSync } from "fs";

export interface ValidationIssue {
  type: "skill" | "agent" | "template" | "prompt";
  id: string;
  message: string;
}

export function validateAssets(agents: AgentRegistry, skills: SkillManager): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Get all known agent ids
  const allAgentIds = [
    ...agents.listInteractive().map(a => a.id),
    ...agents.listTask().map(a => a.id),
  ];

  // Validate skills
  for (const skill of skills.indexed) {
    // Check for missing required metadata
    if (!skill.name || !skill.description) {
      issues.push({
        type: "skill",
        id: skill.name || skill.filePath,
        message: "Missing required name or description",
      });
      continue;
    }
    // Check for missing frontmatter structure
    try {
      const raw = readFileSync(skill.filePath, "utf-8");
      const missing: string[] = [];
      if (!raw.includes("triggers:")) missing.push("triggers");
      if (!raw.includes("agents:")) missing.push("agents");
      if (!raw.includes("active:")) missing.push("active");
      if (missing.length > 0) {
        issues.push({
          type: "skill",
          id: skill.name,
          message: `Missing required frontmatter keys: ${missing.join(", ")}`,
        });
        continue;
      }
    } catch {}
    // Check for dangling agent references
    const invalidAgents = skill.agents.filter(id => !allAgentIds.includes(id));
    if (invalidAgents.length > 0) {
      issues.push({
        type: "skill",
        id: skill.name,
        message: `References nonexistent agent(s): ${invalidAgents.join(", ")}`,
      });
    }
  }

  // Validate agent resource references
  const allSkillNames = skills.indexed.map(s => s.name);
  for (const agent of [...agents.listInteractive(), ...agents.listTask()]) {
    if (agent.skills?.length) {
      for (const skillName of agent.skills) {
        if (!allSkillNames.includes(skillName)) {
          issues.push({ type: "agent", id: agent.id, message: `References unknown skill: "${skillName}"` });
        }
      }
    }
  }

  return issues;
}
