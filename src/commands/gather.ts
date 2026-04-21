/**
 * Gather command: reverse-engineer requirements from a codebase (REQ-G-1, REQ-G-8).
 */

// OCP contract (REQ-TOOL-8, REQ-ARCH-9)
export const AGENT_TOOLS = new Set(["file", "analyze"]);
export const AGENT_TOOL_ACTIONS: Record<string, string[]> = { file: ["read", "list"] };

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import type { TokenBudget } from "../agent/budget.js";
import { findSkill } from "../skills.js";
import { loadPrompt, loadTemplate, buildSystemPrompt } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, printCommandHeader } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { buildLocalTools } from "../tools/builder.js";
import { trackAgent, trackAgentWithStats, formatAgentProgress, bold, italic } from "./progress.js";
import type { AgentProgress } from "./progress.js";
import type { StatusOutput, StatusLine, StatusBlock } from "./status-line.js";
import { createCLIStatus } from "./status-line.js";
import { resetSharedTracker, displayErrorSummary } from "../errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CATEGORIES = ["source", "tests", "config", "infrastructure", "documentation", "assets", "generated"] as const;
export const NON_SOURCE = ["tests", "config", "infrastructure", "documentation", "assets", "generated"] as const;

// ---------------------------------------------------------------------------
// File tree (REQ-G-8 stage 1 input)
// ---------------------------------------------------------------------------

export function buildFileTree(dir: string, maxFiles = 500): string {
  const lines: string[] = [];
  let gitignorePatterns: string[] = [];
  const giPath = join(dir, ".gitignore");
  if (existsSync(giPath)) {
    gitignorePatterns = readFileSync(giPath, "utf-8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  }

  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(d, entry.name);
      const rel = relative(dir, full);
      if (entry.isDirectory()) {
        if (!gitignorePatterns.some(p => rel === p || rel.startsWith(p + "/"))) walk(full);
      } else if (entry.isFile()) {
        if (!gitignorePatterns.some(p => matchGitignore(rel, p))) lines.push(rel);
      }
    }
  };
  walk(dir);

  if (lines.length > maxFiles) {
    throw new Error(`Source tree has ${lines.length} files (limit ${maxFiles}). Point gather at a smaller subdirectory.`);
  }
  return lines.sort().join("\n");
}

function matchGitignore(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) return path.startsWith(pattern) || path.startsWith(pattern.slice(0, -1));
  if (pattern.includes("*")) {
    const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    return re.test(path);
  }
  return path === pattern || path.startsWith(pattern + "/");
}

// ---------------------------------------------------------------------------
// Triage JSON parsing (REQ-G-20)
// ---------------------------------------------------------------------------

