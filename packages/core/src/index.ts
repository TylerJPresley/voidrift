// Tier 1: Application Container
export { EventBus, type EventType, type EventPayloadMap, type VoidRiftEvent } from "./events/bus.js";
export { loadConfig, ConfigSchema, type VoidRiftConfig, type ModelConfig, type LoadConfigOptions } from "./config/loader.js";
export { WorkspaceWatcher, type WatcherStatus } from "./watcher/index.js";
export { CoreRegistry, type CapabilityHook, type SlashCommandHook, type ModeHook } from "./registry/core.js";
export { cleanupWorktrees, writeWorktreeMeta, type CleanupResult, type WorktreeMeta } from "./bootstrap/cleanup.js";
export { bootstrap, type Container, type ContainerOptions } from "./bootstrap/container.js";

// Tier 2: Model Connectivity
export { createAdapter, createTierAdapter, type Tier, type ResolvedModel } from "./adapters/factory.js";
export { streamModel, type OnChunk } from "./adapters/stream.js";
export type { StreamChunk, ContentChunk, ToolCallChunk, DoneChunk, ErrorChunk, TokenUsage, ModelResponse, StreamTiming } from "./adapters/types.js";
export { routeTier, resolveRouter, escalateTier, delegateTier, shouldEscalate, resolveEscalation, resolveDelegation, buildEscalationState, escalationNotice, type NodeType, type Mode, type RoutingContext, type EscalationState, type EscalationCode } from "./router/index.js";

// Tier 3: Capability Subsystem
export type { ToolSchema, ToolParameter, SafetyProfile, ActionLayer } from "./tools/types.js";
export { TOOL_SCHEMAS, getToolSchema } from "./tools/definitions.js";
export { bindTools } from "./tools/binding.js";
export { readFile, globFiles, writeFile, editFile, executeCommand, type ToolResult } from "./tools/executors.js";
export { webFetch, webSearch, type WebResult } from "./tools/web.js";
export { gitSafeguard, restoreSafeguardStash, type SafeguardResult } from "./safeguards/git.js";
export { GitCheckpointer } from "./safeguards/checkpoint.js";
export { computeDiff, computeEditDiff, getWorkspaceDiff } from "./safeguards/diff.js";
export { generateCodeMap, getCodeMapEntries, summarizeFile, type CodeMapEntry } from "./codemap/index.js";
export { summarizeFileWithFlash } from "./codemap/summarizer.js";
export { IndexCache, type CacheEntry } from "./codemap/cache.js";
export { SkillManager, type SkillEntry, type SkillTriggers, type AnchorContext } from "./skills/manager.js";
export { getSkillTemplates, findRelevantTemplates } from "./skills/templates.js";
export { WorktreeEngine, type SubagentTask, type LockEntry, type QueueEntry } from "./worktree/engine.js";
export { TemplateService, type TemplateSlot, type ResolvedSlot, type ResolvedTemplate, type TemplateType, type SlotAction, type TemplateContext, type AgentConfig, type ValidationDiagnostic } from "./templates/service.js";
export { MCPEngine, type MCPServer, type MCPServerConfig, type MCPToolSchema } from "./mcp/engine.js";
export { routeMCPToolCall, isMCPTool } from "./mcp/router.js";

// Tier 4: Security Subsystem
export { PermissionGate, type PendingRequest, type GateResult } from "./security/permission-gate.js";
export { AgentRegistry, type AgentManifest, type AgentType, type ApprovalMode, type ModelTier, type ToolSettings, ALL_TOOLS, READ_TOOLS } from "./agents/registry.js";
export { PromptRegistry, type PromptEntry, type ResolvedPrompt } from "./prompts/registry.js";

// Tier 5: Operator Interface
export { stripAnsi, truncateOutput } from "./output/truncator.js";
export { TokenBudgetWatcher, type BudgetColor, type BudgetState } from "./output/budget.js";
export { InputLock } from "./output/input-lock.js";
export { AuditLogger, type LogEntry, type AuditLoggerOptions } from "./logging/audit.js";
export { getGitBranch, shortenPath } from "./output/workspace.js";
export { AutocompleteEngine } from "./output/autocomplete.js";

// Tier 6: Agent Session
export { ContextManager, type SessionContext, type AgentPartition, type OrbitPartition, type DriftPartition, type VoidPartition, type GovernancePartition, type WorkspacePartition, type WorkPartition, type FocusedFile, type Message, type TurnContext } from "./session/context.js";
export { PluginRegistry, discoverPlugins, type PluginMeta, type DiscoveredPlugin } from "./plugins/registry.js";
export { compilePrompt, type CompiledMessage } from "./session/compiler.js";
export { compactHistory, buildCompactionPrompt, type CompactionResult } from "./session/compactor.js";
export { TurnSerializer, type TurnStateJSON } from "./session/serializer.js";
export { SessionBrain, type TurnSnapshot } from "./session/brain.js";
export { ExceptionGuard } from "./session/guard.js";
export { MemoryRegistry, type MemoryMeta, type MemoryDiscoveryContext } from "./session/memory.js";
export { StatsTracker, type SessionStats, type ModelUsage, type ToolStats } from "./session/stats.js";

// Section 6: Slash Commands
export { registerCommands, type CommandDeps } from "./commands/index.js";

// Section 8: Orchestration
export { directChat, runTurn, setWorkspaceRoot, type OrchestrationInput, type OrchestrationResult } from "./orchestration/graph.js";
export { type GraphState, type RoutingFlag } from "./orchestration/nodes.js";
export { runGoal, type GoalResult } from "./orchestration/goal.js";
export { TaskScheduler, parseDelay, type ScheduledTask } from "./orchestration/scheduler.js";
// developCR moved to @voidrift/plugin-dev
export { importScan } from "./orchestration/import.js";

// Section 9: Plugin Interface
export { CoreAPI, type PanelDefinition, type PanelColumn, type PanelAction } from "./plugins/interface.js";

// Engine & Turn
export type { EngineContext } from "./engine.js";
export { executeTurn, type TurnCallbacks } from "./turn.js";
