/**
 * Plan command: six-stage architecture and task breakdown (REQ-P-1).
 */

// OCP contract (REQ-TOOL-8, REQ-ARCH-9)
export const AGENT_TOOLS = new Set(["file"]);
export const AGENT_TOOL_ACTIONS: Record<string, string[]> = { file: ["read", "write", "edit", "list"] };

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import { findSkill, availableSkillsWithDesc } from "../skills.js";
import { loadPrompt, loadTemplate, buildSystemPrompt } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, checkRequirementsExist, undoCommand, printCommandHeader } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { buildLocalTools } from "../tools/builder.js";
import { trackAgentWithStats, formatAgentProgress, elapsedStr } from "./progress.js";
import type { AgentProgress } from "./progress.js";
import { resetSharedTracker, displayErrorSummary } from "../errors.js";

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------

export async function dispatchAgent(opts: {
  model: ModelInterface; tools: unknown[]; handlers: Record<string, unknown>;
  log: string; systemPrompt: string; userMessage: string; retryMessage?: string;
  checkFn: () => boolean; stageLabel: string; stageKey: string; quiet?: boolean;
  onProgress?: (p: AgentProgress) => void;
}): Promise<boolean> {
  const agent = new AgentLoop({
    model: opts.model, systemPrompt: opts.systemPrompt,
    tools: opts.tools as never[], toolHandlers: opts.handlers as Record<string, never>,
    stream: false, maxTokens: getMaxTokens(opts.model.config, opts.stageKey),
    logPath: opts.log, showSpinner: false,
  });
  try {
    const { result: response } = await trackAgentWithStats(agent, opts.userMessage, opts.stageLabel, opts.onProgress);
    try { appendLog(opts.log, response); } catch { /* */ }
  } catch { return false; }

  if (opts.checkFn()) return true;
  if (!opts.retryMessage) return false;

  // Retry once
  try {
    await trackAgentWithStats(agent, opts.retryMessage, `${opts.stageLabel} (retry)`, opts.onProgress);
  } catch { return false; }
  return opts.checkFn();
}

export function extractModules(archText: string, dir: string): string[] {
  // Try YAML frontmatter
  if (archText.startsWith("---\n")) {
    const end = archText.indexOf("\n---\n", 4);
    if (end !== -1) {
      try {
        const fm = parseYaml(archText.slice(4, end));
        if (fm?.modules && Array.isArray(fm.modules)) return fm.modules;
      } catch { /* */ }
    }
  }
  // Fallback: look for arch/*.md references
  const archDir = join(dir, "arch");
  if (existsSync(archDir)) {
    return readdirSync(archDir).filter(f => f.endsWith(".md")).map(f => f.replace(".md", "")).sort();
  }
  return [];
}

export function archSummary(archText: string, maxChars = 4000): string {
  return archText.length <= maxChars ? archText : archText.slice(0, maxChars) + "\n\n[truncated]";
}

export function parseOutlineTasks(outlinePath: string): [string, Array<{ id: number; title: string; files: string[]; depends: number[] }>] {
  if (!existsSync(outlinePath)) return ["", []];
  const content = readFileSync(outlinePath, "utf-8");
  let module = "";
  const tasks: Array<{ id: number; title: string; files: string[]; depends: number[] }> = [];

  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) {
      try {
        const fm = parseYaml(content.slice(4, end));
        module = fm?.module ?? "";
        if (fm?.tasks && Array.isArray(fm.tasks)) {
          for (const t of fm.tasks) {
            tasks.push({
              id: Number(t.id ?? 0),
              title: String(t.title ?? ""),
              files: Array.isArray(t.files) ? t.files.map(String) : [],
              depends: Array.isArray(t.depends) ? t.depends.map(Number) : [],
            });
          }
        }
      } catch { /* */ }
    }
  }
  return [module, tasks];
}

export function formatTaskEntry(outlinePath: string, taskId: number): string {
  const [, tasks] = parseOutlineTasks(outlinePath);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return `Task ${taskId} not found in outline.`;
  return `Task ${task.id}: ${task.title}\nFiles: ${task.files.join(", ")}\nDepends: ${task.depends.join(", ") || "none"}`;
}

