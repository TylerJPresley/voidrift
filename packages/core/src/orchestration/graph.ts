import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { readFileSync } from "fs";
import { join } from "path";
import type { EventBus } from "../events/bus.js";
import type { AgentManifest } from "../agents/registry.js";
import { PermissionGate } from "../security/permission-gate.js";
import type { OnChunk } from "../adapters/stream.js";
import type { ModelResponse } from "../adapters/types.js";
import { streamModel } from "../adapters/stream.js";
import { TOOL_SCHEMAS } from "../tools/definitions.js";
import { readFile, globFiles, writeFile, editFile, executeCommand } from "../tools/executors.js";
import { webFetch, webSearch, type SearchConfig } from "../tools/web.js";
import { summarizeFileWithFlash } from "../codemap/summarizer.js";
import { IndexCache } from "../codemap/cache.js";
import type { ContextManager } from "../session/context.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { Tier } from "../adapters/factory.js";

// Workspace root — set by the harness on bootstrap
let _workspaceRoot = process.cwd();
let _cache: IndexCache | null = null;
let _scheduler: any = null;
let _planManager: any = null;
function getCache(root: string): IndexCache {
  if (!_cache) {
    _cache = new IndexCache(root);
  }
  return _cache;
}
export function setWorkspaceRoot(root: string) {
  _workspaceRoot = root;
  _cache = null; // Reset cache reference if workspace root changes
}
export function setScheduler(scheduler: any) {
  _scheduler = scheduler;
}
export function setPlanManager(pm: any) {
  _planManager = pm;
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

async function streamWithRetry(client: BaseChatModel, messages: BaseMessage[], onChunk: OnChunk, signal?: AbortSignal): Promise<ModelResponse> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { text: "", toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    const response = await streamModel(client, messages, onChunk, signal);
    // If no error or not retryable, return immediately
    if (response.text || response.toolCalls.length > 0) return response;
    // Check if the last chunk was a retryable error (indicated by empty response)
    // The streamModel function already emitted the error chunk; we retry silently
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
    } else {
      return response;
    }
  }
  return { text: "", toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

async function executeToolCall(toolName: string, argsJson: string, workspaceRoot: string, context?: ContextManager, config?: VoidRiftConfig): Promise<string> {
  let args: Record<string, any>;
  try {
    args = JSON.parse(argsJson);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: Failed to parse tool arguments: ${msg}`;
  }

  switch (toolName) {
    case "read_file":
      const rf = readFile(workspaceRoot, args.path ?? "", args.offset ?? 0, args.limit ?? 200);
      return rf.output || rf.error || "";
    case "glob_files":
      return globFiles(workspaceRoot, args.pattern ?? "").output;
    case "write_file":
      return writeFile(workspaceRoot, args.path ?? "", args.content ?? "").output;
    case "edit_file":
      return editFile(workspaceRoot, args.path ?? "", args.search ?? "", args.replace ?? "").output;
    case "execute_command":
      return executeCommand(workspaceRoot, args.command ?? "", args.timeout).output;
    case "web_fetch": {
      const result = await webFetch(args.url ?? "", workspaceRoot);
      if (result.isPrivate) return "Error: This is a private/localhost URL. Permission required to access local services.";
      return result.error ? `Error: ${result.error}` : result.output;
    }
    case "web_search": {
      const searchConfig = config?.search;
      const result = await webSearch(args.query ?? args.keywords ?? "", searchConfig);
      return result.error ? `Error: ${result.error}` : result.output;
    }
    case "read_plan":
      return context?.context.orbit.activePlan || "(no active plan)";
    case "write_plan":
      if (context) context.setPlan(args.content ?? "");
      return "Plan updated.";
    case "update_plan":
      if (context) {
        const current = context.context.orbit.activePlan || "";
        const updated = current.replace(args.search ?? "", args.replace ?? "");
        context.setPlan(updated);
      }
      return "Plan section updated.";
    case "save_memory": {
      const title = args.title ?? "Untitled";
      const content = args.content ?? "";
      const keywords = (args.keywords ?? "").split(",").map((k: string) => k.trim()).filter(Boolean);
      const scope = args.scope === "global" ? "global" : "local";
      const id = `mem-${Date.now().toString(36)}`;
      const dir = scope === "global"
        ? join(process.env.HOME || "", ".config", "voidrift", "memory")
        : join(workspaceRoot, ".voidrift", "memory");
      const { mkdirSync, writeFileSync } = await import("fs");
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${id}.md`);
      const file = `---\nid: ${id}\ntitle: ${title}\nsummary: ${content.slice(0, 100)}\ncontext:\n  keywords: [${keywords.map((k: string) => `"${k}"`).join(", ")}]\n---\n\n${content}\n`;
      writeFileSync(filePath, file, "utf-8");
      return `Memory saved: "${title}" (${scope})`;
    }
    case "schedule": {
      const instruction = args.instruction ?? "";
      const { TaskScheduler, parseDelay } = await import("../orchestration/scheduler.js");
      if (!_scheduler) return "Error: Scheduler not available.";
      if (args.delay) {
        const ms = parseDelay(args.delay);
        const task = _scheduler.scheduleDelay(ms, instruction);
        return `Scheduled one-shot task [${task.id}] firing in ${args.delay}.`;
      } else if (args.cron) {
        const task = _scheduler.scheduleCron(args.cron, instruction);
        return `Scheduled recurring task [${task.id}] with pattern "${args.cron}".`;
      }
      return "Error: Provide either 'delay' or 'cron' parameter.";
    }
    case "plan": {
      if (!_planManager) return "Error: Plan manager not available.";
      const action = args.action ?? "";
      switch (action) {
        case "add_phase":
          const phase = _planManager.addPhase(args.title ?? "Untitled Phase");
          return `Phase added: "${phase.title}" [${phase.id}]`;
        case "add_item": {
          const item = args.phase_id
            ? _planManager.addItem(args.phase_id, args.title ?? "", args.description ?? "", args.rationale ?? "", args.priority ?? "now")
            : _planManager.addItemToActive(args.title ?? "", args.description ?? "", args.rationale ?? "", args.priority ?? "now");
          return item ? `Item added: "${item.title}" [${item.id}]` : "Error: Phase not found.";
        }
        case "backlog": {
          const bl = _planManager.backlog(args.title ?? "", args.description ?? "", args.rationale ?? "");
          return bl ? `Backlogged: "${bl.title}" [${bl.id}]` : "Error: Failed to backlog.";
        }
        case "complete":
          return _planManager.complete(args.item_id ?? "") ? `Item completed.` : "Error: Item not found.";
        case "remove":
          return _planManager.remove(args.item_id ?? "") ? `Item removed.` : "Error: Item not found.";
        default:
          return `Error: Unknown plan action "${action}". Use: add_phase, add_item, backlog, complete, remove.`;
      }
    }
    case "run_task_agent":
      return `Error: run_task_agent must be handled by the orchestration layer.`;
    default:
      return `Error: Tool "${toolName}" not implemented.`;
  }
}

