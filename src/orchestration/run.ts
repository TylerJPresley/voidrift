import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EventBus } from "../events/bus.js";
import type { OnChunk } from "../adapters/stream.js";
import { directChat, type OrchestrationInput } from "./graph.js";
import { streamModel } from "../adapters/stream.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const DEFAULT_MAX_RUN_TURNS = 50;
const COMPLETION_TOKEN = "<!-- GOAL_COMPLETE -->";

const PLANNING_SYSTEM_PROMPT = `You are a planning model. Your job is to analyze a goal and produce a structured execution plan that a separate execution model will follow.

Output a plan in this exact format:

## Goal
<restate the goal clearly>

## Files to Read First
- <file paths the executor should read before making changes>

## Steps
1. <concrete step with specific file paths and what to do>
2. <next step>
...

## Verification
- <how to verify the work is complete — specific commands to run, files to check>

Rules:
- Be specific. Name exact files, functions, and commands.
- Order steps logically — reads before writes, tests after changes.
- Keep it under 20 steps. If the task needs more, break into phases.
- Do NOT include tool call syntax. Just describe what to do in plain language.`;

const RUN_SYSTEM_PROMPT = `You are in autonomous execution mode. You will work continuously until the task is complete.

Rules:
- Execute tools freely without waiting for user input.
- If a command fails, read the error, fix the issue, and retry.
- Do NOT stop to ask for clarification — make reasonable decisions and continue.
- Do NOT create git branches — work directly on the current branch. No checkout, no branch creation.
- When you believe you are done, verify your work: confirm files exist, tests pass, and requirements are met.
- Only when you have verified completion with evidence, output exactly: <!-- GOAL_COMPLETE -->
- Do NOT output <!-- GOAL_COMPLETE --> until you have real evidence of success.
- "Having spent effort" is not the same as "being done." Only verified results count.

You will receive a state summary showing what has been accomplished so far. Use it to avoid repeating work.`;

export interface RunResult {
  success: boolean;
  turns: number;
  terminationReason: "complete" | "budget" | "interrupted";
}

interface RunState {
  filesModified: string[];
  filesCreated: string[];
  commandsRun: string[];
  errors: string[];
  progress: string[];
}

function compileStateMessage(instruction: string, state: RunState, turn: number): string {
  if (turn === 0) return instruction;

  const parts = [`## Original Task\n${instruction}\n`];
  parts.push(`## Progress (Turn ${turn})`);

  if (state.filesModified.length) {
    parts.push(`Files modified: ${[...new Set(state.filesModified)].join(", ")}`);
  }
  if (state.filesCreated.length) {
    parts.push(`Files created: ${[...new Set(state.filesCreated)].join(", ")}`);
  }
  if (state.commandsRun.length) {
    const recent = state.commandsRun.slice(-5);
    parts.push(`Recent commands: ${recent.join("; ")}`);
  }
  if (state.progress.length) {
    const recent = state.progress.slice(-5);
    parts.push(`Notes:\n${recent.map(p => `- ${p}`).join("\n")}`);
  }
  if (state.errors.length) {
    const recent = state.errors.slice(-3);
    parts.push(`Recent errors:\n${recent.map(e => `- ${e}`).join("\n")}`);
  }

  parts.push("\nContinue working toward completion. Do NOT repeat completed work.");
  return parts.join("\n");
}

/**
 * Autonomous Execution Loop (Ralph Loop)..
 *
 * Each turn gets a fresh context window with:
 * - The original instruction
 * - A compact state summary of what's been done
 * - No accumulated tool history (avoids context rot)
 *
 * Terminates when:
 * - The model outputs <!-- GOAL_COMPLETE --> (verified completion)
 * - Turn budget exceeded
 * - User interrupts (ctrl+c)
 */
