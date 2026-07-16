/**
 * Plan Repository — persistence interface for plan items.
 *
 * The PlanManager uses this interface for all I/O. Default implementation
 * reads/writes markdown files to .voidrift/plan/. Alternative implementations
 * can use databases, APIs, or in-memory storage (testing).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { PlanItem } from "./plan.js";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface PlanRepository {
  /** List all plan items */
  all(): PlanItem[];

  /** Get a single plan item by filename */
  get(filename: string): PlanItem | null;

  /** Save a plan item. Returns the filename. */
  save(filename: string, item: Omit<PlanItem, "filename">): void;

  /** Delete a plan item by filename. Returns true if it existed. */
  remove(filename: string): boolean;

  /** The directory path (for editor integration). Filesystem-specific. */
  readonly dir: string;
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemPlanRepository implements PlanRepository {
  private _dir: string;

  constructor(workspaceRoot: string) {
    this._dir = join(workspaceRoot, ".voidrift", "plan");
  }

  get dir(): string { return this._dir; }

  all(): PlanItem[] {
    if (!existsSync(this._dir)) return [];
    return readdirSync(this._dir)
      .filter(f => f.endsWith(".md"))
      .map(f => this.parse(f))
      .filter(Boolean) as PlanItem[];
  }

  get(filename: string): PlanItem | null {
    return this.parse(filename);
  }

  save(filename: string, item: Omit<PlanItem, "filename">): void {
    mkdirSync(this._dir, { recursive: true });
    const content = `---\npriority: ${item.priority}\ndescription: ${item.description}\nrationale: ${item.rationale}\n---\n\n${item.body}\n`;
    writeFileSync(join(this._dir, filename), content, "utf-8");
  }

  remove(filename: string): boolean {
    const filePath = join(this._dir, filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  private parse(filename: string): PlanItem | null {
    const filePath = join(this._dir, filename);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const frontmatter = match[1];
      const body = match[2].trim();
      const priority = (frontmatter.match(/priority:\s*(.+)/)?.[1]?.trim() || "later") as PlanItem["priority"];
      const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || "";
      const rationale = frontmatter.match(/rationale:\s*(.+)/)?.[1]?.trim() || "";
      // Parse optional scope
      const writeMatch = frontmatter.match(/write:\s*\[([^\]]*)\]/);
      const executeMatch = frontmatter.match(/execute:\s*\[([^\]]*)\]/);
      const scope = (writeMatch || executeMatch) ? {
        write: writeMatch ? writeMatch[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : undefined,
        execute: executeMatch ? executeMatch[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : undefined,
      } : undefined;
      return { filename, priority, description, rationale, body, scope };
    } catch { return null; }
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemoryPlanRepository implements PlanRepository {
  private items = new Map<string, PlanItem>();
  readonly dir = "(memory)";

  all(): PlanItem[] {
    return [...this.items.values()];
  }

  get(filename: string): PlanItem | null {
    return this.items.get(filename) ?? null;
  }

  save(filename: string, item: Omit<PlanItem, "filename">): void {
    this.items.set(filename, { filename, ...item });
  }

  remove(filename: string): boolean {
    return this.items.delete(filename);
  }
}
