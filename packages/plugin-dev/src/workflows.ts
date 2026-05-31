import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Section 9.2: Development Workflow Objects.
 *
 * Manages Ideas, Change Requests, and Tasks stored as markdown files.
 */

export interface Idea {
  id: string;
  title: string;
  content: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  focusedFiles: string[];
  content: string;
}

export interface Task {
  id: string;
  crId: string;
  file: string;
  content: string;
}

export class WorkflowObjects {
  constructor(private workspaceRoot: string) {}

  // Ideas
  listIdeas(): Idea[] {
    return this.listObjects<Idea>(join(this.workspaceRoot, ".voidrift", "ideas"), "IDEA");
  }

  getIdea(id: string): Idea | null {
    return this.getObject(join(this.workspaceRoot, ".voidrift", "ideas", `IDEA-${id}.md`), id);
  }

  saveIdea(id: string, title: string, content: string): void {
    const dir = join(this.workspaceRoot, ".voidrift", "ideas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `IDEA-${id}.md`), `# ${title}\n\n${content}`);
  }

  // Change Requests
  listCRs(): ChangeRequest[] {
    const dir = join(this.workspaceRoot, ".voidrift", "changes");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith("CR-") && f.endsWith(".md"))
      .map((f) => {
        const id = f.replace("CR-", "").replace(".md", "");
        const content = readFileSync(join(dir, f), "utf-8");
        const title = content.split("\n")[0]?.replace(/^#\s*/, "") ?? id;
        const filesMatch = content.match(/focusedFiles:\s*\[([^\]]*)\]/);
        const focusedFiles = filesMatch ? filesMatch[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean) : [];
        return { id, title, focusedFiles, content };
      });
  }

  saveCR(id: string, title: string, focusedFiles: string[], content: string): void {
    const dir = join(this.workspaceRoot, ".voidrift", "changes");
    mkdirSync(dir, { recursive: true });
    const header = `# ${title}\n\nfocusedFiles: [${focusedFiles.map((f) => `"${f}"`).join(", ")}]\n\n`;
    writeFileSync(join(dir, `CR-${id}.md`), header + content);
  }

  // Tasks
  listTasks(crId?: string): Task[] {
    const dir = join(this.workspaceRoot, ".voidrift", "tasks");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith("TASK-") && f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const id = f.replace("TASK-", "").replace(".md", "");
        const crMatch = content.match(/cr:\s*(\S+)/);
        const fileMatch = content.match(/file:\s*(\S+)/);
        return { id, crId: crMatch?.[1] ?? "", file: fileMatch?.[1] ?? "", content };
      })
      .filter((t) => !crId || t.crId === crId);
  }

  saveTask(id: string, crId: string, file: string, content: string): void {
    const dir = join(this.workspaceRoot, ".voidrift", "tasks");
    mkdirSync(dir, { recursive: true });
    const header = `cr: ${crId}\nfile: ${file}\n\n`;
    writeFileSync(join(dir, `TASK-${id}.md`), header + content);
  }

  private listObjects<T extends { id: string }>(dir: string, prefix: string): T[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .map((f) => {
        const id = f.replace(`${prefix}-`, "").replace(".md", "");
        const content = readFileSync(join(dir, f), "utf-8");
        const title = content.split("\n")[0]?.replace(/^#\s*/, "") ?? id;
        return { id, title, content } as unknown as T;
      });
  }

  private getObject(path: string, id: string): any | null {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8");
    const title = content.split("\n")[0]?.replace(/^#\s*/, "") ?? id;
    return { id, title, content };
  }
}
