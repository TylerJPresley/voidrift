import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, extname } from "path";

const IGNORED = new Set(["node_modules", ".git", ".voidrift", "dist", "build", ".next", "coverage"]);
const MAX_DEPTH = 5;
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".rs", ".go"]);

export interface CodeMapEntry {
  path: string;
  type: "file" | "dir";
  symbols?: string[];
}

/**
 * Workspace Code-Map Generator.
 *
 * Scans workspace files and extracts top-level symbols (exports, classes, functions)
 * to compile a compressed, token-efficient structure tree excluding function bodies.
 * Target: complete project awareness for under 1,000 tokens.
 */
export function generateCodeMap(workspaceRoot: string): string {
  const entries = walk(workspaceRoot, workspaceRoot, 0);
  return formatTree(entries);
}

export function getCodeMapEntries(workspaceRoot: string): CodeMapEntry[] {
  return walk(workspaceRoot, workspaceRoot, 0);
}

function walk(dir: string, root: string, depth: number): CodeMapEntry[] {
  if (depth > MAX_DEPTH) return [];

  const entries: CodeMapEntry[] = [];
  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return entries;
  }

  for (const item of items.sort()) {
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
      entries.push(...walk(fullPath, root, depth + 1));
    } else {
      const symbols = CODE_EXTENSIONS.has(extname(item).toLowerCase())
        ? extractSymbols(fullPath)
        : undefined;
      entries.push({ path: relPath, type: "file", symbols });
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

function formatTree(entries: CodeMapEntry[]): string {
  return entries
    .map((e) => {
      if (e.type === "dir") return `📁 ${e.path}`;
      const symbolStr = e.symbols?.length ? ` [${e.symbols.join(", ")}]` : "";
      return `   ${e.path}${symbolStr}`;
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
