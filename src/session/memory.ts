import { readdirSync, readFileSync, existsSync } from "fs";
import { join, extname, basename } from "path";

export interface MemoryMeta {
  id: string;
  title: string;
  summary: string;
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
  index(directories: string[]): void {
    this.entries = [];
    this.bodies.clear();

    for (const dir of directories) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const fullPath = join(dir, file);
        const parsed = parseMemoryFile(fullPath);
        if (parsed) {
          this.entries.push(parsed.meta);
          this.bodies.set(parsed.meta.id, parsed.body);
        }
      }
    }
  }

  /**
   * Stage 1: Discover relevant memories using TF-IDF relevance scoring (G-11).
   * Returns lightweight metadata ranked by relevance.
   * Combines TF-IDF text scoring with direct trigger matching (extensions, files, keywords).
   */
  discover(ctx: MemoryDiscoveryContext): MemoryMeta[] {
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
    const query = buildQuery(ctx);
    if (query.length) {
      for (const entry of this.entries) {
        if (matched.has(entry.id)) continue;
        const score = this.tfidfScore(entry, query, ctx);
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

function parseMemoryFile(filePath: string): { meta: MemoryMeta; body: string } | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const header = match[1];
    const body = match[2].trim();

    const id = extractField(header, "id");
    const title = extractField(header, "title");
    const summary = extractField(header, "summary");
    if (!id || !title || !summary) return null;

    const context: MemoryMeta["context"] = {};
    const extMatch = header.match(/extensions:\s*\[([^\]]*)\]/);
    if (extMatch) context.extensions = parseArray(extMatch[1]);
    const filesMatch = header.match(/files:\s*\[([^\]]*)\]/);
    if (filesMatch) context.files = parseArray(filesMatch[1]);
    const kwMatch = header.match(/keywords:\s*\[([^\]]*)\]/);
    if (kwMatch) context.keywords = parseArray(kwMatch[1]);

    return { meta: { id, title, summary, context, filePath }, body };
  } catch {
    return null;
  }
}

function extractField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function parseArray(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}
