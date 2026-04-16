/**
 * Idea refinement (REQ-IDEA-1..5). State machine + file I/O.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export enum IdeaState {
  IDLE = "idle",
  COLLECTING = "collecting",
}

export type IdeaCategory = "now" | "next" | "later" | "draft" | "done";

export class IdeaSession {
  state = IdeaState.IDLE;
  lines: string[] = [];
  ideaId: number | null = null;

  start(ideaId?: number): void {
    if (this.state !== IdeaState.IDLE) throw new Error("Idea session already active.");
    this.state = IdeaState.COLLECTING;
    this.lines = [];
    this.ideaId = ideaId ?? null;
  }

  addLine(line: string): void {
    if (this.state !== IdeaState.COLLECTING) throw new Error("Not collecting.");
    this.lines.push(line);
  }

  confirm(): string {
    if (this.state !== IdeaState.COLLECTING) throw new Error("Not collecting.");
    const text = this.lines.join("\n");
    this.state = IdeaState.IDLE;
    this.lines = [];
    return text;
  }

  cancel(): void {
    this.state = IdeaState.IDLE;
    this.lines = [];
    this.ideaId = null;
  }

  isActive(): boolean { return this.state !== IdeaState.IDLE; }
}

// ---------------------------------------------------------------------------
// Idea file I/O
// ---------------------------------------------------------------------------

export function ideasDir(projectDir: string): string {
  return join(projectDir, ".voidrift", "ideas");
}

export function ideaPath(projectDir: string, id: number): string {
  return join(ideasDir(projectDir), `IDEA-${id}.md`);
}

export function readIdea(projectDir: string, id: number): string | null {
  const p = ideaPath(projectDir, id);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

export function writeIdea(projectDir: string, id: number, content: string): void {
  const dir = ideasDir(projectDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ideaPath(projectDir, id), content, "utf-8");
}

export function nextIdeaId(projectDir: string): number {
  const dir = ideasDir(projectDir);
  if (!existsSync(dir)) return 1;
  const { readdirSync } = require("node:fs");
  const files = readdirSync(dir).filter((f: string) => /^IDEA-\d+\.md$/.test(f));
  if (!files.length) return 1;
  const ids = files.map((f: string) => parseInt(f.match(/IDEA-(\d+)/)?.[1] ?? "0", 10));
  return Math.max(...ids) + 1;
}

/** Build idea file content with frontmatter. */
export function buildIdeaContent(title: string, body: string, category: IdeaCategory = "draft", reqs?: string[]): string {
  const fm = [`---`, `title: ${title}`, `category: ${category}`];
  if (reqs?.length) fm.push(`reqs: [${reqs.join(", ")}]`);
  fm.push(`---`, ``);
  return fm.join("\n") + "\n" + body + "\n";
}
