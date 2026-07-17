/**
 * Symbol Extractor Registry.
 *
 * Uniform interface for extracting structural symbols from any file type.
 * Base extractors (regex) handle all files. Plugins register deeper parsers
 * for specific extensions (e.g., AST-based TypeScript parsing).
 *
 * Output is cached by file hash — extractors only run on change.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedSymbol {
  name: string;
  kind: string;       // "function" | "class" | "interface" | "type" | "const" | "heading" | "key" | "export"
  line: number;
  signature?: string; // optional richer info from AST plugins
  children?: ExtractedSymbol[];
}

export interface ExtractionResult {
  symbols: ExtractedSymbol[];
  lines: number;
}

export interface SymbolExtractor {
  /** File extensions this extractor handles (e.g., [".ts", ".tsx"]) */
  extensions: string[];
  /** Extract symbols from file content */
  extract(path: string, content: string): ExtractionResult;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CachedExtraction {
  sha256: string;
  extractedBy: string;
  symbols: ExtractedSymbol[];
  lines: number;
  lastIndexed: number;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class ExtractorRegistry {
  private extractors = new Map<string, { extractor: SymbolExtractor; name: string }>();
  private cache = new Map<string, CachedExtraction>();
  private cachePath: string;
  private dirty = false;

  constructor(private workspaceRoot: string) {
    this.cachePath = join(workspaceRoot, ".voidrift", "symbol_cache.json");
    this.loadCache();
  }

  /** Register an extractor. Later registrations override earlier ones for the same extension. */
  register(extractor: SymbolExtractor, name: string): void {
    for (const ext of extractor.extensions) {
      const existing = this.extractors.get(ext);
      // If upgrading from base to plugin, invalidate cached entries for this extension
      if (existing && existing.name !== name) {
        this.invalidateByExtractor(ext, existing.name);
      }
      this.extractors.set(ext, { extractor, name });
    }
  }

  /** Extract symbols for a file. Uses cache if hash matches. */
  extract(path: string, content: string): ExtractionResult {
    const ext = extname(path).toLowerCase();
    const entry = this.extractors.get(ext);
    if (!entry) {
      // No extractor for this extension — return line count only
      const lines = content.split("\n").length;
      return { symbols: [], lines };
    }

    const sha256 = createHash("sha256").update(content).digest("hex");
    const cached = this.cache.get(path);
    if (cached && cached.sha256 === sha256 && cached.extractedBy === entry.name) {
      return { symbols: cached.symbols, lines: cached.lines };
    }

    // Cache miss or stale — run extractor
    const result = entry.extractor.extract(path, content);

    // Update cache
    this.cache.set(path, {
      sha256,
      extractedBy: entry.name,
      symbols: result.symbols,
      lines: result.lines,
      lastIndexed: Date.now(),
    });
    this.dirty = true;

    return result;
  }

  /** Invalidate a specific file's cache entry. */
  invalidate(path: string): void {
    if (this.cache.has(path)) {
      this.cache.delete(path);
      this.dirty = true;
    }
  }

  /** Invalidate all entries for a given extension that were extracted by a specific extractor. */
  private invalidateByExtractor(ext: string, extractorName: string): void {
    for (const [path, entry] of this.cache) {
      if (extname(path).toLowerCase() === ext && entry.extractedBy === extractorName) {
        this.cache.delete(path);
      }
    }
    this.dirty = true;
  }

  /** Flush cache to disk. Call periodically or on shutdown. */
  flush(): void {
    if (!this.dirty) return;
    const dir = join(this.workspaceRoot, ".voidrift");
    mkdirSync(dir, { recursive: true });
    const obj: Record<string, CachedExtraction> = {};
    for (const [k, v] of this.cache) obj[k] = v;
    writeFileSync(this.cachePath, JSON.stringify(obj), "utf-8");
    this.dirty = false;
  }

  /** Get cached symbols without re-extracting. Returns null on cache miss. */
  getCached(path: string): ExtractionResult | null {
    const cached = this.cache.get(path);
    if (!cached) return null;
    return { symbols: cached.symbols, lines: cached.lines };
  }

  /** Check if a file's cache is stale (hash mismatch). */
  isStale(path: string, content: string): boolean {
    const cached = this.cache.get(path);
    if (!cached) return true;
    const sha256 = createHash("sha256").update(content).digest("hex");
    return cached.sha256 !== sha256;
  }

  private loadCache(): void {
    if (!existsSync(this.cachePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      for (const [k, v] of Object.entries(raw)) {
        this.cache.set(k, v as CachedExtraction);
      }
    } catch {
      // Corrupted cache — start fresh
      this.cache.clear();
    }
  }
}

// ─── Base Extractors ─────────────────────────────────────────────────────────

/** Regex-based extractor for code files (TS, JS, Python, Rust, Go). */
export const codeExtractor: SymbolExtractor = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".rs", ".go"],
  extract(path, content) {
    const lines = content.split("\n");
    const symbols: ExtractedSymbol[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // export function/class/interface/type/const
      const exportMatch = trimmed.match(
        /^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|enum)\s+(\w+)/
      );
      if (exportMatch) {
        symbols.push({ name: exportMatch[2], kind: exportMatch[1], line: i + 1 });
        continue;
      }

      // export default
      if (trimmed.match(/^export\s+default\s+\w/)) {
        symbols.push({ name: "default", kind: "export", line: i + 1 });
        continue;
      }

      // Top-level (no indentation) class/function
      if (line[0] && line[0] !== " " && line[0] !== "\t") {
        const topLevel = trimmed.match(
          /^(?:async\s+)?(function|class|interface|type|enum)\s+(\w+)/
        );
        if (topLevel) {
          symbols.push({ name: topLevel[2], kind: topLevel[1], line: i + 1 });
        }
      }
    }

    return { symbols, lines: lines.length };
  },
};

/** Markdown heading extractor. */
export const markdownExtractor: SymbolExtractor = {
  extensions: [".md", ".mdx"],
  extract(path, content) {
    const lines = content.split("\n");
    const symbols: ExtractedSymbol[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,3})\s+(.+)/);
      if (match) {
        const title = match[2].trim();
        if (title.length > 0 && title.length < 100) {
          symbols.push({ name: title, kind: `h${match[1].length}`, line: i + 1 });
        }
      }
    }

    return { symbols, lines: lines.length };
  },
};

/** Data file key extractor (JSON, YAML, TOML). */
export const dataExtractor: SymbolExtractor = {
  extensions: [".json", ".yaml", ".yml", ".toml"],
  extract(path, content) {
    const lines = content.split("\n");
    const symbols: ExtractedSymbol[] = [];
    const ext = extname(path).toLowerCase();

    if (ext === ".json") {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          Object.keys(parsed).slice(0, 15).forEach((key, i) => {
            symbols.push({ name: key, kind: "key", line: i + 1 });
          });
        }
      } catch {}
    } else {
      // YAML/TOML: non-indented keys
      for (let i = 0; i < lines.length && symbols.length < 15; i++) {
        const match = lines[i].match(/^([a-zA-Z_][\w-]*):/);
        if (match) {
          symbols.push({ name: match[1], kind: "key", line: i + 1 });
        }
      }
    }

    return { symbols, lines: lines.length };
  },
};

/** Register all base extractors on a registry instance. */
export function registerBaseExtractors(registry: ExtractorRegistry): void {
  registry.register(codeExtractor, "regex-base");
  registry.register(markdownExtractor, "regex-base");
  registry.register(dataExtractor, "regex-base");
}
