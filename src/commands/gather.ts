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
import { loadPrompt, loadTemplate } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, printCommandHeader } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { buildLocalTools } from "../tools/builder.js";

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
  model: ModelInterface, log: string, analystRole: string, fileTree: string,
  budget?: TokenBudget, extra?: unknown,
): Promise<Record<string, string[]>> {
  const prompt = loadPrompt("gather", "TRIAGE");
  const system = [analystRole, prompt].filter(Boolean).join("\n\n");
  const agent = new AgentLoop({
    model, systemPrompt: system, tools: [], toolHandlers: {},
    stream: false, maxTokens: getMaxTokens(model.config, "gather.triage"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  const response = await agent.send(fileTree);
  return parseTriage(response);
}

export async function runFileAnalysis(
  model: ModelInterface, files: string[], fileCategory: Record<string, string>,
  fromPath: string, log: string, budget?: TokenBudget,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const voidriftDir = join(fromPath, "..", ".voidrift");
  const promptTemplate = loadPrompt("gather", "ANALYSIS");

  for (const fp of files) {
    const cat = fileCategory[fp] ?? "source";

    // Generated files: filename-only analysis (REQ-G-27)
    if (cat === "generated") continue; // handled separately

    const fullPath = join(fromPath, fp);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf-8");
    const hash = fileHash(content);
    const cached = loadCachedAnalysis(voidriftDir, fp, hash);
    if (cached) { results[fp] = cached; continue; }

    const prompt = promptTemplate.replace(/{category}/g, cat);
    const userTemplate = loadPrompt("gather", "ANALYSIS-USER");
    const userMsg = userTemplate.replace("{filepath}", fp).replace("{file_content}", content).replace(/{category}/g, cat);

    // Chunking for large files (REQ-G-13)
    const maxChars = model.config.maxInputChars;
    if (maxChars > 0 && content.length > maxChars) {
      const chunks = makeChunks(content, maxChars);
      const chunkAnalyses: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkAgent = new AgentLoop({
          model, systemPrompt: prompt, tools: [], toolHandlers: {},
          stream: false, maxTokens: getMaxTokens(model.config, "gather.analysis"),
          logPath: log, showSpinner: false, tokenBudget: budget,
        });
        chunkAnalyses.push(await chunkAgent.send(
          `Analyze this **${cat}** file (chunk ${i + 1}/${chunks.length}): \`${fp}\`\n\n\`\`\`\n${chunks[i]}\n\`\`\``
        ));
      }
      if (chunkAnalyses.length > 1) {
        const consolAgent = new AgentLoop({
          model, systemPrompt: "Merge these partial analyses into a single unified analysis.", tools: [], toolHandlers: {},
          stream: false, maxTokens: getMaxTokens(model.config, "gather.analysis"), logPath: log, showSpinner: false, tokenBudget: budget,
        });
        const merged = await consolAgent.send(chunkAnalyses.map((a, i) => `## Chunk ${i + 1}\n\n${a}`).join("\n\n"));
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
      stream: false, maxTokens: getMaxTokens(model.config, "gather.analysis"),
      logPath: log, showSpinner: false, tokenBudget: budget,
    });
    const analysis = await agent.send(userMsg);
    results[fp] = analysis;
    writeAnalysis(voidriftDir, fp, hash, analysis);
  }
  return results;
}

export async function runGeneratedAnalysis(
  model: ModelInterface, generatedFiles: string[], log: string, budget?: TokenBudget,
): Promise<string> {
  if (!generatedFiles.length) return "";
  const prompt = loadPrompt("gather", "ANALYSIS-GENERATED");
  const userTemplate = loadPrompt("gather", "GENERATED-USER");
  const userMsg = userTemplate.replace("{file_list}", generatedFiles.join("\n"));
  const agent = new AgentLoop({
    model, systemPrompt: prompt, tools: [], toolHandlers: {},
    stream: false, maxTokens: getMaxTokens(model.config, "gather.analysis"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  return agent.send(userMsg);
}

export async function runConsolidation(
  model: ModelInterface, allAnalyses: Record<string, string>,
  generatedAnalysis: string, existingReqs: string | null,
  log: string, budget?: TokenBudget,
): Promise<string> {
  const template = loadTemplate("REQUIREMENTS-TEMPLATE");
  const prompt = loadPrompt("gather", "CONSOLIDATION");
  const system = [prompt, template ? `\n\nREQUIREMENTS TEMPLATE:\n\n${template}` : ""].join("");

  const allReqs = Object.entries(allAnalyses).map(([fp, r]) => `### ${fp}\n\n${r}`).join("\n\n");
  let userMsg = `## File Analyses\n\n${allReqs}`;
  if (generatedAnalysis) userMsg += `\n\n## Generated Files Context\n\n${generatedAnalysis}`;
  if (existingReqs) userMsg += `\n\n## Existing Requirements (merge, do not replace)\n\n${existingReqs}`;

  const agent = new AgentLoop({
    model, systemPrompt: system, tools: [], toolHandlers: {},
    stream: false, maxTokens: getMaxTokens(model.config, "gather.consolidation"),
    logPath: log, showSpinner: false, tokenBudget: budget,
  });
  return agent.send(userMsg);
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
  onProgress?: (msg: string) => void,
): Promise<number> {
  const emit = onProgress ?? ((msg: string) => process.stderr.write(msg + "\n"));
  checkDiskSpace();
  const d = ensureVoidriftDir();
  const target = join(d, "REQUIREMENTS.md");
  const source = fromPath ?? process.cwd();

  if (!statSync(source).isDirectory()) {
    emit(`Error: ${source} is not a directory`);
    return 1;
  }

  const existingReqs = existsSync(target) && !overwrite ? readFileSync(target, "utf-8") : null;
  const [log, runId] = bootRun("gather");
  const analystRole = findSkill("ANALYSIS-REQS") ?? "";
  const startTime = Date.now();
  if (!onProgress) printCommandHeader("gather", model.config.alias, log, { Path: source });

  // Stage 1: Triage
  let fileTree: string;
  try { fileTree = buildFileTree(source); } catch (e) {
    emit(`Error: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  let categories: Record<string, string[]>;
  try {
    emit("▸ Stage 1: Triaging files...");
    categories = await runTriage(model, log, analystRole, fileTree, tokenBudget);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("context length") || msg.includes("tokens exceed")) {
      emit("Error: Context length exceeded during triage. Use a model with a larger context window.");
      return 1;
    }
    throw e;
  }

  const fileCategory: Record<string, string> = {};
  for (const [cat, files] of Object.entries(categories)) {
    for (const f of files) fileCategory[f] = cat;
  }
  // Triage display (REQ-G-23)
  for (const cat of CATEGORIES) {
    const files = categories[cat];
    if (!files?.length) continue;
    if (onProgress) {
      emit(`\n  ${cat}\n${files.map(f => `    ${f}`).join("\n")}`);
    } else {
      process.stderr.write(`  \x1b[2m${cat}\x1b[0m\n`);
      for (const f of files) process.stderr.write(`    ${f}\n`);
    }
  }

  // Uncategorized check (REQ-G-22, REQ-G-24)
  const allInput = new Set(fileTree.split("\n"));
  const uncategorized = [...allInput].filter(f => !(f in fileCategory)).sort();
  if (uncategorized.length) {
    if (!onProgress) {
      process.stderr.write(`  \x1b[2muncategorized\x1b[0m\n`);
      for (const f of uncategorized) process.stderr.write(`    ${f}\n`);
    }
    emit(`⚠ ${uncategorized.length} file(s) not categorized by triage.`);
    if (promptFn) {
      assignUncategorized(uncategorized, categories, fileCategory, promptFn);
    }
  }

  // Stage 2: File Analysis (REQ-G-25, REQ-G-26, REQ-G-27)
  const allFiles = Object.keys(fileCategory).filter(f => fileCategory[f] !== "generated");
  const generatedFiles = categories.generated ?? [];
  emit(`\n▸ Stage 2: Analyzing ${allFiles.length} files...`);
  let allAnalyses: Record<string, string>;
  let generatedAnalysis = "";
  try {
    allAnalyses = await runFileAnalysis(model, allFiles, fileCategory, source, log, tokenBudget);
    if (generatedFiles.length) {
      generatedAnalysis = await runGeneratedAnalysis(model, generatedFiles, log, tokenBudget);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("context length") || msg.includes("tokens exceed")) {
      emit("Error: Context length exceeded during file analysis. Use a model with a larger context window.");
      return 1;
    }
    throw e;
  }

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
  emit("\n▸ Stage 3: Consolidating requirements...");
  const finalResponse = await runConsolidation(model, allAnalyses, generatedAnalysis, existingReqs, log, tokenBudget);
  writeFileSync(target, stripPreamble(finalResponse), "utf-8");

  appendState("gather", model.config.alias,
    `Analyzed ${Object.keys(allAnalyses).length} files. Wrote REQUIREMENTS.md.`,
    [".voidrift/REQUIREMENTS.md"]);

  // Elapsed time (REQ-G-21)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  emit(`\n✓ Requirements written to .voidrift/REQUIREMENTS.md (${elapsed}s)`);

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