export function checkReqCoverage(dir: string, requirements: string): void {
  const reqIds = new Set(requirements.match(/REQ-[A-Z]+-\d+/g) ?? []);
  const taskDir = join(dir, "tasks", "active");
  if (!existsSync(taskDir)) return;
  const coveredIds = new Set<string>();
  for (const f of readdirSync(taskDir).filter(f => f.startsWith("TASK-"))) {
    const content = readFileSync(join(taskDir, f), "utf-8");
    for (const id of content.match(/REQ-[A-Z]+-\d+/g) ?? []) coveredIds.add(id);
  }
  const uncovered = [...reqIds].filter(id => !coveredIds.has(id));
  if (uncovered.length) {
    process.stderr.write(`⚠ ${uncovered.length} requirement(s) not covered by tasks: ${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? "..." : ""}\n`);
  }
}

export function resolveSkill(taskSkills: string[], validSkills: Record<string, string>): string[] {
  const validNames = Object.keys(validSkills);
  return taskSkills.map(skill => {
    if (validNames.includes(skill)) return skill;
    // Word-overlap resolution (REQ-P-9)
    const words = skill.split("-").map(w => w.toLowerCase());
    let best = "";
    let bestOverlap = 0;
    for (const valid of validNames) {
      const vWords = valid.split("-").map(w => w.toLowerCase());
      const overlap = words.filter(w => vWords.includes(w)).length;
      if (overlap > bestOverlap) { best = valid; bestOverlap = overlap; }
    }
    return bestOverlap > 0 ? best : "";
  }).filter(Boolean);
}

export function buildTaskFiles(dir: string, requirements: string, archText: string, ideaId?: number): number {
  const activeDir = join(dir, "tasks", "active");
  if (!existsSync(activeDir)) return 0;
  const taskFiles = readdirSync(activeDir).filter(f => f.startsWith("TASK-") && f.endsWith(".md"));

  // Build manifest
  const tasks: Record<string, unknown> = {};
  for (const f of taskFiles) {
    const content = readFileSync(join(activeDir, f), "utf-8");
    const idMatch = f.match(/TASK-(\d+)/);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    let module = "", depends: number[] = [], skills: string[] = [], reqs: string[] = [];
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) {
        try {
          const fm = parseYaml(content.slice(4, end));
          module = fm?.module ?? "";
          depends = Array.isArray(fm?.depends) ? fm.depends.map(Number) : [];
          skills = Array.isArray(fm?.skills) ? fm.skills.map(String) : [];
          reqs = Array.isArray(fm?.reqs) ? fm.reqs.map(String) : [];
        } catch { /* */ }
      }
    }
    tasks[String(id)] = { status: "planned", module, depends, skills, reqs };
    if (ideaId) (tasks[String(id)] as Record<string, unknown>).idea = ideaId;
  }

  const manifest = { next_id: taskFiles.length + 1, next_bug_id: 1, tasks };
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "tasks", "manifest.yml"), stringifyYaml(manifest), "utf-8");
  return taskFiles.length;
}

