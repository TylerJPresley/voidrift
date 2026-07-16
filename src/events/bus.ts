import { EventEmitter } from "events";

export type EventType =
  // Session lifecycle
  | "SESSION_START"
  | "SESSION_END"
  | "SESSION_RESUMED"
  // Turn lifecycle
  | "TURN_BEFORE"
  | "TURN_AFTER"
  | "TURN_COMPLETE"
  | "TURN_CANCELLED"
  // Model
  | "MODEL_RESOLVED"
  | "MODEL_ESCALATED"
  | "MODEL_DEESCALATED"
  | "TOKEN_STREAM"
  // Tool execution
  | "BEFORE_TOOL_EXECUTE"
  | "AFTER_TOOL_EXECUTE"
  | "TOOL_CONFIRMATION_REQUEST"
  | "TOOL_CONFIRMATION_RESPONSE"
  | "TOOL_BOUND"
  | "TOOL_UNBOUND"
  // Context
  | "CONTEXT_BUDGET_UPDATED"
  | "CONTEXT_COMPACTED"
  | "CONTEXT_PRESSURE"
  | "FILE_FOCUSED"
  | "FILE_UNFOCUSED"
  // Skills & Memory
  | "SKILL_LOADED"
  | "SKILL_UNLOADED"
  | "MEMORY_LOADED"
  | "MEMORY_UNLOADED"
  | "MEMORY_SAVED"
  // Workspace
  | "FILE_CREATED"
  | "FILE_MODIFIED"
  | "FILE_DELETED"
  | "FILE_INDEXED"
  | "WORKSPACE_CHANGED"
  | "RESOURCE_CHANGED"
  | "CODEMAP_UPDATED"
  // Agents
  | "MODE_CHANGED"
  | "AGENT_ACTIVATED"
  // Subagents & Tasks
  | "SUBAGENT_SPAWNED"
  | "SUBAGENT_COMPLETED"
  | "LOCKS_UPDATED"
  | "TASK_SCHEDULED"
  | "TASK_FIRED"
  | "TASK_COMPLETED"
  // Security
  | "PERMISSION_GRANTED"
  | "PERMISSION_DENIED"
  | "POLICY_RULE_ADDED"
  | "STRUGGLE_DETECTED"
  // Diagnostics
  | "ERROR_OCCURRED"
  | "WARNING_EMITTED"
  // Plan
  | "PLAN_ITEM_ADDED"
  | "PLAN_ITEM_REMOVED"
  | "PLAN_ITEM_UPDATED"
  // Legacy (kept for backward compat, will deprecate)
  | "USER_INPUT"

