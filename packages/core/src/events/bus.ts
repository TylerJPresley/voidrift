import { EventEmitter } from "events";

export type EventType =
  | "FILE_CREATED"
  | "FILE_MODIFIED"
  | "FILE_DELETED"
  | "RESOURCE_CHANGED"
  | "USER_INPUT"
  | "TOKEN_STREAM"
  | "TOOL_CONFIRMATION_REQUEST"
  | "TOOL_CONFIRMATION_RESPONSE"
  | "ERROR_OCCURRED"
  | "TURN_COMPLETE"
  | "LOCKS_UPDATED"
  | "SUBAGENT_SPAWNED"
  | "SUBAGENT_COMPLETED"
  // Extended events (Section 9.3)
  | "SESSION_START"
  | "SESSION_END"
  | "MODE_CHANGED"
  | "NODE_TRANSITION"
  | "STREAM_CHUNK_RECEIVED"
  | "BEFORE_TOOL_EXECUTE"
  | "AFTER_TOOL_EXECUTE"
  | "WORKSPACE_CHANGED"
  | "STATE_SERIALIZED";

export interface EventPayloadMap {
  FILE_CREATED: { path: string };
  FILE_MODIFIED: { path: string };
  FILE_DELETED: { path: string };
  RESOURCE_CHANGED: { path: string; type: string };
  USER_INPUT: { text: string };
  TOKEN_STREAM: { token: string; done: boolean };
  TOOL_CONFIRMATION_REQUEST: { tool: string; args: Record<string, unknown>; requestId?: string; diff?: string[] };
  TOOL_CONFIRMATION_RESPONSE: { approved: boolean; requestId?: string };
  ERROR_OCCURRED: { message: string; source?: string };
  TURN_COMPLETE: { turnId: string };
  LOCKS_UPDATED: { activeLocks: string[] };
  SUBAGENT_SPAWNED: { subagentId: string; worktreePath: string };
  SUBAGENT_COMPLETED: { subagentId: string; status: "success" | "failed" };
  // Extended
  SESSION_START: { workspaceRoot: string; globalConfig: Record<string, unknown> };
  SESSION_END: { sessionDurationMs: number; exitCode: number };
  MODE_CHANGED: { previousMode: string; newMode: string };
  NODE_TRANSITION: { fromNode: string; toNode: string; stateSnapshot: Record<string, unknown> };
  STREAM_CHUNK_RECEIVED: { type: "content" | "tool_call"; chunk: string | Record<string, unknown> };
  BEFORE_TOOL_EXECUTE: { toolName: string; arguments: Record<string, unknown> };
  AFTER_TOOL_EXECUTE: { toolName: string; arguments: Record<string, unknown>; status: "success" | "error"; output: string };
  WORKSPACE_CHANGED: { filePaths: string[]; changeType: "create" | "update" | "delete" };
  STATE_SERIALIZED: { filePath: string };
}

export interface VoidRiftEvent<T extends EventType> {
  type: T;
  payload: EventPayloadMap[T];
  timestamp: number;
}

type Listener<T extends EventType> = (event: VoidRiftEvent<T>) => void | Promise<void>;

export class EventBus {
  private emitter = new EventEmitter();
  private registeredEvents = new Set<string>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  registerEvent(name: string): void {
    this.registeredEvents.add(name);
  }

  listRegisteredEvents(): string[] {
    return [...this.registeredEvents];
  }

  subscribe<T extends EventType>(type: T, listener: Listener<T>): () => void;
  subscribe(type: string, listener: (event: any) => void): () => void;
  subscribe(type: string, listener: (event: any) => void): () => void {
    const wrapped = async (event: any) => {
      try {
        await listener(event);
      } catch (err) {
        console.error(`[EventBus] Listener for ${type} threw:`, err);
      }
    };
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }

  publish<T extends EventType>(type: T, payload: EventPayloadMap[T]): void;
  publish(type: string, payload: Record<string, unknown>): void;
  publish(type: string, payload: any): void {
    this.emitter.emit(type, { type, payload, timestamp: Date.now() });
  }
}
