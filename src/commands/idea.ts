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

// ---------------------------------------------------------------------------
// Slash commands for idea flow
// ---------------------------------------------------------------------------

import { SlashCommand, type ChatContext } from "./base.js";

export class IdeaStartCommand extends SlashCommand {
  readonly name = "idea";
  private ctx: ChatContext;
  private arg: string;
  constructor(ctx: ChatContext, arg: string) { super(); this.ctx = ctx; this.arg = arg; }

  async execute(): Promise<number> {
    if (this.ctx.ideaSession.isActive()) { this.ctx.content.addSystem("Idea session already active. Type /done to finish."); return 1; }
    const id = this.arg ? parseInt(this.arg, 10) : null;
    if (id !== null && isNaN(id)) { this.ctx.content.addSystem("Usage: /idea [id]"); return 1; }

    if (id) {
      const content = readIdea(this.ctx.projectDir, id);
      if (!content) { this.ctx.content.addSystem(`IDEA-${id} not found.`); return 1; }
      this.ctx.ideaSession.start(id);
      this.ctx.footer.setMode("/idea");
      this.ctx.content.addSystem(`Loaded IDEA-${id}. Describe what to refine, or /done to save.`);
      this.ctx.input.setBusy(true); this.ctx.content.setThinking(true);
      try {
        this.ctx.streamBuf.value = ""; this.ctx.content.addModel("", "", true);
        const r = await this.ctx.agent.send(`I'm resuming work on this idea:\n\n${content}\n\nSummarize the current state and ask what I'd like to refine.`);
        this.ctx.content.updateLastModel(r, "", false);
      } catch (e) { this.ctx.content.addSystem(`Error: ${e}`); }
      finally { this.ctx.content.setThinking(false); this.ctx.input.setBusy(false); }
    } else {
      const newId = nextIdeaId(this.ctx.projectDir);
      this.ctx.ideaSession.start(newId);
      this.ctx.footer.setMode("/idea");
      this.ctx.content.addSystem(`New idea IDEA-${newId}. Describe your idea — the agent will guide you. /done to save.`);
    }
    return 0;
  }
}

export class IdeaDoneCommand extends SlashCommand {
  readonly name = "done";
  private ctx: ChatContext;
  private category: string;
  constructor(ctx: ChatContext, category: string) { super(); this.ctx = ctx; this.category = category; }

  async execute(): Promise<number> {
    if (!this.ctx.ideaSession.isActive()) { this.ctx.content.addSystem("No active idea session."); return 1; }
    const cat = this.category || "now";
    if (!["now", "next", "later"].includes(cat)) { this.ctx.content.addSystem("Category: now, next, or later"); return 1; }
    const id = this.ctx.ideaSession.ideaId ?? nextIdeaId(this.ctx.projectDir);
    this.ctx.input.setBusy(true); this.ctx.content.setThinking(true);
    try {
      this.ctx.streamBuf.value = ""; this.ctx.content.addModel("", "", true);
      const summary = await this.ctx.agent.send("Produce a structured idea summary: Title, User Story, Acceptance Criteria, Affected Modules, Affected Files. Markdown format.");
      this.ctx.content.updateLastModel(summary, "", false);
      writeIdea(this.ctx.projectDir, id, buildIdeaContent(`IDEA-${id}`, summary, cat as "now" | "next" | "later"));
      this.ctx.ideaSession.cancel();
      this.ctx.footer.setMode("");
      this.ctx.content.addSystem(`Saved IDEA-${id} as "${cat}".`);
    } catch (e) { this.ctx.content.addSystem(`Error: ${e}`); }
    finally { this.ctx.content.setThinking(false); this.ctx.input.setBusy(false); }
    return 0;
  }
}
