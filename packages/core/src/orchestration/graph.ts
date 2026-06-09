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

import { mergeMessageRuns } from "@langchain/core/messages";
import { createTierAdapter } from "../adapters/factory.js";

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
      const maxLines = config?.maxReadLines ?? 1000;
      const filePath = args.path ?? "";
      const fullPath = filePath.startsWith("/") ? filePath : join(workspaceRoot, filePath);

      // Surgical read: model specified offset/limit — honor it
      if (args.offset !== undefined || args.limit !== undefined) {
        const rf = readFile(workspaceRoot, filePath, args.offset ?? 0, args.limit ?? maxLines);
        return rf.output || rf.error || "";
      }

      // Full file request: check if it fits in context budget
      try {
        const { readFileSync } = await import("fs");
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const totalLines = lines.length;
        // Estimate: ~4 chars per token. File fits if under 100K tokens.
        const estimatedTokens = Math.ceil(content.length / 4);

        if (estimatedTokens < 100000) {
          // File fits in context — return it all
          return content;
        }

        // File too large for context — return first chunk + guidance
        const rf = readFile(workspaceRoot, filePath, 0, maxLines);
        const guidance = `\n\n[NOTE: File has ${totalLines} lines (~${estimatedTokens} tokens). Returned first ${maxLines}. Use offset/limit for remaining sections.]`;
        return (rf.output || rf.error || "") + guidance;
      } catch {
        const rf = readFile(workspaceRoot, filePath, 0, maxLines);
        return rf.output || rf.error || "";
      }
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
    case "read_plan": {
      if (!_planManager) return "(no plan manager available)";
      if (args.action === "load" && args.name) {
        const body = _planManager.loadBody(`${args.name}.md`);
        return body ?? `Error: Plan item "${args.name}" not found.`;
      }
      const items = _planManager.all();
      if (items.length === 0) return "(no plan items)";
      const groups: Record<string, any[]> = { now: [], next: [], later: [] };
      for (const item of items) groups[item.priority]?.push(item);
      const lines: string[] = [];
      for (const [pri, list] of Object.entries(groups)) {
        if (list.length === 0) continue;
        lines.push(`\n## ${pri.toUpperCase()}`);
        for (const item of list) {
          lines.push(`- **${item.filename.replace(".md", "")}**: ${item.description}${item.rationale ? ` — ${item.rationale}` : ""}`);
        }
      }
      return lines.join("\n");
    }
    case "write_plan": {
      if (!_planManager) return "Error: Plan manager not available.";
      const action = args.action ?? "";
      switch (action) {
        case "add": {
          const name = args.name ?? `item-${Date.now().toString(36)}`;
          const filename = _planManager.add(name, args.description ?? "", args.rationale ?? "", args.priority ?? "now", args.body ?? "");
          // Refresh context
          if (context) context.setPlan(_planManager.compile() || "");
          return `Plan item added: ${filename}`;
        }
        case "remove":
          if (_planManager.remove(`${args.name}.md`)) {
            if (context) context.setPlan(_planManager.compile() || "");
            return `Plan item "${args.name}" removed.`;
          }
          return `Error: Item "${args.name}" not found.`;
        case "prioritize":
          if (_planManager.updatePriority(`${args.name}.md`, args.priority ?? "now")) {
            if (context) context.setPlan(_planManager.compile() || "");
            return `Priority updated: ${args.name} → ${args.priority}`;
          }
          return `Error: Item "${args.name}" not found.`;
        default:
          return `Error: Unknown action "${action}". Use: add, remove, prioritize.`;
      }
    }
    case "update_plan": {
      if (!_planManager) return "Error: Plan manager not available.";
      const item = _planManager.get(`${args.name}.md`);
      if (!item) return `Error: Item "${args.name}" not found.`;
      const updated = item.body.replace(args.search ?? "", args.replace ?? "");
      if (updated === item.body) return `Error: Search text not found in "${args.name}".`;
      // Rewrite the file with updated body
      _planManager.add(args.name, item.description, item.rationale, item.priority, updated);
      return `Plan item "${args.name}" updated.`;
    }
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
  mcp?: import("../mcp/engine.js").MCPEngine;
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

  // Bind tools using LangChain's native tool system (handles provider-specific translation)
  const { getLangchainTools, getAnthropicNativeTools } = await import("../tools/langchain-tools.js");
  const toolNames = input.agent
    ? input.agent.tools
    : TOOL_SCHEMAS.map(t => t.name);

  // Use Anthropic native tools (textEditor, bash) when provider is Anthropic — higher accuracy
  const isAnthropic = input.config?.models[input.config.tiers[input.tier as keyof typeof input.config.tiers] ?? ""]?.protocol === "anthropic";
  const lcTools = isAnthropic
    ? await getAnthropicNativeTools(toolNames, _workspaceRoot)
    : getLangchainTools(toolNames);

  // Append MCP tools as dynamic LangChain tools
  if (input.mcp) {
    const { DynamicStructuredTool } = await import("@langchain/core/tools");
    for (const server of input.mcp.connected) {
      for (const mcpTool of server.tools) {
        const fullName = `mcp_${server.name}_${mcpTool.name}`;
        const mcpRef = input.mcp;
        lcTools.push(new DynamicStructuredTool({
          name: fullName,
          description: (mcpTool.description || mcpTool.name).slice(0, 200),
          schema: mcpTool.inputSchema as any,
          func: async (args: Record<string, unknown>) => {
            try { return await mcpRef.callTool(server.name, mcpTool.name, args); }
            catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
          },
        }));
      }
    }
  }

  let client: BaseChatModel = input.client;
  try {
    if (lcTools.length > 0 && input.client.bindTools) client = input.client.bindTools(lcTools) as unknown as BaseChatModel;
  } catch {
    // Model doesn't support tool binding — fall back to raw client
  }

  // Add fallback chain: if the primary model fails, escalate to next tier
  // Only if tiers resolve to different models (avoid wasteful duplication)
  if (input.config && input.tier) {
    const TIER_ORDER: Array<"flash" | "utility" | "dense"> = ["flash", "utility", "dense"];
    const idx = TIER_ORDER.indexOf(input.tier as any);
    if (idx >= 0 && idx < TIER_ORDER.length - 1) {
      const primaryModel = input.config.tiers[input.tier as keyof typeof input.config.tiers];
      const fallbacks = TIER_ORDER.slice(idx + 1)
        .filter(t => input.config!.tiers[t] !== primaryModel)
        .map(t => {
          const fb = createTierAdapter(t, input.config!).client;
          return lcTools.length > 0 && fb.bindTools ? fb.bindTools(lcTools) as unknown as BaseChatModel : fb;
        });
      if (fallbacks.length > 0) {
        client = client.withFallbacks({ fallbacks }) as unknown as BaseChatModel;
      }
    }
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
    const response = await streamModel(client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, input.signal);
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

      // Yield event loop so TUI can render the tool spinner before sync execution
      await new Promise(r => setTimeout(r, 0));

      // Emit executing state with full args so TUI shows proper tool description
      input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "executing" });

      // Execute the permission gate check if an active agent manifest is provided
      // Permission gate — skip for MCP tools with readOnlyHint annotation
      const skipGate = input.mcp && tc.name.startsWith("mcp_") && input.mcp.isToolReadOnly(tc.name);
      if (input.agent && gate && !skipGate) {
        const checkResult = await gate.check(tc.name, args, input.agent);
        if (!checkResult.approved) {
          const errMsg = checkResult.reason || "Error: Operation rejected by permission gate.";
          bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "error", output: errMsg });
          input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" });
          currentMessages.push(new ToolMessage({ content: errMsg, tool_call_id: tc.id }));
          continue;
        }
      }

      bus?.publish("BEFORE_TOOL_EXECUTE", { toolName: tc.name, arguments: args });

      // Focus file in background (summary for drift awareness) but return actual content
      if (tc.name === "read_file" && input.context && input.config) {
        result = await executeToolCall(tc.name, tc.args, _workspaceRoot, input.context, input.config);
        const filePath = args.path;
        if (filePath) {
          try {
            const cacheInstance = getCache(_workspaceRoot);
            const fullContent = readFileSync(join(_workspaceRoot, filePath), "utf-8");
            const totalLines = fullContent.split("\n").length;
            const currentHash = cacheInstance.computeHash(fullContent);
            const cached = cacheInstance.get(filePath, currentHash);
            if (cached) {
              input.context.focusFile(filePath, cached.summary, cached.totalLines);
            } else {
              const { summary, totalLines: tl } = await summarizeFileWithFlash(filePath, fullContent, input.config);
              cacheInstance.set(filePath, currentHash, summary, tl);
              input.context.focusFile(filePath, summary, tl);
            }
          } catch {}
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
      } else if (tc.name.startsWith("mcp_") && input.mcp) {
        // MCP tool — route through the MCP engine
        const match = tc.name.match(/^mcp_([^_]+)_(.+)$/);
        if (match) {
          result = await input.mcp.callTool(match[1], match[2], args);
        } else {
          result = `Error: Invalid MCP tool name: ${tc.name}`;
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
                  const range: [number, number] = [args.offset, args.offset + (args.limit ?? input.config?.maxReadLines ?? 1000)];
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
    currentMessages.push(new HumanMessage("Based on the tool results above, provide your response to the user. Do not call any more tools."));
    const textResponse = await streamModel(input.client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, input.signal);
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