export interface EventPayloadMap {
  // Session lifecycle
  SESSION_START: { workspaceRoot: string; globalConfig: Record<string, unknown> };
  SESSION_END: { sessionDurationMs: number; exitCode: number };
  SESSION_RESUMED: { sessionId: string; turnCount: number };
  // Turn lifecycle
  TURN_BEFORE: { userMessage: string; activeTools: string[]; activePlan: string | null; recentSummaries: string[]; recentTools: string[] };
  TURN_AFTER: { userMessage: string; responseText: string; toolsUsed: string[]; turnId: string; model?: string; usage?: { promptTokens: number; completionTokens: number }; timingMs?: number };
  TURN_COMPLETE: { turnId: string };
  TURN_CANCELLED: { reason: "user" | "timeout" | "error"; turnId: string };
  // Model
  MODEL_RESOLVED: { name: string; tier: string; protocol: string };
  MODEL_ESCALATED: { from: string; to: string; reason: string; auto: boolean };
  MODEL_DEESCALATED: { from: string; to: string };
  TOKEN_STREAM: { token: string; done: boolean };
  // Tool execution
  BEFORE_TOOL_EXECUTE: { toolName: string; arguments: Record<string, unknown> };
  AFTER_TOOL_EXECUTE: { toolName: string; arguments: Record<string, unknown>; status: "success" | "error"; output: string };
  TOOL_CONFIRMATION_REQUEST: { tool: string; args: Record<string, unknown>; requestId?: string; diff?: string[]; inferredPatterns?: string[] };
  TOOL_CONFIRMATION_RESPONSE: { approved: boolean; requestId?: string; persist?: boolean; chosenPattern?: string };
  TOOL_BOUND: { tools: string[]; source: "preflight" | "recovery" | "search_tools" };
  TOOL_UNBOUND: { tools: string[]; reason: "decay" | "agent_switch" };
  // Context
  CONTEXT_BUDGET_UPDATED: { used: number; limit: number; percentage: number };
  CONTEXT_COMPACTED: { beforeCount: number; afterCount: number; freedTokens: number };
  CONTEXT_PRESSURE: { percentage: number; level: "warning" | "critical" };
  FILE_FOCUSED: { path: string; totalLines: number; tokensUsed: number };
  FILE_UNFOCUSED: { path: string; reason: "evicted" | "cleared" };
  // Skills & Memory
  SKILL_LOADED: { name: string; trigger: "keyword" | "extension" | "file" | "agent" | "description" | "inherited" };
  SKILL_UNLOADED: { name: string };
  MEMORY_LOADED: { id: string; title: string; scope: "local" | "global" };
  MEMORY_UNLOADED: { id: string };
  MEMORY_SAVED: { id: string; title: string; scope: "local" | "global"; type: "directive" | "reference" };
  // Workspace
  FILE_CREATED: { path: string };
  FILE_MODIFIED: { path: string };
  FILE_DELETED: { path: string };
  FILE_INDEXED: { path: string; symbolCount: number };
  WORKSPACE_CHANGED: { filePaths: string[]; changeType: "create" | "update" | "delete" };
  RESOURCE_CHANGED: { path: string; type: string };
  CODEMAP_UPDATED: { fileCount: number; dirCount: number };
  // Agents
  MODE_CHANGED: { previousMode: string; newMode: string };
  AGENT_ACTIVATED: { from: string; to: string; trigger: "user" | "cycle" | "plugin" };
  // Subagents & Tasks
  SUBAGENT_SPAWNED: { subagentId: string; worktreePath: string };
  SUBAGENT_COMPLETED: { subagentId: string; status: "success" | "failed" };
  LOCKS_UPDATED: { activeLocks: string[] };
  TASK_SCHEDULED: { taskId: string; type: "cron" | "delay" | "background"; pattern: string };
  TASK_FIRED: { taskId: string; instruction: string };
  TASK_COMPLETED: { taskId: string; status: "completed" | "failed"; output?: string };
  // Security
  PERMISSION_GRANTED: { tool: string; pattern?: string; persist: boolean };
  PERMISSION_DENIED: { tool: string; reason: string };
  POLICY_RULE_ADDED: { tool: string; pattern?: string; decision: "allow" | "deny"; source: "session" | "workspace" | "user" };
  STRUGGLE_DETECTED: { text: string; expectedAction: string };
  // Diagnostics
  ERROR_OCCURRED: { message: string; source?: string };
  WARNING_EMITTED: { message: string; source: string; category?: string };
  // Plan
  PLAN_ITEM_ADDED: { name: string; priority: "now" | "next" | "later"; description: string };
  PLAN_ITEM_REMOVED: { name: string };
  PLAN_ITEM_UPDATED: { name: string; field: "priority" | "body" | "description"; oldValue?: string; newValue?: string };
  // Legacy
  USER_INPUT: { text: string };
}

export interface VoidRiftEvent<T extends EventType> {
  type: T;
  payload: EventPayloadMap[T];
  timestamp: number;
}

type Listener<T extends EventType> = (event: VoidRiftEvent<T>) => void | Promise<void>;

export type EventPriority = "critical" | "high" | "normal" | "low" | "background";

export interface SubscribeOptions {
  priority?: EventPriority;
}

interface RegisteredListener {
  type: string;
  priority: EventPriority;
  listener: (event: any) => Promise<void>;
  unsub: () => void;
}

export class EventBus {
  private emitter = new EventEmitter();
  private registeredEvents = new Set<string>();
  private listeners: RegisteredListener[] = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  registerEvent(name: string): void {
    this.registeredEvents.add(name);
  }

  listRegisteredEvents(): string[] {
    return [...this.registeredEvents];
  }

  subscribe<T extends EventType>(type: T, listener: Listener<T>, opts?: SubscribeOptions): () => void;
  subscribe(type: string, listener: (event: any) => void, opts?: SubscribeOptions): () => void;
  subscribe(type: string, listener: (event: any) => void, opts?: SubscribeOptions): () => void {
    const priority = opts?.priority ?? "normal";
    const wrapped = async (event: any) => {
      try {
        await listener(event);
      } catch (err) {
        console.error(`[EventBus] Listener for ${type} threw:`, err);
      }
    };
    this.emitter.on(type, wrapped);
    const unsub = () => {
      this.emitter.off(type, wrapped);
      const idx = this.listeners.findIndex(l => l.listener === wrapped);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
    this.listeners.push({ type, priority, listener: wrapped, unsub });
    return unsub;
  }

  publish<T extends EventType>(type: T, payload: EventPayloadMap[T]): void;
  publish(type: string, payload: Record<string, unknown>): void;
  publish(type: string, payload: any): void {
    this.emitter.emit(type, { type, payload, timestamp: Date.now() });
  }

  /**
   * Publish and await all subscribers sequentially (FIFO registration order).
   * Use for lifecycle events where subscribers must complete before proceeding.
   */
  async publishAndWait<T extends EventType>(type: T, payload: EventPayloadMap[T]): Promise<void>;
  async publishAndWait(type: string, payload: any): Promise<void>;
  async publishAndWait(type: string, payload: any): Promise<void> {
    const event = { type, payload, timestamp: Date.now() };
    const matching = this.listeners.filter(l => l.type === type);
    for (const entry of matching) {
      await entry.listener(event);
    }
  }
}