export interface OrchestrationInput {
  userMessage: string;
  client: BaseChatModel;
  systemPrompt: string;
  history: BaseMessage[];
  onChunk: OnChunk;
  signal?: AbortSignal;
  context?: ContextManager;
  config?: VoidRiftConfig;
  tier?: Tier;
  agent?: AgentManifest;
}

export interface OrchestrationResult {
  response: ModelResponse;
  path: "direct";
}

/**
 * Direct Chat Path.
 * Simple conversational turn — no multi-agent graph, just stream the model.
 */
export async function directChat(input: OrchestrationInput, bus?: EventBus): Promise<OrchestrationResult> {
  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    ...input.history,
    new HumanMessage(input.userMessage),
  ];

  // Bind tools from agent manifest
  const tools = input.agent
    ? TOOL_SCHEMAS.filter((t) => input.agent!.tools.includes(t.name))
    : TOOL_SCHEMAS;
  const toolDefs = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])),
        required: t.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));

  let client: BaseChatModel = input.client;
  try {
    if (toolDefs.length > 0 && input.client.bindTools) client = input.client.bindTools(toolDefs) as unknown as BaseChatModel;
  } catch {
    // Model doesn't support tool binding — fall back to raw client
  }

  // Initialize the permission gate for this turn execution context
  const gate = bus ? new PermissionGate(bus, _workspaceRoot) : null;

  // Tool execution loop: stream, execute any tool calls, feed results back
  let currentMessages = [...messages];
  let finalResponse: ModelResponse | null = null;
  const maxToolRounds = 10;
  const executedCalls = new Set<string>();

  for (let round = 0; round < maxToolRounds; round++) {
    if (input.signal?.aborted) break;
    if (round > 0) input.onChunk({ type: "status", message: "Thinking..." });
    const response = await streamWithRetry(client, currentMessages, input.onChunk, input.signal);
    finalResponse = response;

    if (input.signal?.aborted) break;
    if (response.toolCalls.length === 0) break;

    // Deduplicate: if we've already executed this exact call, stop looping
    const callKey = response.toolCalls.map((tc) => `${tc.name}:${tc.args}`).join("|");
    if (executedCalls.has(callKey)) break;
    executedCalls.add(callKey);

    // Add the AI message with tool calls
    currentMessages.push(new AIMessage({ content: response.text || "", tool_calls: response.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: JSON.parse(tc.args || "{}") })) }));

    for (const tc of response.toolCalls) {
      const args = JSON.parse(tc.args || "{}");

      let result: string;

      // Emit executing state so TUI shows tool immediately with spinner
      input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "executing" });

      // Execute the permission gate check if an active agent manifest is provided
      if (input.agent && gate) {
        const checkResult = await gate.check(tc.name, args, input.agent);
        if (!checkResult.approved) {
          const errMsg = checkResult.reason || "Error: Operation rejected by permission gate.";
          bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "error", output: errMsg });
          input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" });
          currentMessages.push(new ToolMessage({ content: errMsg, tool_call_id: tc.id }));
          continue; // Skip physical execution of this tool call
        }
      }

      bus?.publish("BEFORE_TOOL_EXECUTE", { toolName: tc.name, arguments: args });

      // Progressive disclosure: read_file without explicit offset → summarize full file
      if (tc.name === "read_file" && args.offset === undefined && input.context && input.config) {
        const filePath = args.path;
        // If already focused, return the cached summary immediately
        const existing = input.context.context.drift.focusedFiles.find(f => f.path === filePath);
        if (existing) {
          result = existing.summary;
        } else {
          try {
          const cacheInstance = getCache(_workspaceRoot);
          const fullContent = readFileSync(join(_workspaceRoot, filePath), "utf-8");
          const currentHash = cacheInstance.computeHash(fullContent);
          const cached = cacheInstance.get(filePath, currentHash);
          const totalLines = fullContent.split("\n").length;

          if (cached) {
            input.context.focusFile(filePath, cached.summary, cached.totalLines);
            result = cached.summary;
          } else {
            if (totalLines > (input.config.summarizeThreshold ?? 500)) {
              input.onChunk({ type: "status", message: `Indexing ${filePath} (${totalLines} lines)...` });
            }
            const { summary, totalLines: tl } = await summarizeFileWithFlash(filePath, fullContent, input.config);
            cacheInstance.set(filePath, currentHash, summary, tl);
            input.context.focusFile(filePath, summary, tl);
            result = summary;
          }
        } catch {
          result = await executeToolCall(tc.name, tc.args, _workspaceRoot, input.context, input.config);
        }
        }
      } else if (tc.name === "run_task_agent" && input.config && input.agent) {
        const taskArgs = JSON.parse(tc.args || "{}");
        const agentId = taskArgs.agentId || taskArgs.agent_id || "";
        const instruction = taskArgs.instruction || taskArgs.prompt || "";
        const { AgentRegistry } = await import("../agents/registry.js");
        const { createTierAdapter } = await import("../adapters/factory.js");
        
        // Look up task agent from registry
        const registry = new AgentRegistry();
        registry.discover(_workspaceRoot);
        const taskAgent = registry.get(agentId);
        const taskPrompt = taskAgent?.prompt || `You are task agent "${agentId}". Complete the following task.`;
        const tier = taskAgent?.modelTier === "auto" || !taskAgent?.modelTier ? "flash" : taskAgent.modelTier;
        const adapter = createTierAdapter(tier as any, input.config);
        const runAsync = taskAgent?.async && (input.config.maxConcurrentAgents ?? 1) > 1;

        const executeTask = async () => {
          const taskResult = await directChat({
            userMessage: instruction,
            client: adapter.client,
            systemPrompt: taskPrompt,
            history: [],
            onChunk: () => {},
            signal: input.signal,
            context: input.context,
            config: input.config,
            agent: taskAgent || input.agent,
          }, bus);
          return taskResult.response.text || "Task agent returned no output.";
        };

        if (runAsync) {
          // Fire and forget — report back via event bus when done
          executeTask().then(output => {
            bus?.publish("SUBAGENT_COMPLETED", { subagentId: agentId, status: "success" });
          }).catch(() => {
            bus?.publish("SUBAGENT_COMPLETED", { subagentId: agentId, status: "failed" });
          });
          bus?.publish("SUBAGENT_SPAWNED", { subagentId: agentId, worktreePath: _workspaceRoot });
          result = `Task agent "${agentId}" spawned in background.`;
        } else {
          result = await executeTask();
        }
      } else {
        result = await executeToolCall(tc.name, tc.args, _workspaceRoot, input.context, input.config);

        // Track focused files for write/edit and targeted reads
        if (input.context && input.config && (tc.name === "read_file" || tc.name === "write_file" || tc.name === "edit_file")) {
          const filePath = args.path;
          if (filePath) {
            try {
              const cacheInstance = getCache(_workspaceRoot);
              const fullContent = readFileSync(join(_workspaceRoot, filePath), "utf-8");
              const totalLines = fullContent.split("\n").length;
              const existing = input.context.context.drift.focusedFiles.find(f => f.path === filePath);
              if (existing) {
                // Update read ranges for targeted reads
                if (tc.name === "read_file" && args.offset !== undefined) {
                  const range: [number, number] = [args.offset, args.offset + (args.limit ?? 200)];
                  input.context.focusFile(filePath, existing.summary, totalLines, range);
                }
              } else {
                // New file focused via write/edit — summarize it
                const currentHash = cacheInstance.computeHash(fullContent);
                const cached = cacheInstance.get(filePath, currentHash);
                if (cached) {
                  input.context.focusFile(filePath, cached.summary, cached.totalLines);
                } else {
                  const { summary, totalLines: tl } = await summarizeFileWithFlash(filePath, fullContent, input.config);
                  cacheInstance.set(filePath, currentHash, summary, tl);
                  input.context.focusFile(filePath, summary, tl);
                }
              }
            } catch {}
          }
        }
      }

      bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: result.startsWith("Error:") ? "error" : "success", output: result });
      input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: result.startsWith("Error:") ? "error" : "complete" });
      currentMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
    }
  }

  // If the last response was a tool call (no text), make one final call to get text response
  if (finalResponse && finalResponse.toolCalls.length > 0 && !finalResponse.text.trim()) {
    // Add a nudge to get the model to respond with text instead of more tool calls
    currentMessages.push(new SystemMessage("Based on the tool results above, provide your response to the user. Do not call any more tools."));
    const textResponse = await streamWithRetry(input.client, currentMessages, input.onChunk, input.signal);
    finalResponse = textResponse;
  }

  return { response: finalResponse!, path: "direct" };
}

/**
 * Main orchestration entry point.
 * Always runs direct chat — model delegates to task agents as needed.
 */
export async function runTurn(input: OrchestrationInput, bus: EventBus): Promise<OrchestrationResult> {
  const result = await directChat(input, bus);
  bus.publish("TURN_COMPLETE", { turnId: `turn-${Date.now()}` });
  return result;
}
