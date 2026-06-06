/**
 * Plan Manager — persistent flat plan items as markdown files.
 * Stored in .voidrift/plan/, each item is its own file.
 * Filename is the ID. Frontmatter: priority, description, rationale.
 * Body: full markdown detail (loaded on demand).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

export interface PlanItem {
  filename: string;
  priority: "now" | "next" | "later";
  description: string;
  rationale: string;
  body: string;
}

export class PlanManager {
  private dir: string;

  constructor(private workspaceRoot: string) {
    this.dir = join(workspaceRoot, ".voidrift", "plan");
  }

  private parse(filename: string): PlanItem | null {
    const filePath = join(this.dir, filename);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const header = match[1];
      const body = match[2].trim();
      const priority = (header.match(/priority:\s*(.+)/)?.[1]?.trim() || "later") as PlanItem["priority"];
      const description = header.match(/description:\s*(.+)/)?.[1]?.trim() || "";
      const rationale = header.match(/rationale:\s*(.+)/)?.[1]?.trim() || "";
      return { filename, priority, description, rationale, body };
    } catch { return null; }
  }

  all(): PlanItem[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith(".md"))
      .map(f => this.parse(f))
      .filter(Boolean) as PlanItem[];
  }

  byPriority(priority: PlanItem["priority"]): PlanItem[] {
    return this.all().filter(i => i.priority === priority);
  }

  get(filename: string): PlanItem | null {
    return this.parse(filename);
  }

  /** Compile now items into a context-friendly string for Orbit injection */
  compile(): string | null {
    const now = this.byPriority("now");
    if (now.length === 0) return null;
    const lines = ["--- Active Plan ---"];
    for (const item of now) {
      lines.push(`• ${item.description}${item.rationale ? ` — ${item.rationale}` : ""}`);
    }
    return lines.join("\n");
  }

  /** Load full body of a plan item (Stage 2 disclosure) */
  loadBody(filename: string): string | null {
    const item = this.parse(filename);
    return item ? item.body : null;
  }

  add(name: string, description: string, rationale: string, priority: PlanItem["priority"] = "now", body = ""): string {
    mkdirSync(this.dir, { recursive: true });
    const filename = `${name}.md`;
    const content = `---\npriority: ${priority}\ndescription: ${description}\nrationale: ${rationale}\n---\n\n${body}\n`;
    writeFileSync(join(this.dir, filename), content, "utf-8");
    return filename;
  }

  updatePriority(filename: string, priority: PlanItem["priority"]): boolean {
    const item = this.parse(filename);
    if (!item) return false;
    const filePath = join(this.dir, filename);
    const raw = readFileSync(filePath, "utf-8");
    const updated = raw.replace(/priority:\s*.+/, `priority: ${priority}`);
    writeFileSync(filePath, updated, "utf-8");
    return true;
  }

  remove(filename: string): boolean {
    const filePath = join(this.dir, filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }
}
