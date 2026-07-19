import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { EventBus } from "../events/bus.js";
import type { AgentManifest } from "../agents/registry.js";
import { PermissionGate } from "../security/permission-gate.js";
import type { OnChunk } from "../adapters/stream.js";
import type { ModelResponse } from "../adapters/types.js";
import { streamModel } from "../adapters/stream.js";
import { TOOL_SCHEMAS } from "../tools/definitions.js";
import { executeRegisteredTool } from "./tool-registry.js";
import { summarizeFileWithFlash } from "../codemap/summarizer.js";
import { IndexCache } from "../codemap/cache.js";
import type { ContextManager } from "../session/context.js";
import type { VoidRiftConfig } from "../config/loader.js";
import type { Tier } from "../adapters/factory.js";
import { mergeMessageRuns } from "@langchain/core/messages";
import { createTierAdapter } from "../adapters/factory.js";
import { getTierModel } from "../config/loader.js";

// Module-level state — set by the harness on bootstrap
let _workspaceRoot = process.cwd();
let _scheduler: any = null;
let _planManager: any = null;

const _caches = new Map<string, IndexCache>();
function getCache(root: string): IndexCache {
  let cache = _caches.get(root);
  if (!cache) { cache = new IndexCache(root); _caches.set(root, cache); }
  return cache;
}

export function setWorkspaceRoot(root: string) {
  _workspaceRoot = root;
}

export function setScheduler(scheduler: any) {
  _scheduler = scheduler;
}

export function setPlanManager(pm: any) {
  _planManager = pm;
}

