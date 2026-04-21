/**
 * Verify command: requirements-driven acceptance testing (REQ-VF-3..16).
 */

// OCP contract (REQ-TOOL-8, REQ-ARCH-9)
export const AGENT_TOOLS_PLAN = new Set(["file"]);
export const AGENT_TOOLS_EXECUTE = new Set(["file", "http", "shell", "browser", "process"]);
export const AGENT_TOOLS_DOC = new Set(["file"]);
export const AGENT_TOOL_ACTIONS_PLAN: Record<string, string[]> = { file: ["read", "list"] };
export const AGENT_TOOL_ACTIONS_EXECUTE: Record<string, string[]> = { file: ["read", "write", "list"], http: ["get", "post", "put", "delete"] };
export const AGENT_TOOL_ACTIONS_DOC: Record<string, string[]> = { file: ["read", "write", "list"] };

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import { WriteContext } from "../tools/filesystem.js";
import { buildLocalTools } from "../tools/builder.js";
import { findSkill } from "../skills.js";
import { loadPrompt, buildSystemPrompt } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, checkRequirementsExist, printCommandHeader } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { startProcess, waitForReady, stopAll, readProcessOutput } from "../tools/process.js";
import { clearSessions } from "../tools/http.js";
import { closeAllSessions } from "../tools/browser.js";
import { trackAgentWithStats, elapsedStr } from "./progress.js";
import { resetSharedTracker, displayErrorSummary } from "../errors.js";

