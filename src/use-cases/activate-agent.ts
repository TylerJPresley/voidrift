/**
 * Activate Agent Use Case.
 *
 * Switches the active agent and configures the session context accordingly:
 * 1. Set active agent on the registry
 * 2. Build persona (agent prompt + base chat prompt)
 * 3. Set allowed tools
 * 4. Load agent-bound skills
 * 5. Load agent resources into drift layer
 *
 * Pure orchestration — no direct filesystem access.
 */
import { ALL_TOOLS } from "../agents/registry.js";
import type { AgentManifest } from "../agents/registry.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { ContextManager } from "../session/context.js";
import type { SkillManager } from "../skills/manager.js";
import type { VoidRiftConfig } from "../config/loader.js";

export interface ResourceLoader {
  exists(path: string): boolean;
  read(path: string): string;
  resolve(workspaceRoot: string, relativePath: string): string;
}

export interface ActivateAgentDeps {
  agents: AgentRegistry;
  prompts: PromptRegistry;
  context: ContextManager;
  skills: SkillManager;
  config: VoidRiftConfig;
  workspaceRoot: string;
  resourceLoader?: ResourceLoader;
}

export function activateAgent(id: string, deps: ActivateAgentDeps): AgentManifest {
  const { agents, prompts, context, skills, config, workspaceRoot, resourceLoader } = deps;

  // 1. Switch active agent
  const agent = agents.setActive(id);

  // 2. Build composite persona
  const basePrompt = prompts.resolve("chat")?.body || "";
  const persona = agent.prompt ? `${agent.prompt}\n\n${basePrompt}` : basePrompt;
  context.setPersona(persona);

  // 3. Set tool allowlist and blocked tools
  context.setTools(agent.tools);
  const blockedTools = ALL_TOOLS.filter(t => !agent.tools.includes(t));
  context.setBlockedTools(blockedTools);

  // 4. Load agent-bound skills
  const boundSkills: string[] = [];
  if (agent.skills?.length) {
    for (const skillName of agent.skills) {
      const skill = skills.indexedSkills.find(s => s.name === skillName);
      if (skill) boundSkills.push(skill.content);
    }
  }
  context.setBoundSkills(boundSkills);

  // 5. Load agent resources into drift layer
  if (agent.resources && resourceLoader) {
    for (const uri of agent.resources) {
      if (uri.startsWith("file://")) {
        const rawPath = uri.slice(7);
        const isAbsolute = rawPath.startsWith("/");
        const relPath = isAbsolute ? rawPath : rawPath.replace(/^\.\//, "");
        const absPath = isAbsolute ? rawPath : resourceLoader.resolve(workspaceRoot, relPath);
        if (resourceLoader.exists(absPath)) {
          const content = resourceLoader.read(absPath);
          const lines = content.split("\n").length;
          const threshold = config.contextSummarizeThreshold ?? 500;
          if (lines <= threshold) {
            context.focusFile(relPath, content, lines);
          } else {
            context.focusFile(relPath, `[Resource: ${relPath}] ${lines} lines. Use read_file("${relPath}", offset, limit) to access content.`, lines);
          }
        }
      }
    }
  }

  return agent;
}