// Vague-AC detector: lines with no quoted strings, numbers, backtick code, or identifiers with dots/parens
const SPECIFIC_VALUE = /`[^`]+`|"[^"]+"|'[^']+'|\b\d+\b|\w+\.\w+|\w+\(|:\s*\w+/;

export function validateTaskACs(dir: string): number {
  const activeDir = join(dir, "tasks", "active");
  if (!existsSync(activeDir)) return 0;
  let warnings = 0;
  for (const f of readdirSync(activeDir).filter(f => f.startsWith("TASK-") && f.endsWith(".md"))) {
    const content = readFileSync(join(activeDir, f), "utf-8");
    const taskId = f.match(/TASK-(\d+)/)?.[1] ?? f;

    // Extract files from frontmatter
    let taskFiles: string[] = [];
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) {
        try {
          const fm = parseYaml(content.slice(4, end));
          taskFiles = (Array.isArray(fm?.files) ? fm.files : []).map((f: string) => f.replace(/\s*\(.*\)$/, ""));
        } catch { /* */ }
      }
    }

    // Extract AC section
    const acMatch = content.match(/## Acceptance Criteria\n([\s\S]*?)(?=\n## |\n---|\Z)/);
    if (!acMatch) continue;
    const acLines = acMatch[1].split("\n").filter(l => l.trim().startsWith("- "));

    for (const ac of acLines) {
      // Scope check: file paths in AC not in task files
      const pathRefs = ac.match(/[\w/.-]+\.\w{1,5}/g) ?? [];
      for (const ref of pathRefs) {
        if (ref.includes("/") && !taskFiles.some(tf => tf.includes(ref))) {
          process.stderr.write(`⚠ TASK-${taskId}: AC references file outside task scope: ${ref}\n`);
          warnings++;
        }
      }
      // Specificity check
      if (!SPECIFIC_VALUE.test(ac)) {
        process.stderr.write(`⚠ TASK-${taskId}: AC may be vague (no specific values): ${ac.trim().slice(2)}\n`);
        warnings++;
      }
    }
  }
  return warnings;
}

const REQUIRED_SECTIONS = ["## User Story", "## Acceptance Criteria", "## Context"];
const SHELL_PATTERN = /^\s*(\$\s|```(?:bash|sh)|sh -c|npm run |make |pip install )/m;

export function validateTaskSelfContainment(dir: string): number {
  const activeDir = join(dir, "tasks", "active");
  if (!existsSync(activeDir)) return 0;
  let warnings = 0;
  for (const f of readdirSync(activeDir).filter(f => f.startsWith("TASK-") && f.endsWith(".md"))) {
    const content = readFileSync(join(activeDir, f), "utf-8");
    const taskId = f.match(/TASK-(\d+)/)?.[1] ?? f;

    // Required sections (REQ-P-5 AC1/AC2)
    for (const section of REQUIRED_SECTIONS) {
      if (!content.includes(section)) {
        process.stderr.write(`⚠ TASK-${taskId}: missing required section: ${section}\n`);
        warnings++;
      }
    }

    // No shell commands in task body (REQ-P-5 AC3)
    const body = content.startsWith("---\n") ? content.slice(content.indexOf("\n---\n", 4) + 5) : content;
    if (SHELL_PATTERN.test(body)) {
      process.stderr.write(`⚠ TASK-${taskId}: task body contains shell commands\n`);
      warnings++;
    }

    // No .voidrift/ paths in files frontmatter (REQ-P-5 AC4)
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) {
        try {
          const fm = parseYaml(content.slice(4, end));
          for (const fp of (Array.isArray(fm?.files) ? fm.files : [])) {
            if (String(fp).replace(/\s*\(.*\)$/, "").startsWith(".voidrift/")) {
              process.stderr.write(`⚠ TASK-${taskId}: targets .voidrift/ path: ${fp}\n`);
              warnings++;
            }
          }
        } catch { /* */ }
      }
    }
  }
  return warnings;
}

function sourceFileListing(projectDir: string): string {
  const lines: string[] = [];
  const walk = (d: string) => {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else lines.push(full.replace(projectDir + "/", ""));
      }
    } catch { /* */ }
  };
  walk(projectDir);
  return lines.sort().join("\n");
}

