/**
 * ManifestManager: task status, deps, dispatch (REQ-TM-1..7).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type TaskStatus = "planned" | "in-progress" | "implemented" | "verified" | "failed" | "blocked";

export interface TaskEntry {
  status: TaskStatus;
  module: string;
  depends: number[];
  skills: string[];
  reqs: string[];
  title?: string;
  idea?: number;
}

export class ManifestManager {
  private _dir: string;
  private _path: string;
  private _tasks: Record<number, TaskEntry> = {};
  private _nextId = 1;
  private _nextBugId = 1;

  constructor(projectDir?: string) {
    this._dir = join(projectDir ?? process.cwd(), ".voidrift");
    this._path = join(this._dir, "tasks", "manifest.yml");
  }

  exists(): boolean { return existsSync(this._path); }

  load(): void {
    if (!this.exists()) return;
    const raw = parseYaml(readFileSync(this._path, "utf-8")) ?? {};
    this._nextId = raw.next_id ?? 1;
    this._nextBugId = raw.next_bug_id ?? 1;
    this._tasks = {};
    for (const [id, entry] of Object.entries(raw.tasks ?? {})) {
      const e = entry as Record<string, unknown>;
      this._tasks[Number(id)] = {
        status: (e.status as TaskStatus) ?? "planned",
        module: String(e.module ?? ""),
        depends: Array.isArray(e.depends) ? e.depends.map(Number) : [],
        skills: Array.isArray(e.skills) ? e.skills.map(String) : [],
        reqs: Array.isArray(e.reqs) ? e.reqs.map(String) : [],
        title: e.title ? String(e.title) : undefined,
        idea: e.idea != null ? Number(e.idea) : undefined,
      };
    }
  }

  save(): void {
    mkdirSync(join(this._dir, "tasks"), { recursive: true });
    const data: Record<string, unknown> = {
      next_id: this._nextId,
      next_bug_id: this._nextBugId,
      tasks: {} as Record<string, unknown>,
    };
    for (const [id, t] of Object.entries(this._tasks)) {
      (data.tasks as Record<string, unknown>)[id] = { ...t };
    }
    writeFileSync(this._path, stringifyYaml(data), "utf-8");
  }

  tasks(): Record<number, TaskEntry> { return { ...this._tasks }; }

  getTask(id: number): TaskEntry | null { return this._tasks[id] ?? null; }

  setStatus(id: number, status: TaskStatus): void {
    const task = this._tasks[id];
    if (!task) return;
    task.status = status;
    this.save();
    // Transitive blocking (REQ-TM-3)
    if (status === "failed") {
      for (const [tid, t] of Object.entries(this._tasks)) {
        if (t.depends.includes(id) && t.status === "planned") {
          t.status = "blocked";
        }
      }
      this.save();
    }
    // Unblock dependents when implemented
    if (status === "implemented" || status === "verified") {
      for (const [tid, t] of Object.entries(this._tasks)) {
        if (t.status === "blocked" && t.depends.includes(id)) {
          const allMet = t.depends.every(d => {
            const dep = this._tasks[d];
            return dep && (dep.status === "implemented" || dep.status === "verified");
          });
          if (allMet) t.status = "planned";
        }
      }
      this.save();
    }
    this._appendHistory(id, status);
    // Auto-archive idea when all its tasks are verified (REQ-P-8)
    if (status === "verified" && task.idea) this.checkIdeaArchival(task.idea);
  }

  hasWork(): boolean {
    return Object.values(this._tasks).some(t =>
      t.status === "planned" || t.status === "in-progress"
    );
  }

  dispatchable(): number[] {
    return Object.entries(this._tasks)
      .filter(([, t]) => {
        if (t.status !== "planned") return false;
        return t.depends.every(d => {
          const dep = this._tasks[d];
          return dep && (dep.status === "implemented" || dep.status === "verified");
        });
      })
      .map(([id]) => Number(id));
  }

  summary(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      planned: 0, "in-progress": 0, implemented: 0, verified: 0, failed: 0, blocked: 0,
    };
    for (const t of Object.values(this._tasks)) counts[t.status]++;
    return counts;
  }

  readIdea(id: number): string | null {
    const p = join(this._dir, "ideas", `IDEA-${id}.md`);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }

  ideaPath(id: number): string {
    return join(this._dir, "ideas", `IDEA-${id}.md`);
  }

  archive(id: number): void {
    const activeDir = join(this._dir, "tasks", "active");
    const archiveDir = join(this._dir, "tasks", "archived");
    mkdirSync(archiveDir, { recursive: true });
    const src = join(activeDir, `TASK-${id}.md`);
    if (existsSync(src)) renameSync(src, join(archiveDir, `TASK-${id}.md`));
    delete this._tasks[id];
    this.save();
  }

  /** Create a bug entity (REQ-TM-7). Returns bug ID. */
  createBug(title: string, content: string, taskRefs: number[] = []): number {
    const bugId = this._nextBugId++;
    const bugDir = join(this._dir, "tasks", "active");
    mkdirSync(bugDir, { recursive: true });
    const frontmatter = `---\nid: BUG-${bugId}\ntitle: ${title}\ntask_refs: [${taskRefs.join(", ")}]\n---\n\n`;
    writeFileSync(join(bugDir, `BUG-${bugId}.md`), frontmatter + content, "utf-8");
    this.save();
    this._appendHistory(bugId, "created" as TaskStatus);
    return bugId;
  }

  /** Check if all tasks for an idea are verified and archive the idea (REQ-IDEA-5). */
  checkIdeaArchival(ideaId: number): boolean {
    const ideaTasks = Object.values(this._tasks).filter(t => t.idea === ideaId);
    if (!ideaTasks.length) return false;
    if (ideaTasks.every(t => t.status === "verified")) {
      // Archive the idea
      const ideaPath = join(this._dir, "ideas", `IDEA-${ideaId}.md`);
      const archiveDir = join(this._dir, "ideas", "archived");
      mkdirSync(archiveDir, { recursive: true });
      if (existsSync(ideaPath)) {
        renameSync(ideaPath, join(archiveDir, `IDEA-${ideaId}.md`));
        this._appendHistory(ideaId, "done" as TaskStatus);
        return true;
      }
    }
    return false;
  }

  private _appendHistory(id: number, status: TaskStatus): void {
    const historyPath = join(this._dir, "tasks", "history.log");
    const task = this._tasks[id];
    const ts = new Date().toISOString();
    const line = `${ts} TASK-${id} ${status} module=${task?.module ?? ""}\n`;
    try { appendFileSync(historyPath, line); } catch { /* */ }
  }
}
