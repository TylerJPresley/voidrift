import { extname, basename } from "path";
import type { MemoryRepository } from "./memory-repository.js";

export type MemoryType = "directive" | "reference";

export interface MemoryMeta {
  id: string;
  title: string;
  summary: string;
  type: MemoryType;
  context: {
    extensions?: string[];
    files?: string[];
    keywords?: string[];
  };
  filePath: string;
}

export interface MemoryDiscoveryContext {
  focusedFiles: string[];
  userInput: string;
}

/**
 * Two-Layer Memory Registry.
 *
 * Maintains project-level (.voidrift/memory/) and global (~/.config/voidrift/memory/)
 * memory using Two-Stage Progressive Disclosure:
 *
 * Stage 1 (Discovered): On each turn, matches memory triggers against context.
 *   Returns lightweight metadata (id, title, summary) for the activeMemoryIndex.
 *   Consumes <100 tokens.
 *
 * Stage 2 (Disclosed): Model calls load_memory(id) to inject full-text body
 *   into activeMemory. Calls unload_memory(id) to purge it.
 */
export class MemoryRegistry {
  private entries: MemoryMeta[] = [];
  private bodies = new Map<string, string>();

  /**
   * Indexes all memory markdown files from the given directories.
   */
  private repo: MemoryRepository;

  constructor(repo: MemoryRepository) {
    this.repo = repo;
  }

  index(directories: string[]): void {
    this.entries = [];
    this.bodies.clear();

    const results = this.repo.scan(directories);
    for (const { meta, body } of results) {
      this.entries.push(meta);
      this.bodies.set(meta.id, body);
    }
  }

  /**
   * Stage 1: Discover relevant memories using TF-IDF relevance scoring (G-11).
   * Returns lightweight metadata ranked by relevance.
   * Combines TF-IDF text scoring with direct trigger matching (extensions, files, keywords).
   */
  rankRelevantMemories(ctx: MemoryDiscoveryContext): MemoryMeta[] {
    if (this.entries.length === 0) return [];

    const matched = new Set<string>();
    const results: Array<{ entry: MemoryMeta; score: number }> = [];

    // Direct trigger matching (extensions, files, keywords)
    for (const entry of this.entries) {
      if (this.matchesTriggers(entry, ctx)) {
        matched.add(entry.id);
        results.push({ entry, score: 10 }); // High base score for direct matches
      }
    }

    // TF-IDF scoring for text-based relevance
    const queryTerms = buildQuery(ctx);
    if (queryTerms.length) {
      for (const entry of this.entries) {
        if (matched.has(entry.id)) continue;
        const score = this.tfidfScore(entry, queryTerms, ctx);
        if (score > 0) results.push({ entry, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).map((r) => r.entry);
  }

  /**
   * Stage 2: Load full-text body of a memory by ID.
   * Returns null if ID not found.
   */
  loadBody(id: string): string | null {
    return this.bodies.get(id) ?? null;
  }

  get all(): MemoryMeta[] {
    return this.entries;
  }

  get directives(): MemoryMeta[] {
    return this.entries.filter(e => e.type === "directive");
  }

  /** Load all directive memory bodies for Orbit injection. */
  loadDirectiveBodies(): string[] {
    return this.directives
      .map(d => this.bodies.get(d.id))
      .filter((b): b is string => !!b);
  }

  private matchesTriggers(entry: MemoryMeta, ctx: MemoryDiscoveryContext): boolean {
    const { context: triggers } = entry;

    if (triggers.extensions?.length) {
      const focusedExts = ctx.focusedFiles.map((f) => extname(f).toLowerCase());
      if (triggers.extensions.some((ext) => focusedExts.includes(ext.toLowerCase()))) return true;
    }

    if (triggers.files?.length) {
      const focusedNames = ctx.focusedFiles.map((f) => basename(f));
      if (triggers.files.some((name) => focusedNames.includes(name))) return true;
    }

    if (triggers.keywords?.length) {
      const text = ctx.userInput.toLowerCase();
      if (triggers.keywords.some((kw) => text.includes(kw.toLowerCase()))) return true;
    }

    return false;
  }

  private tfidfScore(entry: MemoryMeta, queryTerms: string[], ctx: MemoryDiscoveryContext): number {
    const rawText = [entry.title, entry.summary, ...(entry.context.keywords ?? [])].join(" ").toLowerCase();
    const docTerms = rawText.split(/\s+/);
    const totalDocs = this.entries.length;
    let score = 0;

    for (const term of queryTerms) {
      const tf = docTerms.filter((t) => t === term).length / (docTerms.length || 1);
      const docsWithTerm = this.entries.filter((e) => {
        const text = [e.title, e.summary, ...(e.context.keywords ?? [])].join(" ").toLowerCase();
        return text.includes(term);
      }).length;
      const idf = Math.log(1 + totalDocs / (docsWithTerm || 1));

      let multiplier = 1;
      // Keyword exact match: 2.5x
      if (entry.context.keywords?.some((kw) => kw.toLowerCase() === term)) multiplier = 2.5;
      // Extension match: 3.0x
      const focusedExts = ctx.focusedFiles.map((f) => extname(f).toLowerCase());
      if (entry.context.extensions?.some((ext) => focusedExts.includes(ext.toLowerCase()))) multiplier = Math.max(multiplier, 3.0);
      // Filename match: 4.0x
      const focusedNames = ctx.focusedFiles.map((f) => basename(f));
      if (entry.context.files?.some((name) => focusedNames.includes(name))) multiplier = Math.max(multiplier, 4.0);

      score += tf * idf * multiplier;
    }

    return score;
  }
}

function buildQuery(ctx: MemoryDiscoveryContext): string[] {
  const terms: string[] = [];
  if (ctx.userInput) terms.push(...ctx.userInput.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  terms.push(...ctx.focusedFiles.map((f) => basename(f).toLowerCase()));
  terms.push(...ctx.focusedFiles.map((f) => extname(f).toLowerCase()).filter(Boolean));
  return [...new Set(terms)];
}