async function executeToolCall(
  toolName: string,
  argsJson: string,
  workspaceRoot: string,
  context?: ContextManager,
  config?: VoidRiftConfig,
  planManager?: any,
  scheduler?: any,
): Promise<string> {
  // Normalize common model tool-calling variations to registered names
  const TOOL_ALIASES: Record<string, string> = {
    exec: "execute_command", run_command: "execute_command", bash: "execute_command", shell: "execute_command",
    textEditor: "edit_file", edit: "edit_file", str_replace: "edit_file",
    writeFile: "write_file", create_file: "write_file",
    readFile: "read_file", view_file: "read_file",
    search: "search_contents", grep: "search_contents",
    find_files: "glob_files", list_files: "glob_files",
  };
  const normalizedName = TOOL_ALIASES[toolName] || toolName;

  let args: Record<string, any>;
  try {
    args = JSON.parse(argsJson);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: Failed to parse tool arguments: ${msg}`;
  }

  return executeRegisteredTool(normalizedName, args, {
    workspaceRoot,
    context,
    config,
    planManager: planManager ?? _planManager,
    scheduler: scheduler ?? _scheduler,
  });
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
  workspaceRoot?: string;
  planManager?: any;
  scheduler?: any;
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
  const workspaceRoot = input.workspaceRoot || _workspaceRoot;

  // Build the current turn's HumanMessage — use content blocks for multimodal (images)
  const lastMsg = input.context?.context.void.messages.slice(-1)[0];
  const currentHuman = lastMsg?.contentBlocks?.length
    ? new HumanMessage({ content: lastMsg.contentBlocks as any })
    : new HumanMessage(input.userMessage);

  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    ...input.history,
    currentHuman,
  ];

  // Bind tools using LangChain's native tool system (handles provider-specific translation)
  const { getLangchainTools, getAnthropicNativeTools } = await import("../tools/langchain-tools.js");
  
  const allAgentTools = input.agent
    ? input.agent.tools
    : TOOL_SCHEMAS.map(t => t.name);

  // Dynamic tool binding: resolve which tools are relevant for this turn
  let activeToolNames: string[];
  {
    // Contextual query: read summary + toolCalls from conversation chain (last N turns)
    const { buildContextualQuery, compileToolTOC, selectTools, BASELINE_TOOLS, TOOL_CATEGORIES } = await import("./tool-binding.js");
    const lookback = input.config?.turnsLookbackCount ?? 2;
    const recentMsgs = input.context?.context.void.messages.filter(m => m.role === "assistant").slice(-lookback) || [];
    const recentSummaries = recentMsgs.map(m => m.summary).filter(Boolean).join(" → ");
    const recentTools = recentMsgs.flatMap(m => m.toolCalls || []);
    const contextualQuery = buildContextualQuery(input.userMessage, recentSummaries, input.context?.context.orbit.activePlan);

    // Compile TOC of all available tools (core + MCP)
    const mcpServers = input.mcp?.connected.map(s => ({ name: s.name, tools: s.tools.map(t => ({ name: t.name, description: t.description })) }));
    const toolTOC = compileToolTOC(allAgentTools, mcpServers);

    // LLM-guided selection: flash model picks specific tools from the TOC
    const { createTierAdapter } = await import("../adapters/factory.js");
    const preflightStart = Date.now();
    const activeModelKey = input.tier ? getTierModel(input.config!, input.tier as any) : (input.config?.modelSelected !== "auto" ? input.config?.modelSelected : null);
    const skipPreflight = input.config?.turnsPreflight !== undefined
      ? !input.config.turnsPreflight
      : (activeModelKey && input.config?.models[activeModelKey]?.preflight === false);
    let selected = (!skipPreflight && input.config)
      ? await selectTools(createTierAdapter("utility", input.config).client, contextualQuery, toolTOC)
      : [...TOOL_CATEGORIES.write, ...TOOL_CATEGORIES.plan];
    const preflightMs = Date.now() - preflightStart;
    bus?.publish("TOOL_BOUND", { tools: selected, source: "preflight", query: contextualQuery.slice(0, 200), durationMs: preflightMs } as any);
    // If classifier returned nothing useful but we have conversational context, apply failsafe
    // "Nothing useful" = no write/execute tools when context implies action
    if (selected.length === 0 && recentSummaries) {
      selected = [...TOOL_CATEGORIES.write, ...TOOL_CATEGORIES.plan];
    } else if (recentSummaries && !selected.some(t => TOOL_CATEGORIES.write.includes(t) || TOOL_CATEGORIES.plan.includes(t) || TOOL_CATEGORIES.orchestration.includes(t))) {
      // Classifier returned only read tools but context implies action — add write tools
      selected = [...selected, ...TOOL_CATEGORIES.write, ...TOOL_CATEGORIES.plan];
    }

    // Merge baseline tools + selected tools + history-based tools
    const { findCategoryForTool } = await import("./tool-binding.js");
    const historyTools = new Set<string>();
    for (const msg of input.history.slice(-6)) {
      const type = msg._getType();
      if (type === "tool") {
        historyTools.add((msg as any).name);
      } else if (type === "ai" && (msg as any).tool_calls?.length) {
        for (const tc of (msg as any).tool_calls) historyTools.add(tc.name);
      }
    }
    // Also include tools from the conversation chain's toolCalls field
    for (const t of recentTools) historyTools.add(t);

    // Inherit toolbelt from previous turn (sticky — tools don't disappear between turns)
    const inherited = input.context?.context.agent.activeTools || [];
    // Decay: only keep inherited tools that are baseline OR were used in the last 3 turns
    const decayedInherited = inherited.filter(t => BASELINE_TOOLS.includes(t) || historyTools.has(t));

    activeToolNames = [...new Set([
      ...BASELINE_TOOLS.filter(t => allAgentTools.includes(t)),
      ...decayedInherited.filter(t => allAgentTools.includes(t)),
      ...selected.filter(t => typeof t === "string" && (allAgentTools.includes(t) || t.startsWith("mcp_"))),
      ...[...historyTools].filter(t => allAgentTools.includes(t)),
    ])];

    // Sort for cache stability: core (BASELINE order) → plugin (a-z) → MCP (a-z)
    const baselineOrder = new Map(BASELINE_TOOLS.map((t, i) => [t, i]));
    activeToolNames.sort((a, b) => {
      const aIsCore = baselineOrder.has(a);
      const bIsCore = baselineOrder.has(b);
      const aIsMcp = a.startsWith("mcp_");
      const bIsMcp = b.startsWith("mcp_");
      if (aIsCore && !bIsCore) return -1;
      if (!aIsCore && bIsCore) return 1;
      if (aIsCore && bIsCore) return (baselineOrder.get(a) ?? 0) - (baselineOrder.get(b) ?? 0);
      if (aIsMcp && !bIsMcp) return 1;
      if (!aIsMcp && bIsMcp) return -1;
      return a.localeCompare(b);
    });

    // Save the active toolbelt back to context so it persists to the next turn
    if (input.context) {
      input.context.setTools(activeToolNames);
      bus?.publish("TOOL_BOUND", { tools: activeToolNames, source: "merged" } as any);
    }
  }

  // Use Anthropic native tools when provider is Anthropic (higher accuracy for file ops)
  const isAnthropic = input.config?.models[getTierModel(input.config, input.tier as any) ?? ""]?.protocol === "anthropic";
  const lcTools = isAnthropic
    ? await getAnthropicNativeTools(activeToolNames, workspaceRoot)
    : getLangchainTools(activeToolNames);

  // Append MCP tools as dynamic LangChain tools (only those selected by the classifier)
  if (input.mcp) {
    const { DynamicStructuredTool } = await import("@langchain/core/tools");
    for (const server of input.mcp.connected) {
      for (const mcpTool of server.tools) {
        const fullName = `mcp_${server.name}_${mcpTool.name}`;
        // Only bind MCP tools that were selected by the preflight classifier
        if (!activeToolNames.includes(fullName)) continue;
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
      const primaryModel = getTierModel(input.config, input.tier as any);
      const fallbacks = TIER_ORDER.slice(idx + 1)
        .filter(t => getTierModel(input.config!, t as any) !== primaryModel)
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
  const gate = bus ? new PermissionGate(bus, workspaceRoot, input.config?.securityApprovalTimeout) : null;

  // Tool execution loop: stream, execute any tool calls, feed results back
  let currentMessages = [...messages];
  let finalResponse: ModelResponse | null = null;
  const executedCalls = new Set<string>();
  let lastContinuationText = "";
  let toolsExecutedThisTurn = 0;

  // Guardrail context — tracks patterns across the tool loop
  const { checkGuardrails, createGuardrailContext } = await import("./guardrails.js");
  const guardrailCtx = createGuardrailContext(workspaceRoot, input.context?.context.void.messages.length?.toString() ?? "0");

  // Loop detection — tracks consecutive failures and repeated patterns
  const { createLoopDetection, recordAndCheck } = await import("./loop-detection.js");
  const loopState = createLoopDetection();

  for (let round = 0; ; round++) {
    // Configurable round limit (0 = unlimited)
    const maxRounds = input.config?.turnsMaxToolRounds ?? 0;
    if (maxRounds > 0 && round >= maxRounds) break;
    // Check if active tools were modified (e.g. by search_tools) and re-bind
    if (input.context) {
      const currentActive = input.context.context.agent.activeTools;
      if (currentActive.some(t => !activeToolNames.includes(t))) {
        activeToolNames = [...new Set([...activeToolNames, ...currentActive])];
        const updatedLcTools = isAnthropic
          ? await getAnthropicNativeTools(activeToolNames, workspaceRoot)
          : getLangchainTools(activeToolNames);
        // Re-append selected MCP tools
        if (input.mcp) {
          const { DynamicStructuredTool } = await import("@langchain/core/tools");
          for (const server of input.mcp.connected) {
            for (const mcpTool of server.tools) {
              const fullName = `mcp_${server.name}_${mcpTool.name}`;
              if (!activeToolNames.includes(fullName)) continue;
              const mcpRef = input.mcp;
              updatedLcTools.push(new DynamicStructuredTool({
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
        try {
          client = input.client.bindTools ? input.client.bindTools(updatedLcTools) as unknown as BaseChatModel : client;
        } catch {}
      }
    }

    if (input.signal?.aborted) break;
    if (round > 0) input.onChunk({ type: "status", message: "Thinking..." });
    const response = await streamModel(client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, input.signal);
    finalResponse = response;

    if (input.signal?.aborted) break;

    if (response.toolCalls.length === 0) {
      // Only nudge if the model was cut off by length limit, not on natural completion
      const wasInterrupted = response.responseMetadata?.finish_reason === "length";
      if (round > 1 && wasInterrupted && response.text.trim().length < 200) {
        // Don't nudge if model is repeating itself (stuck)
        if (response.text.trim() === lastContinuationText) break;
        lastContinuationText = response.text.trim();
        currentMessages.push(new AIMessage(response.text || ""));
        currentMessages.push(new HumanMessage("Continue — you were in the middle of executing tool calls."));
        continue;
      }

      // Recovery: check if model attempted an unbound tool (mechanical detection only)
      {
        const { findCategoryForTool, expandWithCategory } = await import("./tool-binding.js");
        // Detect via partial tool_call_chunks — the model tried to call a tool that wasn't bound
        const partialChunks = (response as any)._raw?.tool_call_chunks || [];
        const partialNames = partialChunks.map((c: any) => c.name).filter(Boolean);
        const allUnbound = partialNames.filter((n: string) => allAgentTools.includes(n) && !activeToolNames.includes(n));

        if (allUnbound.length > 0) {
          // Expand tool set with the needed categories
          let expanded = [...activeToolNames];
          for (const toolName of allUnbound) {
            const cat = findCategoryForTool(toolName);
            if (cat) expanded = expandWithCategory(expanded, cat, allAgentTools);
          }
          // Rebind with expanded tool set
          const expandedLcTools = isAnthropic
            ? await getAnthropicNativeTools(expanded, workspaceRoot)
            : getLangchainTools(expanded);
          // Re-append MCP tools
          if (input.mcp) {
            const { DynamicStructuredTool } = await import("@langchain/core/tools");
            for (const server of input.mcp.connected) {
              for (const mcpTool of server.tools) {
                const fullName = `mcp_${server.name}_${mcpTool.name}`;
                const mcpRef = input.mcp;
                expandedLcTools.push(new DynamicStructuredTool({
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
          try {
            client = input.client.bindTools ? input.client.bindTools(expandedLcTools) as unknown as BaseChatModel : client;
          } catch {}
          // Update active set for future rounds
          activeToolNames.splice(0, activeToolNames.length, ...expanded);
          // Nudge model to retry with newly available tools
          currentMessages.push(new AIMessage(response.text || ""));
          currentMessages.push(new HumanMessage(`The following tools are now available: ${allUnbound.join(", ")}. Proceed with your intended action.`));
          continue;
        }
      }

      break;
    }

    // Deduplicate: if we've already executed this exact call, stop looping
    const callKey = response.toolCalls.map((tc) => `${tc.name}:${tc.args}`).join("|");
    if (executedCalls.has(callKey)) break;
    executedCalls.add(callKey);

    // Add the AI message with tool calls
    currentMessages.push(new AIMessage({ content: response.text || "", tool_calls: response.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: JSON.parse(tc.args || "{}") })) }));

    for (const tc of response.toolCalls) {
      if (input.signal?.aborted) break;
      const args = JSON.parse(tc.args || "{}");

      let result: string;

      // Yield event loop so TUI can render the tool spinner before sync execution
      await new Promise(r => setTimeout(r, 0));

      // Emit executing state with full args so TUI shows proper tool description
      input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "executing" });

      // Execute the permission gate check if an active agent manifest is provided
      // Permission gate
      if (input.agent && gate) {
        // Derive plan scope from active "now" plans
        const planScope = input.context?.context.orbit.activePlan ? (() => {
          const pm = input.planManager || _planManager;
          if (!pm) return undefined;
          const nowItems = pm.all().filter((i: any) => i.priority === "now" && i.scope);
          if (!nowItems.length) return undefined;
          const write = nowItems.flatMap((i: any) => i.scope?.write || []);
          const execute = nowItems.flatMap((i: any) => i.scope?.execute || []);
          return (write.length || execute.length) ? { write, execute } : undefined;
        })() : undefined;
        const checkResult = await gate.check(tc.name, args, input.agent, planScope);
        if (!checkResult.approved) {
          const errMsg = checkResult.reason || "Error: Operation rejected by permission gate.";
          bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "error", output: errMsg });
          input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" });
          currentMessages.push(new ToolMessage({ content: errMsg, tool_call_id: tc.id }));

          // Record error in loop detector before continuing
          loopState.consecutiveErrors++;
          loopState.toolFailures.set(tc.name, (loopState.toolFailures.get(tc.name) || 0) + 1);
          if (loopState.consecutiveErrors >= loopState.maxConsecutiveErrors) {
            input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" });
            currentMessages.push(new ToolMessage({ content: errMsg, tool_call_id: tc.id }));
            currentMessages.push(new HumanMessage("⚠️ LOOP DETECTED: 3 consecutive tool failures. STOP calling tools. Restate what you're trying to accomplish and try a fundamentally different approach. Do NOT retry the same operation."));
            break;
          }
          continue;
        }
      }

      // Guardrail check — produces advisory warnings, may block
      guardrailCtx.round = round;
      guardrailCtx.callHistory.push({ name: tc.name, args });
      if (tc.name === "read_file" && args.path) guardrailCtx.filesRead.add(args.path as string);
      const guardrail = checkGuardrails(tc.name, args, guardrailCtx);
      if (guardrail.block) {
        const blockMsg = guardrail.preWarning || "Error: Blocked by guardrail.";
        bus?.publish("WARNING_EMITTED", { message: blockMsg, source: "guardrail", category: "block" } as any);
        bus?.publish("AFTER_TOOL_EXECUTE", { toolName: tc.name, arguments: args, status: "error", output: blockMsg });
        input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error", result: blockMsg });
        currentMessages.push(new ToolMessage({ content: blockMsg, tool_call_id: tc.id }));

        // Record error in loop detector before continuing
        loopState.consecutiveErrors++;
        loopState.toolFailures.set(tc.name, (loopState.toolFailures.get(tc.name) || 0) + 1);
        if (loopState.consecutiveErrors >= loopState.maxConsecutiveErrors) {
          input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error" });
          currentMessages.push(new ToolMessage({ content: blockMsg, tool_call_id: tc.id }));
          currentMessages.push(new HumanMessage("⚠️ LOOP DETECTED: 3 consecutive tool failures. STOP calling tools. Restate what you're trying to accomplish and try a fundamentally different approach. Do NOT retry the same operation."));
          break;
        }
        continue;
      }

      bus?.publish("BEFORE_TOOL_EXECUTE", { toolName: tc.name, arguments: args });

      // Focus file in background (summary for drift awareness) but return actual content
      if (tc.name === "read_file" && input.context && input.config) {
        result = await executeToolCall(tc.name, tc.args, workspaceRoot, input.context, input.config, input.planManager, input.scheduler);
        const filePath = args.path;
        if (filePath) {
          try {
            const cacheInstance = getCache(workspaceRoot);
            const fullContent = readFileSync(join(workspaceRoot, filePath), "utf-8");
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
        const { FileSystemAgentRepository } = await import("../agents/repository.js");
        const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
        registry.discover(workspaceRoot);
        const taskAgent = registry.get(agentId);
        const taskPrompt = taskAgent?.prompt || `You are task agent "${agentId}". Complete the following task.`;
        const tier = taskAgent?.role === "auto" || !taskAgent?.role ? "flash" : taskAgent.role;
        const adapter = createTierAdapter(tier as any, input.config);
        const runAsync = taskAgent?.async && (input.config.tasksMaxConcurrent ?? 1) > 1;

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
          bus?.publish("SUBAGENT_SPAWNED", { subagentId: agentId, worktreePath: workspaceRoot });
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
      } else if (tc.name === "spawn_subagent" && input.config) {
        const subArgs = JSON.parse(tc.args || "{}");
        const files = subArgs.files || [];
        const task = subArgs.task || "";
        const mode = subArgs.mode || "singlePass";
        const { WorktreeEngine } = await import("../worktree/engine.js");
        const { createTierAdapter } = await import("../adapters/factory.js");

        const worktree = new WorktreeEngine(workspaceRoot, bus!);
        const subTask = await worktree.schedule(files, async (wtPath) => {
          const adapter = createTierAdapter("utility", input.config!);

          if (mode === "iterativeLoop") {
            // Ralph Loop — iterative execution until complete
            const { ralphLoop } = await import("./run.js");
            const subResult = await ralphLoop(task, adapter.client, bus!, () => {}, { interrupted: false });
            return subResult.success ? "success" : "failed";
          }

          // Standard — single directChat pass
          const subResult = await directChat({
            userMessage: task,
            client: adapter.client,
            systemPrompt: `You are a background subagent working in an isolated worktree at ${wtPath}. Complete the task. Do not ask questions — work autonomously.

## Operational Constraints
- Your context window is limited. Do NOT try to hold large datasets in conversation.
- Write intermediate results to files. Use .voidrift/cache/${subTask.id}/ for temp work.
- For batch operations (processing many URLs, files, or items): write a bash/node script to .voidrift/cache/${subTask.id}/ and execute it. Collect results from the script output or output file.
- Work incrementally: process in chunks, write results as you go, read back what you need.
- If a task is too large for one pass, break it into steps that each produce a file artifact.
- When done, delete .voidrift/cache/${subTask.id}/ entirely. Only leave final output artifacts in the worktree root.`,
            history: [],
            onChunk: () => {},
            signal: input.signal,
            config: input.config,
          }, bus!);
          return subResult.response.text ? "success" : "failed";
        });

        if (subTask.status === "queued") {
          result = `Subagent queued [${subTask.id}] — file lock conflict. Will run when paths are available.`;
        } else {
          result = `Subagent spawned [${subTask.id}] in worktree. Status: ${subTask.status}. Branch: ${subTask.branch}.`;
        }
        bus?.publish("SUBAGENT_SPAWNED", { subagentId: subTask.id, worktreePath: subTask.worktreePath });
      } else {
        result = await executeToolCall(tc.name, tc.args, workspaceRoot, input.context, input.config, input.planManager, input.scheduler);

        // Track focused files for write/edit and targeted reads
        if (input.context && input.config && (tc.name === "read_file" || tc.name === "write_file" || tc.name === "edit_file")) {
          const filePath = args.path;
          if (filePath) {
            try {
              const cacheInstance = getCache(workspaceRoot);
              const fullContent = readFileSync(join(workspaceRoot, filePath), "utf-8");
              const totalLines = fullContent.split("\n").length;
              const existing = input.context.context.drift.focusedFiles.find(f => f.path === filePath);
              if (existing) {
                // Update read ranges for targeted reads
                if (tc.name === "read_file" && args.offset !== undefined) {
                  const range: [number, number] = [args.offset, args.offset + (args.limit ?? input.config?.turnsMaxReadLines ?? 1000)];
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
      // Clear dedup cache after mutations — allows re-reads for verification
      if (["write_file", "edit_file", "execute_command", "background_exec"].includes(tc.name) && !result.startsWith("Error:")) {
        executedCalls.clear();
      }

      // Loop detection — track failures and break on repeated errors
      const isFailure = result.startsWith("Error:") || result.startsWith("⚠️") || result.includes("denied") || result.includes("timed out");
      if (isFailure) {
        loopState.consecutiveErrors++;
        loopState.toolFailures.set(tc.name, (loopState.toolFailures.get(tc.name) || 0) + 1);
      } else {
        loopState.consecutiveErrors = 0;
      }
      // Hard termination: 3 consecutive errors or same tool failing 4+ times
      if (loopState.consecutiveErrors >= loopState.maxConsecutiveErrors) {
        input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error", result });
        currentMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
        currentMessages.push(new HumanMessage("⚠️ LOOP DETECTED: 3 consecutive tool failures. STOP calling tools. Restate what you're trying to accomplish and try a fundamentally different approach. Do NOT retry the same operation."));
        break;
      }
      if ((loopState.toolFailures.get(tc.name) || 0) >= loopState.maxToolFailures) {
        input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error", result });
        currentMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
        currentMessages.push(new HumanMessage(`⚠️ LOOP DETECTED: "${tc.name}" has failed ${loopState.maxToolFailures} times this turn. STOP using this tool. Either use a different approach or ask the user for help.`));
        break;
      }

      // Fingerprint doom-loop — detect repeated (tool+args) even on success
      const fp = `${tc.name}:${tc.args}`;
      loopState.fingerprints.push(fp);
      if (loopState.fingerprints.length > loopState.fingerprintWindow) loopState.fingerprints.shift();
      const fpCount = loopState.fingerprints.filter(f => f === fp).length;
      if (fpCount >= loopState.fingerprintThreshold) {
        input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: "error", result });
        currentMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
        currentMessages.push(new HumanMessage(`⚠️ DOOM LOOP: "${tc.name}" called ${fpCount} times with identical arguments in the last ${loopState.fingerprintWindow} calls. You are not making progress. STOP and try a completely different approach.`));
        break;
      }

      input.onChunk({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args, status: result.startsWith("Error:") ? "error" : "complete", result });
      // Strip diff from what goes to model context (save tokens)
      const modelResult = result.includes("\n---DIFF---\n") ? result.split("\n---DIFF---\n")[0] : result;
      // Trim large tool outputs — keep head/tail, offload middle to cache
      const trimmedResult = trimToolOutput(modelResult, tc.name, workspaceRoot, input.config);
      // Inject guardrail advisories into model-facing result
      const advisedResult = (guardrail.preWarning ? guardrail.preWarning + "\n\n" : "") + trimmedResult + (guardrail.postWarning ? "\n\n" + guardrail.postWarning : "");
      currentMessages.push(new ToolMessage({ content: advisedResult, tool_call_id: tc.id }));

      // System reminder — combat attention decay on long tool sequences
      // System reminder — combat attention decay on long tool sequences
      toolsExecutedThisTurn++;
      const reminderInterval = input.config?.turnsReminderInterval ?? 0;
      if (reminderInterval > 0 && toolsExecutedThisTurn > 0 && toolsExecutedThisTurn % reminderInterval === 0) {
        currentMessages.push(new HumanMessage("📌 Reminder: Read before editing. Stay within the requested scope. Verify changes work before moving on. If stuck, try a fundamentally different approach."));
      }

      // Mid-turn budget check — if context is getting dangerously full, stop executing tools
      const currentTokens = currentMessages.reduce((acc, m) => acc + Math.ceil((typeof m.content === "string" ? m.content.length : 100) / 4), 0)
        + (input.agent?.tools.length ?? 0) * 130; // tool schema overhead
      const contextLimit = input.config?.models[getTierModel(input.config, input.tier as any) ?? ""]?.contextLimit ?? 128000;
      const maxOutput = input.config?.models[getTierModel(input.config, input.tier as any) ?? ""]?.maxOutputTokens ?? 4096;
      if (currentTokens > (contextLimit - maxOutput) * (input.config?.turnsContextBudgetStopPct ?? 0.6)) {
        // Context is filling up — give the model one final chance to wrap up or delegate
        currentMessages.push(new HumanMessage("⚠️ Context budget is at 60%. You MUST wrap up now. If work remains, delegate to a subagent via spawn_subagent or background_exec with a script. Do NOT continue processing items in this turn."));
        break;
      }
    }
  }

  // Output token enforcement: if prompt is so large the model has little room to respond,
  // inject a warning before the final streaming call
  if (finalResponse && currentMessages.length > 0) {
    const finalPromptTokens = currentMessages.reduce((acc, m) => acc + Math.ceil((typeof m.content === "string" ? m.content.length : 100) / 4), 0);
    const contextLimit2 = input.config?.models[getTierModel(input.config, input.tier as any) ?? ""]?.contextLimit ?? 128000;
    const maxOutput2 = input.config?.models[getTierModel(input.config, input.tier as any) ?? ""]?.maxOutputTokens ?? 4096;
    const remainingOutput = contextLimit2 - finalPromptTokens;
    if (remainingOutput < maxOutput2 * 0.5) {
      // Less than half of maxOutput available — model will likely truncate
      currentMessages.push(new HumanMessage("⚠️ Output budget is critically low. Write results to a file via a script in .voidrift/cache/ instead of generating inline. Keep your text response under 200 words."));
    }
  }

  // If the last response was a tool call (no text), make one final call to get text response
  if (finalResponse && finalResponse.toolCalls.length > 0 && !finalResponse.text.trim()) {
    // Add a nudge to get the model to respond with text instead of more tool calls
    currentMessages.push(new HumanMessage("Based on the tool results above, provide your response to the user. Do not call any more tools."));
    const finalTimeoutMs = input.config?.networkModelFinalTimeoutMs ?? 60_000;
    const finalAbort = new AbortController();
    const finalTimer = setTimeout(() => finalAbort.abort(), finalTimeoutMs);
    const textResponse = await streamModel(input.client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, finalAbort.signal);
    clearTimeout(finalTimer);
    finalResponse = textResponse;

    // If the final call was aborted (timeout), nudge to check completion
    if (finalAbort.signal.aborted && !input.signal?.aborted) {
      input.onChunk({ type: "status", message: "Response timed out — checking completion..." });
      currentMessages.push(new HumanMessage("Your response was cut short by a timeout. Briefly: did you finish the task? If yes, summarize in 1-2 sentences. If not, state what remains."));
      const nudgeAbort = new AbortController();
      const nudgeTimer = setTimeout(() => nudgeAbort.abort(), input.config?.networkModelRetryTimeoutMs ?? 30_000);
      const nudgeResponse = await streamModel(input.client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, nudgeAbort.signal);
      clearTimeout(nudgeTimer);
      if (nudgeResponse.text.trim()) {
        // Append the nudge response to whatever we got from the timed-out call
        finalResponse = { ...finalResponse, text: (finalResponse.text + "\n\n" + nudgeResponse.text).trim() };
      }
    }
  }

  // Guard: if the model produced nothing usable (empty text, no tool calls), retry once with a nudge
  if (finalResponse && !finalResponse.text.trim() && finalResponse.toolCalls.length === 0 && !input.signal?.aborted) {
    input.onChunk({ type: "status", message: "Retrying..." });
    currentMessages.push(new HumanMessage("You did not produce a response. Summarize what you accomplished in 1-2 sentences."));
    const retryTimeoutMs = input.config?.networkModelRetryTimeoutMs ?? 30_000;
    const retryAbort = new AbortController();
    const retryTimer = setTimeout(() => retryAbort.abort(), retryTimeoutMs);
    const retryResponse = await streamModel(client, mergeMessageRuns(currentMessages) as BaseMessage[], input.onChunk, retryAbort.signal);
    clearTimeout(retryTimer);
    if (retryResponse.text.trim() || retryResponse.toolCalls.length > 0) {
      finalResponse = retryResponse;
    }
  }

  // Struggle signal: detect when model expresses intent to act but didn't call a tool
  // This indicates a missing tool, wrong binding, or model self-censoring — a harness bug.
  if (finalResponse && finalResponse.toolCalls.length === 0 && finalResponse.text.trim()) {
    const intentPatterns = /\b(let me (update|write|edit|create|fix|modify|change|add|remove|delete)|i('ll| will) (update|write|edit|create|fix|modify|change|add|remove|delete))\b/i;
    if (intentPatterns.test(finalResponse.text)) {
      bus?.publish("STRUGGLE_DETECTED", {
        text: finalResponse.text.slice(0, 200),
        expectedAction: "tool_call",
      });
    }
  }

  if (!finalResponse) {
    return { response: { text: "", toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, timing: { requestStart: Date.now(), firstTokenAt: null, endAt: Date.now() } }, path: "direct" };
  }

  return { response: finalResponse, path: "direct" };
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

// ─── Tool Output Trimming ────────────────────────────────────────────────────

const TRIM_THRESHOLD_LINES = 80;
const TRIM_HEAD = 30;
const TRIM_TAIL = 20;

/**
 * Trims large tool outputs to head + tail, offloading full content to cache.
 * Small outputs pass through unchanged. Read tools are exempt (model needs full content).
 */
function trimToolOutput(output: string, toolName: string, workspaceRoot: string, config?: import("../config/loader.js").VoidRiftConfig): string {
  // Never trim read_file results — the model asked for this content specifically
  if (toolName === "read_file") return output;

  const threshold = config?.turnsTrimThresholdLines ?? TRIM_THRESHOLD_LINES;
  const headLines = config?.turnsTrimHead ?? TRIM_HEAD;
  const tailLines = config?.turnsTrimTail ?? TRIM_TAIL;

  const lines = output.split("\n");
  if (lines.length <= threshold) return output;

  // Offload full output to cache
  const cacheDir = join(workspaceRoot, ".voidrift", "cache", "tool-output");
  mkdirSync(cacheDir, { recursive: true });
  const filename = `${toolName}-${Date.now().toString(36)}.txt`;
  const cachePath = `.voidrift/cache/tool-output/${filename}`;
  writeFileSync(join(workspaceRoot, cachePath), output, "utf-8");

  // Return head + tail with pointer
  const head = lines.slice(0, TRIM_HEAD).join("\n");
  const tail = lines.slice(-TRIM_TAIL).join("\n");
  const omitted = lines.length - TRIM_HEAD - TRIM_TAIL;

  return `${head}\n\n[... ${omitted} lines omitted — full output at ${cachePath} ...]\n\n${tail}`;
}
