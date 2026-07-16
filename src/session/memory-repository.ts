import { createRequire } from "module";
const require = createRequire(import.meta.url);
/**
 * Memory Repository — persistence interface for memory entries.
 *
 * The MemoryRegistry uses this interface to load all memory entries.
 * Default implementation scans filesystem directories for markdown files.
 * Alternative implementations can use databases or in-memory stores (testing).
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import type { MemoryMeta, MemoryType } from "./memory.js";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface MemoryEntry {
  meta: MemoryMeta;
  body: string;
}

export interface MemoryRepository {
  /** Scan directories and return all memory entries (metadata + body) */
  scan(directories: string[]): MemoryEntry[];

  /** Save a memory entry to disk. Returns the file path. */
  save(dir: string, meta: MemoryMeta, body: string): string;
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemMemoryRepository implements MemoryRepository {
  scan(directories: string[]): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    for (const dir of directories) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const fullPath = join(dir, file);
        const parsed = this.parseFile(fullPath);
        if (parsed) entries.push(parsed);
      }
    }

    return entries;
  }

  private parseFile(filePath: string): MemoryEntry | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;

      const header = match[1];
      const body = match[2].trim();

      const id = this.extractField(header, "id");
      const title = this.extractField(header, "title");
      const summary = this.extractField(header, "summary");
      if (!id || !title || !summary) return null;

      const context: MemoryMeta["context"] = {};
      const extMatch = header.match(/extensions:\s*\[([^\]]*)\]/);
      if (extMatch) context.extensions = this.parseArray(extMatch[1]);
      const filesMatch = header.match(/files:\s*\[([^\]]*)\]/);
      if (filesMatch) context.files = this.parseArray(filesMatch[1]);
      const kwMatch = header.match(/keywords:\s*\[([^\]]*)\]/);
      if (kwMatch) context.keywords = this.parseArray(kwMatch[1]);

      const meta: MemoryMeta = {
        id,
        title,
        summary,
        type: (this.extractField(header, "type") as MemoryType) || "reference",
        context,
        filePath,
      };

      return { meta, body };
    } catch {
      return null;
    }
  }

  private extractField(yaml: string, field: string): string | null {
    const match = yaml.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : null;
  }

  private parseArray(raw: string): string[] {
    return raw.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }

  save(dir: string, meta: MemoryMeta, body: string): string {
    const { mkdirSync, writeFileSync } = require("fs");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${meta.id}.md`);
    const keywords = meta.context.keywords || [];
    const file = `---\nid: ${meta.id}\ntitle: ${meta.title}\nsummary: ${meta.summary}\ntype: ${meta.type}\ncontext:\n  keywords: [${keywords.map(k => `"${k}"`).join(", ")}]\n---\n\n${body}\n`;
    writeFileSync(filePath, file, "utf-8");
    return filePath;
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemoryMemoryRepository implements MemoryRepository {
  private entries: MemoryEntry[] = [];

  add(meta: MemoryMeta, body: string): void {
    this.entries.push({ meta, body });
  }

  scan(_directories: string[]): MemoryEntry[] {
    return [...this.entries];
  }

  save(_dir: string, meta: MemoryMeta, body: string): string {
    this.entries.push({ meta, body });
    return `(memory)/${meta.id}.md`;
  }
}
