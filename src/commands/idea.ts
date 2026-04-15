/**
 * Idea refinement state machine (REQ-U-21). Zero I/O.
 */

export enum IdeaState {
  IDLE = "idle",
  COLLECTING = "collecting",
  CONFIRM_PENDING = "confirm_pending",
}

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

  isActive(): boolean {
    return this.state !== IdeaState.IDLE;
  }
}
