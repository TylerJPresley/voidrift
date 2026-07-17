import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, extname } from "path";
import type { ExtractorRegistry } from "./extractors.js";

const IGNORED = new Set(["node_modules", ".git", ".voidrift", "dist", "build", ".next", "coverage"]);
const MAX_DEPTH = 5;
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".rs", ".go"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml"]);

// Module-level registry — set during bootstrap
let _extractorRegistry: ExtractorRegistry | null = null;

export function setExtractorRegistry(registry: ExtractorRegistry): void {
  _extractorRegistry = registry;
}
export interface CodeMapEntry {
  path: string;
  type: "file" | "dir";
  symbols?: string[];
  lines?: number;
}

/**
 * Workspace Code-Map Generator.
 *
 * Scans workspace files and extracts top-level symbols (exports, classes, functions)
 * to compile a compressed, token-efficient structure tree excluding function bodies.
 * Target: complete project awareness for under 1,000 tokens.
 */
export function generateCodeMap(workspaceRoot: string, maxDepth?: number): string {
  const entries = walk(workspaceRoot, workspaceRoot, 0, maxDepth ?? MAX_DEPTH);
  return formatTree(entries);
}

export function getCodeMapEntries(workspaceRoot: string): CodeMapEntry[] {
  return walk(workspaceRoot, workspaceRoot, 0);
}

function walk(dir: string, root: string, depth: number, maxDepth = MAX_DEPTH): CodeMapEntry[] {
  if (depth > maxDepth) return [];

  const entries: CodeMapEntry[] = [];
  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return entries;
  }

  for (const item of items.sort((a, b) => {
    const aPath = join(dir, a);
    const bPath = join(dir, b);
    const aIsDir = (() => { try { return statSync(aPath).isDirectory(); } catch { return false; } })();
    const bIsDir = (() => { try { return statSync(bPath).isDirectory(); } catch { return false; } })();
    if (aIsDir !== bIsDir) return aIsDir ? 1 : -1;
    return a.localeCompare(b);
  })) {
    if (IGNORED.has(item) || item.startsWith(".")) continue;

    const fullPath = join(dir, item);
    const relPath = relative(root, fullPath);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      entries.push({ path: relPath + "/", type: "dir" });
      entries.push(...walk(fullPath, root, depth + 1, maxDepth));
    } else {
      const ext = extname(item).toLowerCase();
      let symbols: string[] | undefined;
      let lines: number | undefined;

      if (_extractorRegistry) {
        // Use the registry — handles all file types uniformly
        try {
          const content = readFileSync(fullPath, "utf-8");
          const result = _extractorRegistry.extract(relPath, content);
          symbols = result.symbols.length > 0 ? result.symbols.map(s => `${s.kind} ${s.name}`) : undefined;
          lines = result.lines;
        } catch {
          lines = countLines(fullPath);
        }
      } else {
        // Fallback: inline extraction (no registry available)
        if (CODE_EXTENSIONS.has(ext)) {
          symbols = extractSymbols(fullPath);
        } else if (MARKDOWN_EXTENSIONS.has(ext)) {
          const result = extractMarkdownHeadings(fullPath);
          symbols = result.headings;
          lines = result.lines;
        } else if (DATA_EXTENSIONS.has(ext)) {
          const result = extractDataKeys(fullPath, ext);
          symbols = result.keys;
          lines = result.lines;
        } else {
          lines = countLines(fullPath);
        }
      }

      entries.push({ path: relPath, type: "file", symbols, lines });
    }
  }

  return entries;
}

/**
 * Extracts top-level symbols from a source file using regex-based pattern matching.
 * Captures: exported functions, classes, interfaces, types, constants, and default exports.
 * Does NOT parse function bodies — only signatures.
 */
function extractSymbols(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const symbols: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // export function/class/interface/type/const
      const exportMatch = trimmed.match(
        /^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|enum)\s+(\w+)/
      );
      if (exportMatch) {
        symbols.push(`${exportMatch[1]} ${exportMatch[2]}`);
        continue;
      }

      // export default (standalone)
      if (trimmed.match(/^export\s+default\s+\w/)) {
        symbols.push("default export");
        continue;
      }

      // Non-exported top-level class/function (no indentation)
      if (line[0] && line[0] !== " " && line[0] !== "\t") {
        const topLevel = trimmed.match(
          /^(?:async\s+)?(function|class|interface|type|enum)\s+(\w+)/
        );
        if (topLevel) {
          symbols.push(`${topLevel[1]} ${topLevel[2]}`);
        }
      }
    }

    return symbols.length > 0 ? symbols : [];
  } catch {
    return [];
  }
}