export async function ralphLoop(
  instruction: string,
  client: BaseChatModel,
  bus: EventBus,
  onChunk: OnChunk,
  signal?: { interrupted: boolean },
  maxTurns = DEFAULT_MAX_RUN_TURNS,
  workspaceRoot?: string,
  config?: import("../config/loader.js").VoidRiftConfig,
  tier?: string,
): Promise<RunResult> {
  let turns = 0;
  let turnsWithoutToolCalls = 0;
  const MAX_TURNS_WITHOUT_TOOLS = 2;
  const state: RunState = {
    filesModified: [],
    filesCreated: [],
    commandsRun: [],
    errors: [],
    progress: [],
  };

  // Create a scoped plan manager for this run — isolates from user plans
  const { PlanManager } = await import("../session/plan.js");
  const { FileSystemPlanRepository } = await import("../session/plan-repository.js");
  const { mkdirSync, rmSync } = await import("fs");
  const { join } = await import("path");
  const runId = `run-${Date.now().toString(36)}`;
  const runPlanDir = workspaceRoot ? join(workspaceRoot, ".voidrift", "cache", runId, "plan") : undefined;
  let scopedPlanManager: any = undefined;
  if (runPlanDir) {
    mkdirSync(runPlanDir, { recursive: true });
    scopedPlanManager = new PlanManager(new FileSystemPlanRepository(join(workspaceRoot!, ".voidrift", "cache", runId)));
  }

  // Ephemeral branch — run works on a temp branch, merges to original on success
  const { execSync } = await import("child_process");
  let originalBranch: string | null = null;
  const runBranch = `voidrift-run-${runId}`;
  if (workspaceRoot) {
    try {
      originalBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      execSync(`git checkout -b ${runBranch}`, { cwd: workspaceRoot, stdio: "ignore" });
    } catch {
      originalBranch = null; // not a git repo or checkout failed — skip branching
    }
  }

  // Subscribe to tool events to track state
  const unsubs: Array<() => void> = [];
  unsubs.push(bus.subscribe("AFTER_TOOL_EXECUTE", (event) => {
    const { toolName, arguments: args, status, output } = event.payload;
    if (toolName === "write_file" && (args as any).path) {
      state.filesCreated.push((args as any).path);
    } else if (toolName === "edit_file" && (args as any).path) {
      state.filesModified.push((args as any).path);
    } else if (toolName === "execute_command" && (args as any).command) {
      state.commandsRun.push((args as any).command.slice(0, 80));
    }
    if (status === "error" && output) {
      state.errors.push(`${toolName}: ${output.slice(0, 100)}`);
    }
  }));

  while (turns < DEFAULT_MAX_RUN_TURNS) {
    if (signal?.interrupted) break;

    // Create per-turn abort controller — aborted if signal.interrupted is set externally
    const turnAbort = new AbortController();
    let interruptCheck: ReturnType<typeof setInterval> | null = null;
    if (signal) {
      interruptCheck = setInterval(() => { if (signal.interrupted) turnAbort.abort(); }, 500);
    }

    const userMessage = compileStateMessage(instruction, state, turns);

    const input: OrchestrationInput = {
      userMessage,
      client,
      systemPrompt: RUN_SYSTEM_PROMPT,
      history: [], // Fresh context each turn — Ralph Loop
      onChunk,
      signal: turnAbort.signal,
      planManager: scopedPlanManager,
      config,
      tier: tier as any,
      workspaceRoot,
    };

    onChunk({ type: "status", message: `Run turn ${turns + 1}...` });
    const result = await directChat(input, bus);
    if (interruptCheck) clearInterval(interruptCheck);
    turns++;

    // Extract progress notes from the model's response
    if (result.response.text) {
      const text = result.response.text;
      // Check for completion
      if (text.includes(COMPLETION_TOKEN)) {
        unsubs.forEach(u => u());
        if (runPlanDir) {
          try { rmSync(join(workspaceRoot!, ".voidrift", "cache", runId), { recursive: true, force: true }); } catch {}
        }
        // Merge run branch back to original on success
        if (originalBranch && workspaceRoot) {
          try {
            execSync(`git checkout ${originalBranch}`, { cwd: workspaceRoot, stdio: "ignore" });
            execSync(`git merge ${runBranch} --no-edit`, { cwd: workspaceRoot, stdio: "ignore" });
            execSync(`git branch -D ${runBranch}`, { cwd: workspaceRoot, stdio: "ignore" });
          } catch {}
        }
        return { success: true, turns, terminationReason: "complete" };
      }
      // Save a one-line progress note from the response
      const firstLine = text.split("\n").find(l => l.trim().length > 10)?.trim().slice(0, 120);
      if (firstLine) state.progress.push(firstLine);
    }
  }

  unsubs.forEach(u => u());

  // Clean up run-scoped artifacts
  if (runPlanDir) {
    try { rmSync(join(workspaceRoot!, ".voidrift", "cache", runId), { recursive: true, force: true }); } catch {}
  }

  // Abandon run branch on failure — restore original, delete temp branch
  if (originalBranch && workspaceRoot) {
    try {
      execSync(`git checkout ${originalBranch}`, { cwd: workspaceRoot, stdio: "ignore" });
      execSync(`git branch -D ${runBranch}`, { cwd: workspaceRoot, stdio: "ignore" });
    } catch {}
  }

  if (signal?.interrupted) {
    return { success: false, turns, terminationReason: "interrupted" };
  }
  return { success: false, turns, terminationReason: "budget" };
}