export function parseTriage(raw: string): Record<string, string[]> {
  // Strip control chars, extract JSON
  let cleaned = raw.replace(/[\x00-\x1f]/g, " ");
  // Try direct parse
  try { return JSON.parse(cleaned); } catch { /* */ }
  // Try regex extraction — match from first { to last } or end of string
  const start = cleaned.indexOf("{");
  if (start !== -1) {
    let json = cleaned.slice(start);
    // Remove trailing comma before closing
    json = json.replace(/,\s*$/, "");
    // Repair truncated JSON — close unmatched brackets
    const opens = (json.match(/\[/g) || []).length;
    const closes = (json.match(/\]/g) || []).length;
    const braces = (json.match(/\{/g) || []).length;
    const closeBraces = (json.match(/\}/g) || []).length;
    for (let i = 0; i < opens - closes; i++) json += "]";
    for (let i = 0; i < braces - closeBraces; i++) json += "}";
    try { return JSON.parse(json); } catch { /* */ }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Uncategorized assignment (REQ-G-24)
// ---------------------------------------------------------------------------

export function assignUncategorized(
  files: string[],
  categories: Record<string, string[]>,
  fileCategory: Record<string, string>,
  promptFn: (filename: string, catList: string[]) => string,
): void {
  const catList = [...CATEGORIES];
  for (const fp of files) {
    const choice = promptFn(fp, catList);
    if (choice === "skip-all") break;
    if (choice === "skip") continue;
    if (catList.includes(choice)) {
      if (!categories[choice]) categories[choice] = [];
      categories[choice].push(fp);
      fileCategory[fp] = choice;
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking (REQ-G-13)
// ---------------------------------------------------------------------------

export function makeChunks(text: string, chunkSize: number, overlap = 200): string[] {
  if (chunkSize <= 0 || text.length <= chunkSize) return [text];
  const effectiveOverlap = Math.min(overlap, chunkSize - 1);
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - effectiveOverlap;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Analysis cache (REQ-CTX-5)
// ---------------------------------------------------------------------------

export function analysisPath(voidriftDir: string, filepath: string): string {
  return join(voidriftDir, "analysis", filepath + ".md");
}

export function loadCachedAnalysis(voidriftDir: string, filepath: string, currentHash: string): string | null {
  const p = analysisPath(voidriftDir, filepath);
  if (!existsSync(p)) return null;
  const content = readFileSync(p, "utf-8");
  const hashMatch = content.match(/^hash:\s*(\S+)/m);
  if (hashMatch && hashMatch[1] === currentHash) return content;
  return null;
}

export function writeAnalysis(voidriftDir: string, filepath: string, hash: string, analysis: string): void {
  const p = analysisPath(voidriftDir, filepath);
  mkdirSync(join(p, ".."), { recursive: true });
  const frontmatter = `---\nfile: ${filepath}\nhash: ${hash}\ntimestamp: ${new Date().toISOString()}\n---\n\n`;
  writeFileSync(p, frontmatter + analysis, "utf-8");
}

export function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Context block builder (REQ-G-17)
// ---------------------------------------------------------------------------

export function buildContextBlock(summaries: Record<string, string>): string {
  if (!Object.keys(summaries).length) return "";
  const parts = Object.entries(summaries).map(([cat, s]) => `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n${s.trim()}`);
  return "## Project Context\n\n" + parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Preamble stripping
// ---------------------------------------------------------------------------

export function stripPreamble(response: string): string {
  const match = response.match(/^#\s+/m);
  return match ? response.slice(match.index!) : response;
}

// ---------------------------------------------------------------------------
// Pipeline stage functions (REQ-G-8)
// ---------------------------------------------------------------------------

export async function runTriage(
  frameworkContext: string,
  model: ModelInterface, log: string, analystRole: string, fileTree: string,
  budget?: TokenBudget, onUpdate?: (p: AgentProgress) => void,
): Promise<Record<string, string[]>> {
  const prompt = loadPrompt("gather", "TRIAGE");
  const system = buildSystemPrompt(frameworkContext, analystRole, prompt);
  const agent = new AgentLoop({
    model, systemPrompt: system, tools: [], toolHandlers: {},
    stream: true, maxTokens: getMaxTokens(model.config, "gather.triage"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  const { result } = await trackAgentWithStats(agent, fileTree, "▸ Stage 1: Triaging files...", onUpdate);
  return parseTriage(result);
}

export async function runFileAnalysis(
  frameworkContext: string,
  model: ModelInterface, files: string[], fileCategory: Record<string, string>,
  fromPath: string, voidriftDir: string, log: string, budget?: TokenBudget,
  fileLines?: Record<string, StatusLine>,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const promptTemplate = loadPrompt("gather", "ANALYSIS");

  for (const fp of files) {
    const cat = fileCategory[fp] ?? "source";
    if (cat === "generated") continue;
    const line = fileLines?.[fp];

    const fullPath = join(fromPath, fp);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf-8");
    const hash = fileHash(content);
    const cached = loadCachedAnalysis(voidriftDir, fp, hash);
    if (cached) {
      results[fp] = cached;
      line?.update(formatAgentProgress({ label: fp, elapsed: 0, tokensIn: 0, tokensOut: 0, status: "cached" }));
      continue;
    }

    const prompt = buildSystemPrompt(frameworkContext, undefined, promptTemplate.replace(/{category}/g, cat));
    const userTemplate = loadPrompt("gather", "ANALYSIS-USER");
    const userMsg = userTemplate.replace("{filepath}", fp).replace("{file_content}", content).replace(/{category}/g, cat);

    const onUpdate = line ? (p: AgentProgress) => line.update(formatAgentProgress(p)) : undefined;

    // Chunking for large files (REQ-G-13)
    const maxChars = model.config.maxInputChars;
    if (maxChars > 0 && content.length > maxChars) {
      const chunks = makeChunks(content, maxChars);
      const chunkAnalyses: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkAgent = new AgentLoop({
          model, systemPrompt: prompt, tools: [], toolHandlers: {},
          stream: true, maxTokens: getMaxTokens(model.config, "gather.analysis"),
          logPath: log, showSpinner: false, tokenBudget: budget,
        });
        const { result: chunkResult } = await trackAgentWithStats(chunkAgent,
          `Analyze this **${cat}** file (chunk ${i + 1}/${chunks.length}): \`${fp}\`\n\n\`\`\`\n${chunks[i]}\n\`\`\``,
          `${fp} (chunk ${i + 1}/${chunks.length})`, onUpdate);
        chunkAnalyses.push(chunkResult);
      }
      if (chunkAnalyses.length > 1) {
        const consolAgent = new AgentLoop({
          model, systemPrompt: buildSystemPrompt(frameworkContext, undefined, loadPrompt("gather", "CHUNK-MERGE")), tools: [], toolHandlers: {},
          stream: true, maxTokens: getMaxTokens(model.config, "gather.analysis"), logPath: log, showSpinner: false, tokenBudget: budget,
        });
        const { result: merged } = await trackAgentWithStats(consolAgent,
          chunkAnalyses.map((a, i) => `## Chunk ${i + 1}\n\n${a}`).join("\n\n"), `${fp} (merge)`, onUpdate);
        results[fp] = merged;
        writeAnalysis(voidriftDir, fp, hash, merged);
      } else {
        results[fp] = chunkAnalyses[0];
        writeAnalysis(voidriftDir, fp, hash, chunkAnalyses[0]);
      }
      continue;
    }

    const agent = new AgentLoop({
      model, systemPrompt: prompt, tools: [], toolHandlers: {},
      stream: true, maxTokens: getMaxTokens(model.config, "gather.analysis"),
      logPath: log, showSpinner: false, tokenBudget: budget,
    });
    const { result: analysis } = await trackAgentWithStats(agent, userMsg, fp, onUpdate);
    results[fp] = analysis;
    writeAnalysis(voidriftDir, fp, hash, analysis);
  }
  return results;
}

export async function runGeneratedAnalysis(
  frameworkContext: string,
  model: ModelInterface, generatedFiles: string[], log: string, budget?: TokenBudget,
): Promise<string> {
  if (!generatedFiles.length) return "";
  const prompt = buildSystemPrompt(frameworkContext, undefined, loadPrompt("gather", "ANALYSIS-GENERATED"));
  const userTemplate = loadPrompt("gather", "GENERATED-USER");
  const userMsg = userTemplate.replace("{file_list}", generatedFiles.join("\n"));
  const agent = new AgentLoop({
    model, systemPrompt: prompt, tools: [], toolHandlers: {},
    stream: true, maxTokens: getMaxTokens(model.config, "gather.analysis"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  const { result } = await trackAgentWithStats(agent, userMsg, "generated files");
  return result;
}

export async function runConsolidation(
  frameworkContext: string,
  model: ModelInterface, allAnalyses: Record<string, string>,
  generatedAnalysis: string, existingReqs: string | null,
  log: string, budget?: TokenBudget, onUpdate?: (p: AgentProgress) => void,
): Promise<string> {
  const template = loadTemplate("REQUIREMENTS-TEMPLATE");
  const prompt = loadPrompt("gather", "CONSOLIDATION");
  const templateCtx = template ? `REQUIREMENTS TEMPLATE:\n\n${template}` : undefined;
  const system = buildSystemPrompt(frameworkContext, undefined, prompt, templateCtx);

  const allReqs = Object.entries(allAnalyses).map(([fp, r]) => `### ${fp}\n\n${r}`).join("\n\n");
  let userMsg = `## File Analyses\n\n${allReqs}`;
  if (generatedAnalysis) userMsg += `\n\n## Generated Files Context\n\n${generatedAnalysis}`;
  if (existingReqs) userMsg += `\n\n## Existing Requirements (merge, do not replace)\n\n${existingReqs}`;

  const agent = new AgentLoop({
    model, systemPrompt: system, tools: [], toolHandlers: {},
    stream: true, maxTokens: getMaxTokens(model.config, "gather.consolidation"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  const { result } = await trackAgentWithStats(agent, userMsg, "▸ Stage 3: Consolidating requirements...", onUpdate);
  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runGather(
  model: ModelInterface,
  fromPath?: string,
  ideaId?: number,
  overwrite = false,
  tokenBudget?: TokenBudget,
  promptFn?: (filename: string, catList: string[]) => string,
  statusOutput?: StatusOutput,
): Promise<number> {
  const status = statusOutput ?? createCLIStatus();
  checkDiskSpace();
  resetSharedTracker();  const d = ensureVoidriftDir();
  const projectDir = join(d, "..");
  const target = join(d, "REQUIREMENTS.md");
  const [log, runId] = bootRun("gather");
  const frameworkContext = loadPrompt("system", "CONTEXT");

  // --idea mode: generate/update requirements from idea file (REQ-G-1)
  if (ideaId !== undefined && ideaId !== null) {
    const { readIdea, writeIdea } = await import("./idea.js");
    const ideaContent = readIdea(projectDir, ideaId);
    if (!ideaContent) { status.append(`Error: IDEA-${ideaId} not found.`); return 1; }

    if (!statusOutput) printCommandHeader("gather", model.config.alias, log, { Idea: `IDEA-${ideaId}` });
    status.append(`Generating requirements from IDEA-${ideaId}...`);

    const existingReqs = existsSync(target) ? readFileSync(target, "utf-8") : null;
    const analystRole = findSkill("ANALYSIS-REQS") ?? "";
    const template = loadTemplate("REQUIREMENTS-TEMPLATE");
    const prompt = loadPrompt("gather", "CONSOLIDATION");
    const templateCtx = template ? `REQUIREMENTS TEMPLATE:\n\n${template}` : undefined;
    const system = buildSystemPrompt(frameworkContext, analystRole, prompt, templateCtx);

    let userMsg = `## Idea Content (IDEA-${ideaId})\n\n${ideaContent}`;
    if (existingReqs) userMsg += `\n\n## Existing Requirements (merge, do not replace)\n\n${existingReqs}`;

    const stage = status.addLine("▸ Consolidating...");
    const agent = new AgentLoop({
      model, systemPrompt: system, tools: [], toolHandlers: {},
      stream: true, maxTokens: getMaxTokens(model.config, "gather.consolidation"),
      logPath: log, showSpinner: false, tokenBudget: tokenBudget,
    });
    const { result } = await trackAgentWithStats(agent, userMsg, "consolidation",
      (p) => stage.update(formatAgentProgress(p)));
    const newReqs = stripPreamble(result);
    writeFileSync(target, newReqs, "utf-8");

    // Compute diff and extract affected REQ IDs, write back to idea file
    const reqIdPattern = /REQ-[A-Z]+-\d+/g;
    const oldIds = new Set(existingReqs?.match(reqIdPattern) ?? []);
    const newIds = new Set(newReqs.match(reqIdPattern) ?? []);
    const affected = [...newIds].filter(id => !oldIds.has(id) || existingReqs !== newReqs);
    const diffLines: string[] = [];
    if (!existingReqs) { diffLines.push("Created new REQUIREMENTS.md"); }
    else {
      const added = [...newIds].filter(id => !oldIds.has(id));
      const removed = [...oldIds].filter(id => !newIds.has(id));
      if (added.length) diffLines.push(`Added: ${added.join(", ")}`);
      if (removed.length) diffLines.push(`Removed: ${removed.join(", ")}`);
      if (!added.length && !removed.length) diffLines.push("Updated existing requirements");
    }

    const gatherSection = `\n\n---\n## Gather Results\n\nAffected REQ IDs: ${affected.length ? affected.join(", ") : "none"}\n\n${diffLines.join("\n")}\n`;
    writeIdea(projectDir, ideaId, ideaContent + gatherSection);

    appendState("gather", model.config.alias, `Generated requirements from IDEA-${ideaId}.`, [".voidrift/REQUIREMENTS.md"]);
    status.append(`✓ Requirements updated from IDEA-${ideaId}`);
    return 0;
  }

  // --import mode: reverse-engineer from codebase
  const source = fromPath ?? process.cwd();

  if (!statSync(source).isDirectory()) {
    status.append(`Error: ${source} is not a directory`);
    return 1;
  }

  const existingReqs = existsSync(target) && !overwrite ? readFileSync(target, "utf-8") : null;
  const analystRole = findSkill("ANALYSIS-REQS") ?? "";
  const startTime = Date.now();
  if (!statusOutput) printCommandHeader("gather", model.config.alias, log, { Path: source });

  // Stage 1: Triage
  let fileTree: string;
  try { fileTree = buildFileTree(source); } catch (e) {
    status.append(`Error: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  status.append(`Gathering from ${source}`);
  const stage1 = status.addLine("▸ Stage 1: Triaging files...");
  let categories: Record<string, string[]>;
  try {
    categories = await runTriage(frameworkContext, model, log, analystRole, fileTree, tokenBudget,
      (p) => stage1.update(formatAgentProgress(p)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("context length") || msg.includes("tokens exceed")) {
      status.append("Error: Context length exceeded during triage. Use a model with a larger context window.");
      return 1;
    }
    throw e;
  }

  const fileCategory: Record<string, string> = {};
  for (const [cat, files] of Object.entries(categories)) {
    for (const f of files) fileCategory[f] = cat;
  }

  // Uncategorized check (REQ-G-22, REQ-G-24)
  const allInput = new Set(fileTree.split("\n"));
  const uncategorized = [...allInput].filter(f => !(f in fileCategory)).sort();
  if (uncategorized.length) {
    status.append(`⚠ ${uncategorized.length} file(s) not categorized by triage.`);
    if (promptFn) {
      assignUncategorized(uncategorized, categories, fileCategory, promptFn);
    }
  }

  // Stage 2: File Analysis (REQ-G-25, REQ-G-26, REQ-G-27)
  const allFiles = Object.keys(fileCategory).filter(f => fileCategory[f] !== "generated");
  const generatedFiles = categories.generated ?? [];

  // Build categorized file listing as a single block
  const block = status.addBlock();
  block.addStatic(`▸ Stage 2: Analyzing ${allFiles.length} files...`);
  const fileLines: Record<string, StatusLine> = {};
  for (const cat of CATEGORIES) {
    const files = (categories[cat] ?? []).sort();
    if (!files.length) continue;
    block.addStatic(`  ${bold(cat)}`);
    for (const f of files) {
      const line = block.addLine(`    ${f} ${italic("queued")}`);
      fileLines[f] = { update: (text: string) => line.update(`    ${text}`) };
    }
  }
  if (uncategorized.length) {
    block.addStatic(`  ${bold("uncategorized")}`);
    for (const f of uncategorized) block.addStatic(`    ${f}`);
  }

  // Create Stage 3 line up front (shows queued while Stage 2 runs)
  const stage3 = block.addLine(`▸ Stage 3: Consolidating requirements... ${italic("queued")}`);

  let allAnalyses: Record<string, string>;
  let generatedAnalysis = "";
  // Pre-count cached files for stage summary (REQ-G-4)
  let cachedCount = 0;
  for (const fp of allFiles) {
    const fullPath = join(source, fp);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf-8");
    const hash = fileHash(content);
    if (loadCachedAnalysis(d, fp, hash)) cachedCount++;
  }
  try {
    allAnalyses = await runFileAnalysis(frameworkContext, model, allFiles, fileCategory, source, d, log, tokenBudget, fileLines);
    if (generatedFiles.length) {
      generatedAnalysis = await runGeneratedAnalysis(frameworkContext, model, generatedFiles, log, tokenBudget);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("context length") || msg.includes("tokens exceed")) {
      status.append("Error: Context length exceeded during file analysis. Use a model with a larger context window.");
      return 1;
    }
    throw e;
  }

  // Stage 2 summary: total, cached, fresh (REQ-G-4)
  const freshCount = allFiles.length - cachedCount;
  block.addStatic(`  ✓ ${allFiles.length} files (${freshCount} analyzed, ${cachedCount} cached)`);

  // Write analysis index
  const analysisDir = join(d, "analysis");
  mkdirSync(analysisDir, { recursive: true });
  const indexPath = join(d, "ANALYSIS.md");
  const indexLines = [`# Gather Analysis\n\nSource: \`${source}\`\n\n${Object.keys(allAnalyses).length} files analyzed.\n`];
  for (const cat of CATEGORIES) {
    const files = Object.keys(allAnalyses).filter(f => fileCategory[f] === cat).sort();
    if (!files.length) continue;
    indexLines.push(`\n## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`);
    for (const fp of files) indexLines.push(`- [${fp}](analysis/${fp}.md)`);
  }
  if (generatedFiles.length) {
    indexLines.push(`\n## Generated\n`);
    for (const fp of generatedFiles) indexLines.push(`- ${fp}`);
  }
  writeFileSync(indexPath, indexLines.join("\n"), "utf-8");

  // Stage 3: Consolidation (REQ-G-28)
  const finalResponse = await runConsolidation(frameworkContext, model, allAnalyses, generatedAnalysis, existingReqs, log, tokenBudget,
    (p) => stage3.update(formatAgentProgress(p)));
  writeFileSync(target, stripPreamble(finalResponse), "utf-8");

  appendState("gather", model.config.alias,
    `Analyzed ${Object.keys(allAnalyses).length} files. Wrote REQUIREMENTS.md.`,
    [".voidrift/REQUIREMENTS.md"]);

  // Elapsed time (REQ-G-21)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  status.append(`\n✓ Requirements written to .voidrift/REQUIREMENTS.md (${elapsed}s)`);
  displayErrorSummary((m) => status.append(m));

  return 0;
}

// ---------------------------------------------------------------------------
// GatherCommand class
// ---------------------------------------------------------------------------

import { BaseCommand } from "./base.js";

export interface GatherOptions {
  path?: string;
  ideaId?: number;
  overwrite?: boolean;
  tokenBudget?: TokenBudget;
  promptFn?: (filename: string, catList: string[]) => string;
}

export class GatherCommand extends BaseCommand {
  readonly name = "gather";
  private opts: GatherOptions;

  constructor(model: ModelInterface, opts: GatherOptions = {}) {
    super(model);
    this.opts = opts;
  }

  protected headerExtra(): Record<string, string> {
    return { Path: this.opts.path ?? process.cwd() };
  }

  async preflight(): Promise<void> {
    await super.preflight();
    const source = this.opts.path ?? process.cwd();
    if (!statSync(source).isDirectory()) {
      throw new Error(`${source} is not a directory`);
    }
  }

  async execute(): Promise<number> {
    return runGather(
      this.model,
      this.opts.path,
      this.opts.ideaId,
      this.opts.overwrite ?? false,
      this.opts.tokenBudget,
      this.opts.promptFn,
    );
  }
}
