/**
 * Typed Engine Context — replaces the untyped god object.
 * Each consumer receives only the slice it needs.
 */
import type { ContextManager } from "./session/context.js";
import type { TokenBudgetWatcher } from "./output/budget.js";
import type { ExceptionGuard } from "./session/guard.js";
import type { StatsTracker } from "./session/stats.js";
import type { MemoryRegistry } from "./session/memory.js";
import type { SkillManager } from "./skills/manager.js";
import type { TemplateService } from "./templates/service.js";
import type { MCPEngine } from "./mcp/engine.js";
import type { Container } from "./bootstrap/container.js";
import type { AuditLogger } from "./logging/audit.js";
import type { WorktreeEngine } from "./worktree/engine.js";
import type { TaskScheduler } from "./orchestration/scheduler.js";
import type { GitCheckpointer } from "./safeguards/checkpoint.js";
import type { PlanManager } from "./session/plan.js";
import type { AgentRegistry } from "./agents/registry.js";
import type { PromptRegistry } from "./prompts/registry.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { SessionBrain } from "./session/brain.js";

export interface EngineContext {
  container: Container;
  context: ContextManager;
  budget: TokenBudgetWatcher;
  agents: AgentRegistry;
  prompts: PromptRegistry;
  guard: ExceptionGuard;
  stats: StatsTracker;
  memory: MemoryRegistry;
  skills: SkillManager;
  mcp: MCPEngine;
  templates: TemplateService;
  logger: AuditLogger;
  worktree: WorktreeEngine;
  scheduler: TaskScheduler;
  checkpointer: GitCheckpointer;
  planManager: PlanManager;
  brain: SessionBrain;
  pluginRegistry: PluginRegistry;
  sessionId: string;
  branch: string | null;
  shortPath: string;
  workspaceRoot: string;
  startupWarnings?: string[];
  setCmdOutput: (fn: (text: string) => void) => void;
  setOpenPanel: (fn: (panel: string) => void) => void;
}