/**
 * Extracts headings from markdown files (## level and above).
 * Gives the model a table of contents for docs, specs, and prose.
 */
function extractMarkdownHeadings(filePath: string): { headings: string[]; lines: number } {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const headings: string[] = [];

    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+)/);
      if (match) {
        const depth = match[1].length;
        const title = match[2].trim();
        if (title.length > 0 && title.length < 100) {
          headings.push(`${"#".repeat(depth)} ${title}`);
        }
      }
    }

    return { headings: headings.length > 0 ? headings : [], lines: lines.length };
  } catch {
    return { headings: [], lines: 0 };
  }
}

/**
 * Extracts top-level keys from JSON/YAML files.
 * Gives the model awareness of config structure without loading values.
 */
function extractDataKeys(filePath: string, ext: string): { keys: string[]; lines: number } {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const keys: string[] = [];

    if (ext === ".json") {
      // Extract top-level keys from JSON
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        keys.push(...Object.keys(parsed).slice(0, 15));
      }
    } else {
      // YAML/TOML: extract non-indented keys
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z_][\w-]*):/);
        if (match) {
          keys.push(match[1]);
          if (keys.length >= 15) break;
        }
      }
    }

    return { keys: keys.length > 0 ? keys : [], lines: lines.length };
  } catch {
    return { keys: [], lines: 0 };
  }
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function formatTree(entries: CodeMapEntry[]): string {
  return entries
    .map((e) => {
      if (e.type === "dir") return `📁 ${e.path}`;
      const ext = extname(e.path).toLowerCase();
      const icon = MARKDOWN_EXTENSIONS.has(ext) ? "📝" : DATA_EXTENSIONS.has(ext) ? "⚙️" : "  ";
      const lineInfo = e.lines ? ` (${e.lines}L)` : "";
      const symbolStr = e.symbols?.length ? ` [${e.symbols.join(", ")}]` : "";
      return `${icon} ${e.path}${lineInfo}${symbolStr}`;
    })
    .join("\n");
}

/**
 * Generates a compact structural summary of a file for progressive disclosure.
 * For small files (<=50 lines), returns the full content.
 * For larger files, returns a regex-based structural extract as a fallback.
 * Prefer summarizeFileWithFlash() for semantic summaries.
 */
export function summarizeFile(path: string, content: string): { summary: string; totalLines: number } {
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= 500) {
    return { summary: content, totalLines };
  }

  // Fallback structural summary (used when Flash is unavailable)
  const symbols: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const exportMatch = trimmed.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|enum)\s+(\w+)/
    );
    if (exportMatch) {
      symbols.push(`  L${i + 1}: export ${exportMatch[1]} ${exportMatch[2]}`);
      continue;
    }

    if (line[0] && line[0] !== " " && line[0] !== "\t") {
      const topLevel = trimmed.match(/^(?:async\s+)?(function|class|interface|type|enum)\s+(\w+)/);
      if (topLevel) {
        symbols.push(`  L${i + 1}: ${topLevel[1]} ${topLevel[2]}`);
      }
    }

    if (trimmed.match(/^\/\/\s*─/) || trimmed.match(/^\/\*\*/) || trimmed.match(/^#\s+/)) {
      const comment = trimmed.replace(/^\/\/\s*/, "").replace(/^\/\*\*\s*/, "").replace(/\*\/\s*$/, "").trim();
      if (comment.length > 3 && comment.length < 80) {
        symbols.push(`  L${i + 1}: // ${comment}`);
      }
    }
  }

  const summary = `[${path}] ${totalLines} lines\n` +
    (symbols.length ? symbols.join("\n") : "  (no top-level symbols extracted)") +
    `\n  Use read_file("${path}", offset, limit) to read specific sections.`;

  return { summary, totalLines };
}