export async function runVerify(worker: ModelInterface, onProgress?: (msg: string) => void): Promise<number> {
  const emit = onProgress ?? ((msg: string) => process.stderr.write(msg + "\n"));
  checkDiskSpace();
  resetSharedTracker();
  const d = ensureVoidriftDir();
  if (!checkRequirementsExist()) {
    emit("Error: REQUIREMENTS.md not found. Run 'voidrift gather' first.");
    return 1;
  }

  const [log, runId] = bootRun("verify");
  if (!onProgress) printCommandHeader("verify", worker.config.alias, log);
  const startTime = Date.now();
  const ctx = new WriteContext({ projectDir: join(d, ".."), maxReadLines: worker.config.maxReadLines });
  const frameworkContext = loadPrompt("system", "CONTEXT");

  try {
    // Stage 0: Doc verification (REQ-VF-17)
    const bugsBefore = existsSync(join(d, "bugs")) ? new Set(readdirSync(join(d, "bugs")).filter(f => f.startsWith("DOC-"))) : new Set<string>();
    await _runDocVerify(frameworkContext, worker, d, log, ctx);
    const bugsAfter = existsSync(join(d, "bugs")) ? new Set(readdirSync(join(d, "bugs")).filter(f => f.startsWith("DOC-"))) : new Set<string>();
    const docBugCount = [...bugsAfter].filter(f => !bugsBefore.has(f)).length;

    // Stage 1: Plan agent
    const [planTools, planHandlers] = buildLocalTools("verify-plan", join(d, ".."), ctx);
    const skill = findSkill("QUALITY-QA") ?? "";
    const planPrompt = loadPrompt("verify", "PLAN");
    const planSystem = buildSystemPrompt(frameworkContext, skill, planPrompt);
    emit("▸ Stage 1: Planning test cases...");
    const planAgent = new AgentLoop({
      model: worker, systemPrompt: planSystem, tools: planTools, toolHandlers: planHandlers,
      stream: false, maxTokens: getMaxTokens(worker.config, "verify.plan"), logPath: log, showSpinner: false,
    });
    await trackAgentWithStats(planAgent, loadPrompt("verify", "PLAN-USER"), "  verify plan");

    const verifyPlanPath = join(d, "VERIFY-PLAN.md");
    if (!existsSync(verifyPlanPath)) {
      emit("Error: VERIFY-PLAN.md not produced.");
      return 1;
    }

    const items = parseVerifyPlan(readFileSync(verifyPlanPath, "utf-8"));
    const testable = items.filter(i => !i.skip);
    const skipped = items.filter(i => i.skip);

    // Bootstrap
    const bootstrap = readArchField(d, "test_bootstrap");
    if (bootstrap && bootstrap.toLowerCase() !== "none" && bootstrap !== "") {
      try { execSync(bootstrap, { timeout: 120_000, stdio: "pipe" }); } catch { /* */ }
    }

    // Start product
    const startup = readArchField(d, "startup_command");
    let processHandle: string | undefined;
    if (startup && startup.toLowerCase() !== "none" && startup !== "") {
      const result = startProcess(startup);
      try { processHandle = JSON.parse(result).handle_id; } catch { /* */ }
      if (processHandle) waitForReady(processHandle, "http", "http://localhost:8000/", 30);
    }

    // Stage 2: Concurrent sub-agents
    mkdirSync(join(d, "bugs"), { recursive: true });
    const results: Array<{ itemId: string; status: string; bugPath?: string }> = [];
    for (const item of skipped) results.push({ itemId: item.itemId, status: "skip" });

    emit(`▸ Stage 2: Executing ${testable.length} test cases...`);
    const [execTools, execHandlers] = buildLocalTools("verify-execute", join(d, ".."), ctx);
    const concurrency = worker.config.concurrency ?? 1;
    const taskFns = testable.map(item => async () => {
      const execPrompt = loadPrompt("verify", "EXECUTE");
      const execSystem = buildSystemPrompt(frameworkContext, skill, execPrompt);
      const agent = new AgentLoop({
        model: worker, systemPrompt: execSystem, tools: execTools, toolHandlers: execHandlers,
        stream: false, maxTokens: getMaxTokens(worker.config, "verify.execute"), logPath: log, showSpinner: false,
      });
      try {
        await trackAgentWithStats(agent, item.content, `  ${item.itemId}`);
        const bugPath = join(d, "bugs", `${item.itemId}.md`);
        return { itemId: item.itemId, status: existsSync(bugPath) ? "fail" : "pass", bugPath: existsSync(bugPath) ? bugPath : undefined };
      } catch {
        return { itemId: item.itemId, status: "fail" as const };
      }
    });

    // Run concurrently up to model's concurrency limit (REQ-VF-15)
    const execResults = await _runConcurrent(taskFns, concurrency);
    results.push(...execResults);

    // Stage 3: Report
    results.sort((a, b) => a.itemId.localeCompare(b.itemId));
    const passed = results.filter(r => r.status === "pass").length;
    const failed = results.filter(r => r.status === "fail").length;
    const skipCount = results.filter(r => r.status === "skip").length;
    const verdict = failed === 0 && docBugCount === 0 ? "PASS" : "FAIL";

    const report = [
      `# Verification Report`, ``, `Run: ${runId}`, `Verdict: **${verdict}**`, ``,
      `| Status | Count |`, `|---|---|`,
      `| Passed | ${passed} |`, `| Failed | ${failed} |`, `| Skipped | ${skipCount} |`,
      `| Doc mismatches | ${docBugCount} |`, ``,
      ...results.map(r => `- ${r.itemId}: ${r.status}${r.bugPath ? ` → [bug report](bugs/${r.itemId}.md)` : ""}`),
    ].join("\n");
    writeFileSync(join(d, "VERIFY.md"), report, "utf-8");

    appendState("verify", worker.config.alias,
      `Verdict: ${verdict} — ${passed} passed, ${failed} failed, ${skipCount} skipped`,
      [".voidrift/VERIFY.md"]);

    emit(`\n✓ Verify complete — ${verdict} (${passed} passed, ${failed} failed, ${skipCount} skipped) (${elapsedStr((Date.now() - startTime) / 1000)})`);
    displayErrorSummary(emit);
    return verdict === "PASS" ? 0 : 1;
  } finally {
    stopAll();
    clearSessions();
    closeAllSessions();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface VerifyItem { itemId: string; skip: boolean; content: string }

export function parseVerifyPlan(text: string): VerifyItem[] {
  const items: VerifyItem[] = [];
  const re = /^### (ITEM-\d+)(\s+\[SKIP\])?/gm;
  let match: RegExpExecArray | null;
  const positions: Array<{ itemId: string; skip: boolean; start: number }> = [];
  while ((match = re.exec(text)) !== null) {
    positions.push({ itemId: match[1], skip: !!match[2], start: match.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    items.push({ ...positions[i], content: text.slice(positions[i].start, end).trim() });
  }
  return items;
}

export function readArchField(dir: string, field: string): string | null {
  const archPath = join(dir, "ARCHITECTURE.md");
  if (!existsSync(archPath)) return null;
  const content = readFileSync(archPath, "utf-8");
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return null;
  try {
    const fm = parseYaml(content.slice(4, end));
    return fm?.[field] ? String(fm[field]) : null;
  } catch { return null; }
}

async function _runConcurrent<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  if (limit <= 1) { const r: T[] = []; for (const t of tasks) r.push(await t()); return r; }
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  const run = async () => { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => run()));
  return results;
}

async function _runDocVerify(frameworkContext: string, model: ModelInterface, d: string, log: string, ctx: WriteContext): Promise<void> {
  const [tools, handlers] = buildLocalTools("verify-doc", join(d, ".."), ctx);
  const prompt = loadPrompt("verify", "DOC-VERIFY");
  const system = buildSystemPrompt(frameworkContext, undefined, prompt);
  const agent = new AgentLoop({
    model, systemPrompt: system, tools, toolHandlers: handlers,
    stream: false, maxTokens: getMaxTokens(model.config, "verify.execute"), logPath: log, showSpinner: false,
  });
  try { await trackAgentWithStats(agent, loadPrompt("verify", "DOC-VERIFY-USER"), "  doc verification"); } catch { /* */ }
}

// ---------------------------------------------------------------------------
// VerifyCommand class
// ---------------------------------------------------------------------------

import { BaseCommand } from "./base.js";

export class VerifyCommand extends BaseCommand {
  readonly name = "verify";

  async preflight(): Promise<void> {
    await super.preflight();
    if (!checkRequirementsExist()) throw new Error("REQUIREMENTS.md not found. Run 'voidrift gather' first.");
  }

  async execute(): Promise<number> {
    return runVerify(this.model);
  }
}