/**
 * Two-Phase Run: Dense plans, Flash executes.
 *
 * Phase 1: Dense model analyzes the instruction and produces a structured plan.
 * Phase 2: Flash model executes the plan via the Ralph Loop.
 *
 * This gives complex tasks the benefit of frontier reasoning for planning
 * while keeping execution fast and cheap on flash.
 */
export async function ralphLoopWithPlanning(
  instruction: string,
  denseClient: BaseChatModel,
  flashClient: BaseChatModel,
  bus: EventBus,
  onChunk: OnChunk,
  signal?: { interrupted: boolean }
): Promise<RunResult> {
  // Phase 1: Dense planning
  onChunk({ type: "status", message: "Planning (dense model)..." });

  const planResponse = await streamModel(denseClient, [
    new SystemMessage(PLANNING_SYSTEM_PROMPT),
    new HumanMessage(instruction),
  ], onChunk, signal ? new AbortController().signal : undefined);

  if (!planResponse.text.trim()) {
    onChunk({ type: "error", message: "Dense model returned no plan.", retryable: false });
    return { success: false, turns: 0, terminationReason: "budget" };
  }

  const plan = planResponse.text;

  // Persist plan as a first-class plan item (survives interruption)
  const planName = `run-${Date.now().toString(36)}`;
  const { mkdirSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const planDir = join(process.cwd(), ".voidrift", "plan");
  mkdirSync(planDir, { recursive: true });
  const planFile = `---\npriority: now\ndescription: ${instruction.slice(0, 80)}\nrationale: Auto-generated by /run\n---\n\n${plan}\n`;
  writeFileSync(join(planDir, `${planName}.md`), planFile, "utf-8");
  bus.publish("PLAN_ITEM_ADDED", { name: planName, priority: "now", description: instruction.slice(0, 80) } as any);

  onChunk({ type: "status", message: `Plan saved: ${planName}. Executing (flash model)...` });

  // Phase 2: Flash execution via Ralph Loop with plan as context
  const planPrefixedInstruction = `## Plan (from architect model)\n${plan}\n\n## Original Request\n${instruction}\n\nFollow the plan above. Execute each step in order. Verify at the end.`;

  const result = await ralphLoop(planPrefixedInstruction, flashClient, bus, onChunk, signal);

  // Update plan on completion — move to "complete" with summary
  if (result.success) {
    const completedFile = `---\npriority: complete\ndescription: ${instruction.slice(0, 80)}\nrationale: Auto-generated by /run\n---\n\n${plan}\n\n## Completed\n- Turns: ${result.turns}\n- Status: ${result.terminationReason}\n`;
    writeFileSync(join(planDir, `${planName}.md`), completedFile, "utf-8");
    bus.publish("PLAN_ITEM_UPDATED", { name: planName, field: "priority", oldValue: "now", newValue: "complete" } as any);
  }

  return result;
}