function appendLog(log: string, content: string): void {
  const { appendFileSync } = require("node:fs");
  try { appendFileSync(log, content + "\n"); } catch { /* */ }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runPlan(model: ModelInterface, overwrite = false, ideaId?: number, onProgress?: (msg: string) => void): Promise<number> {
  const emit = onProgress ?? ((msg: string) => process.stderr.write(msg + "\n"));
  checkDiskSpace();
  resetSharedTracker();
  const d = ensureVoidriftDir();

  if (!checkRequirementsExist()) {
    emit("Error: REQUIREMENTS.md not found. Run 'voidrift gather' first.");
    return 1;
  }

  if (overwrite) {
    undoCommand("plan");
    for (const t of ["ARCHITECTURE.md", "README.md"]) {
      const p = join(d, t);
      if (existsSync(p)) unlinkSync(p);
    }
    for (const sub of ["arch", "tasks"]) {
      const p = join(d, sub);
      if (existsSync(p)) rmSync(p, { recursive: true });
    }
  }

  const [log, runId] = bootRun("plan");
  if (!onProgress) printCommandHeader("plan", model.config.alias, log);
  const [tools, handlers] = buildLocalTools("plan");
  const requirements = readFileSync(join(d, "REQUIREMENTS.md"), "utf-8");
  const skill = findSkill("ARCH-DESIGN") ?? "";
  const frameworkContext = loadPrompt("system", "CONTEXT");
  const startTime = Date.now();
  const emitProgress = (p: AgentProgress) => emit(formatAgentProgress(p));

  // Idea context injection (REQ-IDEA-5)
  let ideaContext = "";
  if (ideaId != null) {
    const ideaContent = existsSync(join(d, "ideas", `IDEA-${ideaId}.md`))
      ? readFileSync(join(d, "ideas", `IDEA-${ideaId}.md`), "utf-8") : null;
    if (!ideaContent) { emit(`Error: IDEA-${ideaId} not found.`); return 1; }
    // Gate on missing reqs field
    if (!ideaContent.includes("reqs:")) {
      emit(`Error: No requirements found for IDEA-${ideaId}. Run 'voidrift gather <model> --idea ${ideaId}' first.`);
      return 1;
    }
    ideaContext = `\n\n## Idea Context (IDEA-${ideaId})\n\n${ideaContent}`;
  }

  // Delta analysis for update mode (REQ-P-11)
  let deltaContext = "";
  const isUpdate = !overwrite && existsSync(join(d, "ARCHITECTURE.md")) && existsSync(join(d, "tasks", "manifest.yml"));
  if (isUpdate) {
    emit("▸ Update mode — running delta analysis...");
    try {
      const projectDir = join(d, "..");
      const { readdirSync: rd, statSync: ss } = require("node:fs");
      const walk = (dir: string, prefix = ""): string[] => {
        const results: string[] = [];
        for (const e of rd(dir, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) results.push(...walk(join(dir, e.name), rel));
          else results.push(rel);
        }
        return results;
      };
      const sourceFiles = walk(projectDir).filter(f => !f.startsWith(".voidrift/") && !f.includes("node_modules")).slice(0, 200);
      const deltaPrompt = loadPrompt("plan", "PLAN-DELTA") ?? "Analyze which requirements are satisfied by existing files and which need implementation.";
      const deltaAgent = new AgentLoop({
        model, systemPrompt: buildSystemPrompt(frameworkContext, undefined, deltaPrompt), tools: [], toolHandlers: {},
        stream: false, maxTokens: getMaxTokens(model.config, "plan.delta"), logPath: log, showSpinner: false,
      });
      const existingArch = readFileSync(join(d, "ARCHITECTURE.md"), "utf-8");
      const { result: deltaResult } = await trackAgentWithStats(deltaAgent,
        `REQUIREMENTS:\n${requirements}\n\nARCHITECTURE:\n${existingArch}\n\nSOURCE FILES:\n${sourceFiles.join("\n")}`,
        "▸ Delta analysis", emitProgress);
      deltaContext = deltaResult;
    } catch { /* delta analysis is best-effort */ }
  }

  // Stage 1: Architecture
  const archTemplate = loadTemplate("ARCHITECTURE-TEMPLATE");
  let archPrompt = loadPrompt("plan", "PLAN-ARCH")
    .replace("{requirements}", requirements)
    .replace("{arch_template}", archTemplate);
  if (deltaContext) archPrompt += `\n\n## Delta Analysis\n\n${deltaContext}`;
  if (ideaContext) archPrompt += ideaContext;
  const archSystem = buildSystemPrompt(frameworkContext, skill, archPrompt);

  emit("▸ Stage 1: Architecture");
  const ok1 = await dispatchAgent({
    model, tools, handlers, log, systemPrompt: archSystem,
    userMessage: loadPrompt("plan", "ARCH-USER"),
    retryMessage: loadPrompt("plan", "ARCH-RETRY"),
    checkFn: () => existsSync(join(d, "ARCHITECTURE.md")),
    stageLabel: "  architecture", stageKey: "plan.architecture",
    onProgress: emitProgress,
  });
  if (!ok1) { emit("Error: Stage 1 failed."); return 1; }

  const archText = readFileSync(join(d, "ARCHITECTURE.md"), "utf-8");
  const modules = extractModules(archText, d);
  if (!modules.length) { emit("Error: No modules found."); return 1; }

  // Stage 2: Module arch
  emit(`▸ Stage 2: Module architecture (${modules.length} modules)`);
  const aSummary = archSummary(archText);
  for (const mod of modules) {
    const modPrompt = loadPrompt("plan", "PLAN-MODULE").replace("{module}", mod).replace("{architecture}", aSummary);
    const modSystem = buildSystemPrompt(frameworkContext, skill, modPrompt);
    const ok = await dispatchAgent({
      model, tools, handlers, log, systemPrompt: modSystem,
      userMessage: loadPrompt("plan", "MODULE-USER").replace("{module}", mod),
      retryMessage: loadPrompt("plan", "MODULE-RETRY").replace("{module}", mod),
      checkFn: () => existsSync(join(d, "arch", `${mod}.md`)),
      stageLabel: `  ${mod}`, stageKey: "plan.module-arch",
      onProgress: emitProgress,
    });
    if (!ok) return 1;
  }

  // Stage 3: Task outlines
  emit(`▸ Stage 3: Task outlines (${modules.length} modules)`);
  mkdirSync(join(d, "tasks", "outline"), { recursive: true });
  let idOffset = 1;
  for (const mod of modules) {
    const modArch = readFileSync(join(d, "arch", `${mod}.md`), "utf-8");
    const outlinePrompt = loadPrompt("plan", "PLAN-OUTLINE")
      .replace(/{module}/g, mod).replace("{id_offset}", String(idOffset))
      .replace("{architecture}", archText).replace("{module_arch}", modArch);
    const outlineSystem = buildSystemPrompt(frameworkContext, skill, outlinePrompt);
    const outlinePath = join(d, "tasks", "outline", `${mod}.md`);
    const ok = await dispatchAgent({
      model, tools, handlers, log, systemPrompt: outlineSystem,
      userMessage: loadPrompt("plan", "OUTLINE-USER").replace("{module}", mod),
      retryMessage: loadPrompt("plan", "OUTLINE-RETRY").replace("{module}", mod),
      checkFn: () => existsSync(outlinePath),
      stageLabel: `  ${mod}`, stageKey: "plan.outline",
      onProgress: emitProgress,
    });
    if (!ok) return 1;
    const [, tasksInMod] = parseOutlineTasks(outlinePath);
    idOffset += Math.max(tasksInMod.length, 1);
  }

  // Stage 4: Dependency resolution (multi-module only)
  if (modules.length > 1) {
    emit("▸ Stage 4: Dependency resolution");
    const outlines = modules.map(m => `### ${m}\n\n${readFileSync(join(d, "tasks", "outline", `${m}.md`), "utf-8")}`).join("\n\n");
    const depsPrompt = loadPrompt("plan", "PLAN-DEPS").replace("{outlines}", outlines);
    await dispatchAgent({
      model, tools, handlers, log, systemPrompt: buildSystemPrompt(frameworkContext, undefined, depsPrompt),
      userMessage: loadPrompt("plan", "DEPS-USER"),
      retryMessage: loadPrompt("plan", "DEPS-RETRY"),
      checkFn: () => existsSync(join(d, "tasks", "outline", "deps.yml")),
      stageLabel: "  dependencies", stageKey: "plan.deps",
      onProgress: emitProgress,
    });
  }

  // Stage 5: Task files
  const skillsDesc = availableSkillsWithDesc();
  const validSkillsStr = Object.entries(skillsDesc).sort().map(([n, d]) => `- ${n}: ${d}`).join("\n");
  const allTasks: Array<[string, { id: number; title: string }]> = [];
  for (const mod of modules) {
    const [, tasks] = parseOutlineTasks(join(d, "tasks", "outline", `${mod}.md`));
    for (const t of tasks) allTasks.push([mod, t]);
  }

  mkdirSync(join(d, "tasks", "active"), { recursive: true });
  emit(`▸ Stage 5: Task files (${allTasks.length} tasks)`);
  for (let i = 0; i < allTasks.length; i++) {
    const [mod, task] = allTasks[i];
    const taskId = task.id || i + 1;
    const modArch = readFileSync(join(d, "arch", `${mod}.md`), "utf-8");
    const taskOutline = formatTaskEntry(join(d, "tasks", "outline", `${mod}.md`), taskId);
    const taskPrompt = loadPrompt("plan", "PLAN-TASK")
      .replace("{task_id}", String(taskId)).replace(/{module}/g, mod)
      .replace("{valid_skills}", validSkillsStr)
      .replace("{task_outline}", taskOutline).replace("{module_arch}", modArch);
    await dispatchAgent({
      model, tools, handlers, log, systemPrompt: buildSystemPrompt(frameworkContext, undefined, taskPrompt),
      userMessage: loadPrompt("plan", "TASK-USER").replace("{task_id}", String(taskId)),
      retryMessage: loadPrompt("plan", "TASK-RETRY").replace("{task_id}", String(taskId)),
      checkFn: () => existsSync(join(d, "tasks", "active", `TASK-${taskId}.md`)),
      stageLabel: `  TASK-${taskId}`, stageKey: "plan.task",
      onProgress: emitProgress,
    });
  }

  // Post-processing
  const taskCount = buildTaskFiles(d, requirements, archText, ideaId);
  checkReqCoverage(d, requirements);
  validateTaskACs(d);
  validateTaskSelfContainment(d);

  // Stage 6: README
  emit("▸ Stage 6: README");
  const readmeTemplate = loadTemplate("README-TEMPLATE");
  const readmePrompt = loadPrompt("plan", "PLAN-README")
    .replace("{readme_template}", readmeTemplate)
    .replace("{requirements}", requirements).replace("{architecture}", archText);
  await dispatchAgent({
    model, tools, handlers, log, systemPrompt: buildSystemPrompt(frameworkContext, undefined, readmePrompt),
    userMessage: loadPrompt("plan", "README-USER"),
    retryMessage: loadPrompt("plan", "README-RETRY"),
    checkFn: () => existsSync(join(d, "README.md")),
    stageLabel: "  README", stageKey: "plan.readme",
    onProgress: emitProgress,
  });

  // Cleanup outlines
  const outlineDir = join(d, "tasks", "outline");
  if (existsSync(outlineDir)) rmSync(outlineDir, { recursive: true });

  appendState("plan", model.config.alias, `Wrote ARCHITECTURE.md, ${taskCount} tasks, manifest.yml.`,
    [".voidrift/ARCHITECTURE.md", ".voidrift/tasks/manifest.yml"]);

  emit(`\n✓ Plan complete — ARCHITECTURE.md, ${taskCount} tasks, manifest.yml (${elapsedStr((Date.now() - startTime) / 1000)})`);
  displayErrorSummary(emit);
  return 0;
}

// ---------------------------------------------------------------------------
// PlanCommand class
// ---------------------------------------------------------------------------

import { BaseCommand } from "./base.js";

export interface PlanOptions {
  overwrite?: boolean;
  ideaId?: number;
}

export class PlanCommand extends BaseCommand {
  readonly name = "plan";
  private opts: PlanOptions;

  constructor(model: ModelInterface, opts: PlanOptions = {}) {
    super(model);
    this.opts = opts;
  }

  async preflight(): Promise<void> {
    await super.preflight();
    if (!checkRequirementsExist()) throw new Error("REQUIREMENTS.md not found. Run 'voidrift gather' first.");
  }

  async execute(): Promise<number> {
    return runPlan(this.model, this.opts.overwrite, this.opts.ideaId);
  }
}
