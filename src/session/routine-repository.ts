/**
 * Routine Repository — persistence interface for routine items.
 *
 * Same pattern as PlanRepository but stores to .voidrift/routines/.
 * Routines are repeatable instructions that never move through lifecycle lanes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { RoutineItem } from "./routine.js";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface RoutineRepository {
  /** List all routine items */
  all(): RoutineItem[];

  /** Get a single routine by filename */
  get(filename: string): RoutineItem | null;

  /** Save a routine item. */
  save(filename: string, item: Omit<RoutineItem, "filename">): void;

  /** Delete a routine by filename. Returns true if it existed. */
  remove(filename: string): boolean;

  /** The directory path. */
  readonly dir: string;
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemRoutineRepository implements RoutineRepository {
  private _dir: string;

  constructor(workspaceRoot: string) {
    this._dir = join(workspaceRoot, ".voidrift", "routines");
  }

  get dir(): string { return this._dir; }

  all(): RoutineItem[] {
    if (!existsSync(this._dir)) return [];
    return readdirSync(this._dir)
      .filter(f => f.endsWith(".md"))
      .map(f => this.parse(f))
      .filter(Boolean) as RoutineItem[];
  }

  get(filename: string): RoutineItem | null {
    return this.parse(filename);
  }

  save(filename: string, item: Omit<RoutineItem, "filename">): void {
    mkdirSync(this._dir, { recursive: true });
    const content = `---\ndescription: ${item.description}\n---\n\n${item.body}\n`;
    writeFileSync(join(this._dir, filename), content, "utf-8");
  }

  remove(filename: string): boolean {
    const filePath = join(this._dir, filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  private parse(filename: string): RoutineItem | null {
    const filePath = join(this._dir, filename);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const frontmatter = match[1];
      const body = match[2].trim();
      const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || "";
      return { filename, description, body };
    } catch { return null; }
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemoryRoutineRepository implements RoutineRepository {
  private items = new Map<string, RoutineItem>();
  readonly dir = "(memory)";

  all(): RoutineItem[] {
    return [...this.items.values()];
  }

  get(filename: string): RoutineItem | null {
    return this.items.get(filename) ?? null;
  }

  save(filename: string, item: Omit<RoutineItem, "filename">): void {
    this.items.set(filename, { filename, ...item });
  }

  remove(filename: string): boolean {
    return this.items.delete(filename);
  }
}
